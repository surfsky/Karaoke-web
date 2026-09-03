/**
 * Demucs 人声分离 Web Worker
 * 基于项目内的 demucs-wasm 包与 onnxruntime-web，在浏览器后台线程执行 AI 分轨。
 */
import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from '../demucs-web/index.js';

type WorkerMessage =
  | { type: 'init' }
  | { type: 'separate'; audioData: Float32Array[]; sampleRate: number };

type ProcessorResult = {
  drums: { left: Float32Array; right: Float32Array };
  bass: { left: Float32Array; right: Float32Array };
  other: { left: Float32Array; right: Float32Array };
  vocals: { left: Float32Array; right: Float32Array };
};

let processor: InstanceType<typeof DemucsProcessor> | null = null;
let ready = false;

const post = (msg: Record<string, unknown>) => self.postMessage(msg);

function log(phase: string, msg: string) {
  console.log(`[demucs-worker/${phase}]`, msg);
  post({ type: 'log', phase, msg });
}

async function fetchArrayBuffer(
  url: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  log('download', `fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const contentLength = res.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (!res.body || !total) {
    log('download', `no progress tracking, fallback to arrayBuffer()`);
    return await res.arrayBuffer();
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) onProgress(loaded, total);
  }
  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined.buffer;
}

async function loadModelBuffer(): Promise<ArrayBuffer> {
  const localUrl = new URL('./models/htdemucs_embedded.onnx', location.href).href;
  const remoteUrl = CONSTANTS.DEFAULT_MODEL_URL;

  // 优先尝试本地模型（用户可下载放置到 public/models）
  try {
    const buf = await fetchArrayBuffer(localUrl, (loaded, total) => {
      post({ type: 'progress', percent: 0.1 + (loaded / total) * 0.3 });
    });
    const sizeMb = buf.byteLength / 1024 / 1024;
    if (buf.byteLength < 1024 * 1024) {
      // Vite SPA fallback 会返回 index.html（<1MB），不是真实模型
      throw new Error(`local model file too small (${sizeMb.toFixed(2)} MB), probably SPA fallback`);
    }
    log('download', `local model ready (${sizeMb.toFixed(1)} MB)`);
    return buf;
  } catch (err) {
    log('download', `local model unavailable: ${(err as Error).message}`);
  }

  // fallback 到远程 HuggingFace
  const buf = await fetchArrayBuffer(remoteUrl, (loaded, total) => {
    post({ type: 'progress', percent: 0.1 + (loaded / total) * 0.3 });
  });
  log('download', `remote model ready (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
  return buf;
}

async function init() {
  try {
    log('init', 'start initializing onnxruntime-web');

    // ONNX Runtime WASM 配置：指向部署目录中的 wasm 文件
    // 在 Vite dev server 中，带 ?import 的 wasm worker 加载会失败，
    // 因此生产/预览环境使用多线程 WebGPU/WASM；开发环境回退到单线程 WASM CPU。
    const isDev = location.port === '5174' || (location.hostname === 'localhost' && location.port !== '4173');
    ort.env.wasm.numThreads = isDev ? 0 : Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('./', location.href).href;
    log('init', `wasm config: dev=${isDev}, numThreads=${ort.env.wasm.numThreads}, simd=${ort.env.wasm.simd}, wasmPaths=${ort.env.wasm.wasmPaths}`);

    // 优先启用 WebGPU 推理（若浏览器支持），开发环境禁用以免依赖 jsep worker
    let webgpu = false;
    const sessionOptions: ort.InferenceSession.SessionOptions = {};
    if (!isDev && 'gpu' in navigator) {
      try {
        const adapter = await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter!();
        if (adapter) {
          sessionOptions.executionProviders = [{ name: 'webgpu', powerPreference: 'high-performance' } as never];
          webgpu = true;
          log('init', 'WebGPU enabled');
        }
      } catch (err) {
        log('init', `WebGPU unavailable: ${(err as Error).message}`);
      }
    }

    processor = new DemucsProcessor({
      ort,
      modelPath: CONSTANTS.DEFAULT_MODEL_URL,
      sessionOptions,
      onProgress: (info: { phase?: string; progress?: number }) => {
        post({ type: 'progress', percent: info.progress ?? 0 });
      },
      onLog: (phase: string, msg: string) => log(phase, msg),
    });

    log('init', 'loading model');
    const modelBuffer = await loadModelBuffer();
    await processor.loadModel(modelBuffer);
    ready = true;
    log('init', 'model loaded successfully');
    post({ type: 'ready', webgpu });
  } catch (err) {
    const message = (err as Error).message || String(err);
    log('init', `failed: ${message}`);
    post({ type: 'error', message });
  }
}

/**
 * 使用 OfflineAudioContext 重采样到目标采样率
 */
async function resampleTo(
  channels: Float32Array[],
  sourceRate: number,
  targetRate: number
): Promise<Float32Array[]> {
  if (sourceRate === targetRate) {
    log('resample', `source rate ${sourceRate} matches target, skip`);
    return channels;
  }
  const length = channels[0].length;
  const duration = length / sourceRate;
  const targetLength = Math.ceil(duration * targetRate);
  log('resample', `${sourceRate}Hz -> ${targetRate}Hz, samples ${length} -> ${targetLength}`);

  const ctx = new OfflineAudioContext(channels.length, targetLength, targetRate);
  const buffer = ctx.createBuffer(channels.length, length, sourceRate);
  channels.forEach((ch, i) => buffer.copyToChannel(new Float32Array(ch), i));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  const result: Float32Array[] = [];
  for (let i = 0; i < rendered.numberOfChannels; i++) {
    result.push(rendered.getChannelData(i));
  }
  return result;
}

function normalizeChannel(channel: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < channel.length; i++) {
    const v = Math.abs(channel[i]);
    if (v > peak) peak = v;
  }
  if (peak <= 1 || peak === 0) return channel;
  const scale = 1 / peak;
  for (let i = 0; i < channel.length; i++) channel[i] *= scale;
  return channel;
}

async function separate(audioData: Float32Array[], sampleRate: number) {
  if (!processor || !ready) {
    post({ type: 'error', message: '分离引擎尚未初始化完成' });
    return;
  }

  try {
    post({ type: 'progress', percent: 0.05 });

    const channels = audioData.length;
    if (channels === 0) throw new Error('音频数据为空');

    log('separate', `input: ${channels} channels, ${sampleRate}Hz, ${audioData[0].length} samples`);

    // 重采样到 Demucs 期望的 44.1kHz
    const resampled = await resampleTo(audioData, sampleRate, CONSTANTS.SAMPLE_RATE);
    const left = resampled[0];
    const right = resampled.length >= 2 ? resampled[1] : left.slice();

    log('separate', `start inference on ${left.length} samples`);
    const result = (await processor.separate(left, right)) as ProcessorResult;
    log('separate', 'inference done');

    post({ type: 'progress', percent: 0.95 });

    // 伴奏 = drums + bass + other
    const mix = (a: Float32Array, b: Float32Array, c: Float32Array) => {
      const out = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i] + c[i];
      return out;
    };

    const vocalsLeft = result.vocals.left;
    const vocalsRight = result.vocals.right;
    const accompLeft = mix(result.drums.left, result.bass.left, result.other.left);
    const accompRight = mix(result.drums.right, result.bass.right, result.other.right);

    post({
      type: 'result',
      vocals: [normalizeChannel(vocalsLeft), normalizeChannel(vocalsRight)],
      accompaniment: [normalizeChannel(accompLeft), normalizeChannel(accompRight)],
    });
  } catch (err) {
    const message = (err as Error).message || String(err);
    log('separate', `failed: ${message}`);
    post({ type: 'error', message });
  }
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type } = e.data;
  if (type === 'init') {
    void init();
  } else if (type === 'separate') {
    void separate(e.data.audioData, e.data.sampleRate);
  } else {
    post({ type: 'error', message: `未知消息类型: ${type}` });
  }
};

export {};
