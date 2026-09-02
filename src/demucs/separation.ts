import { getSeparationCache, setSeparationCache, updateSong, getSong } from '../db/index';
import { encodeWav } from './wav';

export interface SeparationJob {
  fileName: string;
  sampleRate: number;
  status: 'init' | 'loading' | 'running' | 'done' | 'error';
  progress: number;
  message: string;
  error?: string;
  result?: { vocals: ArrayBuffer; accompaniment: ArrayBuffer };
}

interface Listener {
  id: number;
  cb: (job: SeparationJob | null) => void;
}

let worker: Worker | null = null;
let currentJob: SeparationJob | null = null;
let listeners: Listener[] = [];
let listenerId = 1;
let resultResolve: ((result: { vocals: ArrayBuffer; accompaniment: ArrayBuffer }) => void) | null = null;
let resultReject: ((err: Error) => void) | null = null;

function notify() {
  listeners.forEach(l => l.cb(currentJob));
}

export function subscribeSeparation(cb: (job: SeparationJob | null) => void) {
  const id = listenerId++;
  listeners.push({ id, cb });
  cb(currentJob);
  return () => {
    listeners = listeners.filter(l => l.id !== id);
  };
}

export function getCurrentJob(): SeparationJob | null {
  return currentJob;
}

export function cancelSeparation() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (currentJob) {
    currentJob.status = 'error';
    currentJob.error = '用户取消';
    notify();
  }
  if (resultReject) {
    resultReject(new Error('用户取消'));
  }
  resetPromise();
}

export function resetSeparation() {
  cancelSeparation();
  currentJob = null;
  notify();
}

function resetPromise() {
  resultResolve = null;
  resultReject = null;
}

function log(...args: unknown[]) {
  console.log('[separation]', ...args);
}

function getWorker(): Worker {
  if (!worker) {
    log('creating worker');
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data as { type: string };
      log('worker message', type, e.data);
      if (type === 'ready') {
        log('worker ready', e.data);
      } else if (type === 'progress') {
        if (currentJob) {
          currentJob.progress = (e.data as { percent: number }).percent ?? 0;
          if (currentJob.status === 'init' || currentJob.status === 'loading') {
            currentJob.status = 'running';
          }
          notify();
        }
      } else if (type === 'log' || type === 'downloadProgress') {
        if (currentJob) {
          const msg = (e.data as { msg?: string }).msg ?? '';
          if (msg) currentJob.message = msg;
          notify();
        }
      } else if (type === 'result') {
        const { vocals, accompaniment } = e.data as { vocals: Float32Array[]; accompaniment: Float32Array[] };
        if (currentJob) {
          currentJob.status = 'done';
          currentJob.progress = 1;
          storeResult(currentJob, vocals, accompaniment);
        }
      } else if (type === 'error') {
        if (currentJob) {
          currentJob.status = 'error';
          currentJob.error = (e.data as { message: string }).message ?? '未知错误';
          notify();
        }
        if (resultReject) resultReject(new Error(currentJob?.error ?? '分离失败'));
        resetPromise();
      }
    };
    worker.onerror = (err) => {
      log('worker error', err.message);
      if (currentJob) {
        currentJob.status = 'error';
        currentJob.error = err.message;
        notify();
      }
      if (resultReject) resultReject(new Error(err.message));
      resetPromise();
    };
  }
  return worker;
}

async function storeResult(
  job: SeparationJob,
  vocalsChannels: Float32Array[],
  accompChannels: Float32Array[]
) {
  try {
    const vocalsWav = encodeWav(vocalsChannels, job.sampleRate);
    const accompWav = encodeWav(accompChannels, job.sampleRate);
    currentJob!.result = { vocals: vocalsWav, accompaniment: accompWav };
    currentJob!.progress = 1;
    notify();
    if (resultResolve) resultResolve(currentJob!.result);
  } catch (err) {
    if (currentJob) {
      currentJob.status = 'error';
      currentJob.error = (err as Error).message;
      notify();
    }
    if (resultReject) resultReject(err as Error);
  } finally {
    resetPromise();
  }
}

function decodeAudioData(arrayBuffer: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  return new Promise((resolve, reject) => {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    ctx.decodeAudioData(arrayBuffer.slice(0), (buffer) => {
      const channels: Float32Array[] = [];
      for (let i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
      }
      ctx.close();
      resolve({ channels, sampleRate: buffer.sampleRate });
    }, reject);
  });
}

/** 检查歌曲是否已有人声分离缓存 */
export async function hasSeparationCache(songId: string): Promise<boolean> {
  const vocals = await getSeparationCache(songId, 'vocals');
  const accomp = await getSeparationCache(songId, 'accompaniment');
  return !!vocals && !!accomp;
}

/** 加载已缓存的人声/伴奏数据 */
export async function loadSeparationResult(songId: string): Promise<{ vocals: ArrayBuffer; accompaniment: ArrayBuffer } | null> {
  const vocals = await getSeparationCache(songId, 'vocals');
  const accompaniment = await getSeparationCache(songId, 'accompaniment');
  if (!vocals || !accompaniment) return null;
  return { vocals, accompaniment };
}

/** 删除歌曲的分离缓存 */
export async function deleteSeparationResult(songId: string) {
  // 当前 Dexie 表没有按 songId 删除的索引，这里通过 get 清除再写入空数据，或直接在 UI 中处理
  // 为简化实现，先清空关联字段
  await updateSong(songId, { hasSeparation: false });
}

/**
 * 对指定歌曲执行人声/伴奏分离，并按 songId 存入 IndexedDB。
 * 若已有缓存则直接返回缓存结果。
 */
export async function separateSong(
  songId: string,
  fileName: string,
  audioData: ArrayBuffer
): Promise<{ vocals: ArrayBuffer; accompaniment: ArrayBuffer }> {
  log('separateSong start', { songId, fileName, bytes: audioData.byteLength });
  const cached = await loadSeparationResult(songId);
  if (cached) {
    log('separateSong cache hit', songId);
    return cached;
  }

  if (currentJob) {
    throw new Error('已有正在进行的分离任务');
  }

  log('decode audio data');
  const { channels, sampleRate } = await decodeAudioData(audioData);
  log('decoded', { channels: channels.length, sampleRate, samples: channels[0]?.length });

  currentJob = {
    fileName,
    sampleRate,
    status: 'init',
    progress: 0,
    message: '正在初始化模型...',
  };
  notify();

  const resultPromise = new Promise<{ vocals: ArrayBuffer; accompaniment: ArrayBuffer }>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });

  log('start worker init');
  const w = getWorker();
  w.postMessage({ type: 'init' });

  // 等待模型加载完成后再发送分离任务
  await new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const { type } = e.data as { type: string };
      if (type === 'ready') {
        w.removeEventListener('message', handler);
        resolve();
      } else if (type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error((e.data as { message: string }).message ?? '模型初始化失败'));
      }
    };
    w.addEventListener('message', handler);
  });

  log('worker ready, start separate');
  w.postMessage({ type: 'separate', audioData: channels, sampleRate });

  const result = await resultPromise;
  log('separateSong got result, store cache', { songId, vocalsBytes: result.vocals.byteLength, accompBytes: result.accompaniment.byteLength });

  // 存入 IndexedDB 缓存
  await setSeparationCache(songId, 'vocals', result.vocals);
  await setSeparationCache(songId, 'accompaniment', result.accompaniment);
  await updateSong(songId, { hasSeparation: true });

  // 更新当前歌曲对象（如果内存中的引用仍在）
  const song = await getSong(songId);
  if (song) {
    Object.assign(song, { hasSeparation: true });
  }

  return result;
}

/** 兼容旧 API：按文件分轨（以文件 name + size 为临时 ID） */
export function separateFile(file: File): Promise<{ vocals: ArrayBuffer; accompaniment: ArrayBuffer }> {
  const tempId = `${file.name}-${file.size}`;
  return file.arrayBuffer().then(buf => separateSong(tempId, file.name, buf));
}
