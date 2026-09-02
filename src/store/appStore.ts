/**
 * 全局状态管理 — Zustand
 * 覆盖：歌单、播放器、K歌、标签、搜索、持久化
 */

import { create } from 'zustand';
import type { LyricLine } from '../services/lyrics';
import {
  getAllSongs, addSong, removeSong, updateSong,
  getSetting, setSetting,
  type SongRecord,
} from '../db';

// ========== 类型 ==========

export const DEFAULT_TAGS = [
  '喜欢',
  '女声',
  '男声',
  '粤语',
  '英文',
  '迪斯科',
  '钢琴',
  '静谧',
  '激情',
];

function refreshAllTags(songs: SongInfo[]): string[] {
  return [...new Set([...DEFAULT_TAGS, ...songs.flatMap(s => s.tags)])];
}

export interface SongInfo {
  id: string;
  name: string;
  artist: string;
  fileName: string;
  fileSize: number;
  duration: number;
  tags: string[];
  lyricsText: string;
  hasSeparation: boolean;
  isFavorited: boolean;
  createdAt: number;
  audioData: ArrayBuffer;
}

export interface AppState {
  // ---- 歌单 ----
  songs: SongInfo[];
  searchQuery: string;
  filterTag: string[];
  loading: boolean;
  importing: boolean;

  // ---- 播放器 ----
  selectedSongId: string | null;
  currentTime: number;
  isPlaying: boolean;
  lyrics: LyricLine[];
  currentLyricIndex: number;

  // ---- K歌 ----
  vocalsVolume: number;
  accompVolume: number;
  eqGains: number[]; // 5 段
  micEnabled: boolean;
  micVolume: number;
  echoDelay: number;
  metronomeEnabled: boolean;
  metronomeBpm: number;
  metronomeVolume: number;
  metronomeSound: 'tick' | 'drums';

  // ---- UI ----
  viewMode: 'list' | 'player'; // 竖屏导航

  // ---- 标签 ----
  allTags: string[];

  // ---- Actions ----
  // 初始化
  loadFromDB: () => Promise<void>;

  // 歌单
  importSongs: (files: File[]) => Promise<void>;
  setImporting: (importing: boolean) => void;
  deleteSong: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  updateSongInfo: (id: string, fields: { name?: string; artist?: string }) => Promise<void>;
  updateSongTags: (id: string, tags: string[]) => Promise<void>;
  updateSongLyrics: (id: string, lyricsText: string) => Promise<void>;

  // 搜索 / 过滤
  setSearchQuery: (q: string) => void;
  setFilterTag: (tags: string[]) => void;

  // 播放器
  selectSong: (id: string | null) => void;
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setLyrics: (lines: LyricLine[]) => void;
  setCurrentLyricIndex: (i: number) => void;

  // K歌
  setVocalsVolume: (v: number) => void;
  setAccompVolume: (v: number) => void;
  setEQGain: (index: number, value: number) => void;
  setMicEnabled: (e: boolean) => void;
  setMicVolume: (v: number) => void;
  setEchoDelay: (ms: number) => void;
  setMetronomeEnabled: (e: boolean) => void;
  setMetronomeBpm: (bpm: number) => void;
  setMetronomeVolume: (v: number) => void;
  setMetronomeSound: (s: 'tick' | 'drums') => void;

  // UI
  setViewMode: (m: 'list' | 'player') => void;

  // 帮助
  getFilteredSongs: () => SongInfo[];
  getSelectedSong: () => SongInfo | undefined;
}

function songRecordToInfo(r: SongRecord): SongInfo {
  return {
    id: r.id,
    name: r.name,
    artist: r.artist,
    fileName: r.fileName,
    fileSize: r.fileSize,
    duration: r.duration,
    tags: r.tags || [],
    lyricsText: r.lyricsText || '',
    hasSeparation: r.hasSeparation || false,
    isFavorited: r.isFavorited || false,
    createdAt: r.createdAt,
    audioData: r.audioData,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  // ---- 初始值 ----
  songs: [],
  searchQuery: '',
  filterTag: [],
  loading: false,
  importing: false,

  selectedSongId: null,
  currentTime: 0,
  isPlaying: false,
  lyrics: [],
  currentLyricIndex: -1,

  vocalsVolume: 1,
  accompVolume: 1,
  eqGains: [0, 0, 0, 0, 0],
  micEnabled: false,
  micVolume: 0.5,
  echoDelay: 0,
  metronomeEnabled: false,
  metronomeBpm: 120,
  metronomeVolume: 0.5,
  metronomeSound: 'drums',

  viewMode: 'list',
  allTags: DEFAULT_TAGS,

  // ========== 初始化 ==========
  loadFromDB: async () => {
    set({ loading: true });
    try {
      const records = await getAllSongs();
      const songs = records.map(songRecordToInfo);

      // 恢复设置（兼容旧版 9 段 EQ，截取/补零到 5 段）
      const savedEQ = await getSetting<number[]>('eqGains', [0, 0, 0, 0, 0]) ?? [0, 0, 0, 0, 0];
      const normalizedEQ = savedEQ.length === 5
        ? savedEQ
        : [...savedEQ, ...Array(5 - savedEQ.length).fill(0)].slice(0, 5);

      const savedVol = await getSetting<number>('vocalsVolume', 1);
      const savedAccomp = await getSetting<number>('accompVolume', 1);
      const savedMicVol = await getSetting<number>('micVolume', 0.5);
      const savedEchoDelay = await getSetting<number>('echoDelay', 0);
      const savedBpm = await getSetting<number>('metronomeBpm', 120);
      const savedMetVol = await getSetting<number>('metronomeVolume', 0.5);
      const savedMetSound = await getSetting<'tick' | 'drums'>('metronomeSound', 'drums');

      set({
        songs,
        allTags: refreshAllTags(songs),
        eqGains: normalizedEQ,
        vocalsVolume: savedVol,
        accompVolume: savedAccomp,
        micVolume: savedMicVol,
        echoDelay: savedEchoDelay,
        metronomeBpm: savedBpm,
        metronomeVolume: savedMetVol,
        metronomeSound: savedMetSound,
        loading: false,
      });
    } catch (err) {
      console.error('Failed to load from DB:', err);
      set({ loading: false });
    }
  },

  // ========== 歌单 ==========
  importSongs: async (files: File[]) => {
    set({ importing: true });
    const state = get();
    const newSongs: SongInfo[] = [];

    try {
    for (const file of files) {
      // 检查是否已存在（按文件名+大小）
      const exists = state.songs.find(s => s.fileName === file.name && s.fileSize === file.size);
      if (exists) continue;

      const id = crypto.randomUUID();
      const arrayBuffer = await file.arrayBuffer();
      const name = file.name.replace(/\.[^.]+$/, '');

      // 尝试检测音频时长
      let duration = 0;
      try {
        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        duration = audioBuffer.duration;
        audioCtx.close();
      } catch { /* 忽略 */ }

      const song: SongInfo = {
        id,
        name,
        artist: '',
        fileName: file.name,
        fileSize: file.size,
        duration,
        tags: [],
        lyricsText: '',
        hasSeparation: false,
        isFavorited: false,
        createdAt: Date.now(),
        audioData: arrayBuffer,
      };

      await addSong({
        ...song,
        tags: [],
        lyricsText: '',
        hasSeparation: false,
        isFavorited: false,
        duration,
        createdAt: song.createdAt,
        audioData: arrayBuffer,
      });

      newSongs.push(song);
    }

    const updatedSongs = [...state.songs, ...newSongs];
    set({ songs: updatedSongs, allTags: refreshAllTags(updatedSongs) });
    } finally {
      set({ importing: false });
    }
  },

  setImporting: (importing: boolean) => set({ importing }),

  deleteSong: async (id: string) => {
    await removeSong(id);
    const state = get();
    const songs = state.songs.filter(s => s.id !== id);
    set({
      songs,
      allTags: refreshAllTags(songs),
      selectedSongId: state.selectedSongId === id ? null : state.selectedSongId,
    });
  },

  toggleFavorite: async (id: string) => {
    const song = get().songs.find(s => s.id === id);
    if (!song) return;
    const newVal = !song.isFavorited;
    await updateSong(id, { isFavorited: newVal });
    set({ songs: get().songs.map(s => s.id === id ? { ...s, isFavorited: newVal } : s) });
  },

  updateSongInfo: async (id: string, fields: { name?: string; artist?: string }) => {
    await updateSong(id, fields);
    set({ songs: get().songs.map(s => s.id === id ? { ...s, ...fields } : s) });
  },

  updateSongTags: async (id: string, tags: string[]) => {
    await updateSong(id, { tags });
    const updatedSongs = get().songs.map(s => s.id === id ? { ...s, tags } : s);
    set({ songs: updatedSongs, allTags: refreshAllTags(updatedSongs) });
  },

  updateSongLyrics: async (id: string, lyricsText: string) => {
    await updateSong(id, { lyricsText });
    const state = get();
    const updatedSongs = state.songs.map(s => s.id === id ? { ...s, lyricsText } : s);
    set({ songs: updatedSongs });
    if (state.selectedSongId === id) {
      const { parseLRC } = await import('../services/lyrics');
      const { lines } = parseLRC(lyricsText);
      set({ lyrics: lines });
    }
  },

  // ========== 搜索 / 过滤 ==========
  setSearchQuery: (q: string) => set({ searchQuery: q }),
  setFilterTag: (tags: string[]) => set({ filterTag: tags }),

  // ========== 播放器 ==========
  selectSong: (id: string | null) => set({ selectedSongId: id }),
  setCurrentTime: (t: number) => set({ currentTime: t }),
  setPlaying: (p: boolean) => set({ isPlaying: p }),
  setLyrics: (lines: LyricLine[]) => set({ lyrics: lines }),
  setCurrentLyricIndex: (i: number) => set({ currentLyricIndex: i }),

  // ========== K歌 ==========
  setVocalsVolume: (v: number) => {
    set({ vocalsVolume: v });
    setSetting('vocalsVolume', v);
  },
  setAccompVolume: (v: number) => {
    set({ accompVolume: v });
    setSetting('accompVolume', v);
  },
  setEQGain: (index: number, value: number) => {
    const gains = [...get().eqGains];
    gains[index] = value;
    set({ eqGains: gains });
    setSetting('eqGains', gains);
  },
  setMicEnabled: (e: boolean) => set({ micEnabled: e }),
  setMicVolume: (v: number) => {
    set({ micVolume: v });
    setSetting('micVolume', v);
  },
  setEchoDelay: (ms: number) => {
    set({ echoDelay: ms });
    setSetting('echoDelay', ms);
  },
  setMetronomeEnabled: (e: boolean) => set({ metronomeEnabled: e }),
  setMetronomeBpm: (bpm: number) => {
    set({ metronomeBpm: bpm });
    setSetting('metronomeBpm', bpm);
  },
  setMetronomeVolume: (v: number) => {
    set({ metronomeVolume: v });
    setSetting('metronomeVolume', v);
  },
  setMetronomeSound: (s: 'tick' | 'drums') => {
    set({ metronomeSound: s });
    setSetting('metronomeSound', s);
  },

  // ========== UI ==========
  setViewMode: (m: 'list' | 'player') => set({ viewMode: m }),

  // ========== 帮助 ==========
  getFilteredSongs: () => {
    const { songs, searchQuery, filterTag } = get();
    let result = songs;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.fileName.toLowerCase().includes(q)
      );
    }

    if (filterTag.length > 0) {
      result = result.filter(s => filterTag.some(t => s.tags.includes(t)));
    }

    return result;
  },

  getSelectedSong: () => {
    const { songs, selectedSongId } = get();
    return songs.find(s => s.id === selectedSongId);
  },
}));
