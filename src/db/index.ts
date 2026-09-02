/**
 * IndexedDB 数据库层 — 基于 Dexie.js
 * 存储歌曲音频、歌词、标签、设置等
 */

import Dexie, { type EntityTable } from 'dexie';

/** 歌曲数据模型（持久化到 IndexedDB） */
export interface SongRecord {
  id: string;
  name: string;
  artist: string;
  fileName: string;
  fileSize: number;
  duration: number;
  tags: string[];
  lyricsText: string;
  audioData: ArrayBuffer; // 原始音频文件数据
  hasSeparation: boolean;
  isFavorited: boolean;
  createdAt: number;
}

/** 设置键值对 */
export interface SettingsRecord {
  key: string;
  value: unknown;
}

/** 人声分离缓存记录 */
export interface SeparationCacheRecord {
  id: string;   // songId + stem
  songId: string;
  stem: 'vocals' | 'accompaniment' | 'drums' | 'bass' | 'other';
  data: ArrayBuffer;
  createdAt: number;
}

class KaraokeDB extends Dexie {
  songs!: EntityTable<SongRecord, 'id'>;
  settings!: EntityTable<SettingsRecord, 'key'>;
  separationCache!: EntityTable<SeparationCacheRecord, 'id'>;

  constructor() {
    super('KaraokeDB');
    this.version(2).stores({
      songs: 'id, name, artist, createdAt, *tags',
      settings: 'key',
      separationCache: 'id, songId, stem',
    });
  }
}

export const db = new KaraokeDB();

// ========== 歌曲 CRUD ==========

export async function getAllSongs(): Promise<SongRecord[]> {
  return db.songs.orderBy('createdAt').reverse().toArray();
}

export async function getSong(id: string): Promise<SongRecord | undefined> {
  return db.songs.get(id);
}

export async function addSong(song: SongRecord): Promise<string> {
  await db.songs.put(song);
  return song.id;
}

export async function removeSong(id: string): Promise<void> {
  await db.songs.delete(id);
  // 同时删除缓存
  await db.separationCache.where('songId').equals(id).delete();
}

export async function updateSong(id: string, updates: Partial<Omit<SongRecord, 'id'>>): Promise<void> {
  await db.songs.update(id, updates);
}

export async function searchSongs(query: string): Promise<SongRecord[]> {
  const q = query.toLowerCase();
  const all = await getAllSongs();
  return all.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.artist.toLowerCase().includes(q) ||
    s.fileName.toLowerCase().includes(q)
  );
}

export async function getSongsByTag(tag: string): Promise<SongRecord[]> {
  const all = await getAllSongs();
  return all.filter(s => s.tags.includes(tag));
}

export async function getAllTags(): Promise<string[]> {
  const all = await getAllSongs();
  const tagSet = new Set<string>();
  for (const s of all) {
    for (const t of s.tags) tagSet.add(t);
  }
  return Array.from(tagSet).sort();
}

// ========== 设置 CRUD ==========

export async function getSetting<T = unknown>(key: string, fallback?: T): Promise<T | undefined> {
  const record = await db.settings.get(key);
  return record ? (record.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

// ========== 分离缓存 CRUD ==========

export async function getSeparationCache(songId: string, stem: string): Promise<ArrayBuffer | null> {
  const records = await db.separationCache
    .where({ songId, stem: stem as SeparationCacheRecord['stem'] })
    .toArray();
  return records.length > 0 ? records[0].data : null;
}

export async function setSeparationCache(songId: string, stem: string, data: ArrayBuffer): Promise<void> {
  const id = `${songId}_${stem}`;
  await db.separationCache.put({
    id,
    songId,
    stem: stem as SeparationCacheRecord['stem'],
    data,
    createdAt: Date.now(),
  });
}

// ========== 存储空间 ==========

export async function getStorageUsage(): Promise<number> {
  if ('storage' in navigator) {
    const estimate = await navigator.storage.estimate();
    return estimate.usage ?? 0;
  }
  return 0;
}

export async function getStorageQuota(): Promise<number> {
  if ('storage' in navigator) {
    const estimate = await navigator.storage.estimate();
    return estimate.quota ?? 0;
  }
  return 0;
}
