/**
 * OPFS 缓存 — 管理 demucs 分离结果的持久化存储
 */

const CACHE_DIR = 'demucs-cache';
const CACHE_INDEX = 'demucs-index';

interface CacheEntry {
  key: string;
  vocalsPath: string;
  accompPath: string;
  modelVersion: string;
  createdAt: number;
  size: number;
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root;
}

async function ensureDir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  return root.getDirectoryHandle(name, { create: true });
}

async function loadIndex(): Promise<Map<string, CacheEntry>> {
  const root = await getRoot();
  try {
    const fileHandle = await root.getFileHandle(CACHE_INDEX);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const entries: CacheEntry[] = JSON.parse(text);
    return new Map(entries.map(e => [e.key, e]));
  } catch {
    return new Map();
  }
}

async function saveIndex(index: Map<string, CacheEntry>): Promise<void> {
  const root = await getRoot();
  const fileHandle = await root.getFileHandle(CACHE_INDEX, { create: true });
  const writable = await fileHandle.createWritable();
  const entries = Array.from(index.values());
  await writable.write(JSON.stringify(entries, null, 2));
  await writable.close();
}

/** 生成缓存 key：文件路径 + 模型版本的 hash */
export function cacheKey(fileName: string, fileSize: number, modelVersion = 'v1'): string {
  return `${fileName}_${fileSize}_${modelVersion}`;
}

/** 检查是否已缓存 */
export async function hasCached(key: string): Promise<boolean> {
  const index = await loadIndex();
  const entry = index.get(key);
  if (!entry) return false;

  try {
    const dir = await ensureDir(CACHE_DIR);
    await dir.getFileHandle(entry.vocalsPath);
    await dir.getFileHandle(entry.accompPath);
    return true;
  } catch {
    index.delete(key);
    await saveIndex(index);
    return false;
  }
}

/** 获取缓存的分离结果 */
export async function getCached(key: string): Promise<{ vocals: ArrayBuffer; accompaniment: ArrayBuffer } | null> {
  const index = await loadIndex();
  const entry = index.get(key);
  if (!entry) return null;

  try {
    const dir = await ensureDir(CACHE_DIR);
    const vFile = await (await dir.getFileHandle(entry.vocalsPath)).getFile();
    const aFile = await (await dir.getFileHandle(entry.accompPath)).getFile();
    return {
      vocals: await vFile.arrayBuffer(),
      accompaniment: await aFile.arrayBuffer(),
    };
  } catch {
    return null;
  }
}

/** 写入缓存 */
export async function setCache(
  key: string,
  vocals: ArrayBuffer,
  accompaniment: ArrayBuffer,
  modelVersion = 'v1',
): Promise<void> {
  const dir = await ensureDir(CACHE_DIR);
  const vocalsPath = `vocals_${key}.wav`;
  const accompPath = `accomp_${key}.wav`;

  for (const [n, d] of [[vocalsPath, vocals], [accompPath, accompaniment]] as const) {
    const handle = await dir.getFileHandle(n, { create: true });
    const writable = await handle.createWritable();
    await writable.write(d);
    await writable.close();
  }

  const index = await loadIndex();
  index.set(key, {
    key,
    vocalsPath,
    accompPath,
    modelVersion,
    createdAt: Date.now(),
    size: vocals.byteLength + accompaniment.byteLength,
  });
  await saveIndex(index);
}

/** LRU 清理：超出 maxSize 字节时删除最旧的条目 */
export async function cleanupCache(maxSize = 500 * 1024 * 1024): Promise<void> {
  const index = await loadIndex();
  let totalSize = 0;
  const sorted = Array.from(index.values()).sort((a, b) => b.createdAt - a.createdAt);

  for (const entry of sorted) totalSize += entry.size;
  if (totalSize <= maxSize) return;

  const dir = await ensureDir(CACHE_DIR);
  for (const entry of sorted) {
    if (totalSize <= maxSize) break;
    try {
      await dir.removeEntry(entry.vocalsPath);
      await dir.removeEntry(entry.accompPath);
    } catch { /* ignore */ }
    index.delete(entry.key);
    totalSize -= entry.size;
  }
  await saveIndex(index);
}
