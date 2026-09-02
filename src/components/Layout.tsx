import { useEffect, useState, useMemo, useRef } from 'react';
import { create } from 'zustand';
import {
  Music, Globe, MoreHorizontal, Search, X, Tag,
  Trash2, Mic, Play, Pause, SkipBack, SkipForward,
  Music2, ChevronDown, Upload, Save, PlusCircle,
  FileText,
  ListMusic, Repeat, Repeat1, Shuffle, Pencil, Plus, Minus,
  ExternalLink,
} from 'lucide-react';
import { separateSong, loadSeparationResult, getCurrentJob, subscribeSeparation } from '../demucs/separation';
import { getAudioEngine } from '../engine/AudioEngine';
import { PlayModeDrawer } from './PlayModeDrawer';
import { KaraokeDrawer } from './KaraokeDrawer';
import { MusicCurve, type MusicCurveRef } from './MusicCurve';
import { Toast } from './Toast';
import { ColorBar } from './ColorBar';
import { useAppStore, type SongInfo } from '../store/appStore';
import { searchLyrics, downloadLyrics, parseLRC, type LRCSearchResult } from '../services/lyrics';

const loadSongAudio = async (song: SongInfo, engine: ReturnType<typeof getAudioEngine>) => {
  await engine.loadAudioBuffer(song.audioData);
  if (song.hasSeparation) {
    const cached = await loadSeparationResult(song.id);
    if (cached) {
      await engine.setVocalsBuffer(cached.vocals);
      await engine.setAccompanimentBuffer(cached.accompaniment);
    }
  }
};

// ========== 主布局 ==========

export default function Layout() {
  const [tab, setTab] = useState<'songs' | 'resources' | 'more'>('songs');
  const loadFromDB = useAppStore(s => s.loadFromDB);
  const loading = useAppStore(s => s.loading);

  useEffect(() => {
    loadFromDB();
  }, [loadFromDB]);

  if (loading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <Music2 className="w-12 h-12 text-indigo-400 animate-pulse mx-auto mb-3" />
          <p className="text-slate-400 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-slate-900 text-white overflow-hidden">
      {/* 主内容 */}
      <div className="flex-1 overflow-hidden">
        {tab === 'songs' && <SongsTab />}
        {tab === 'resources' && <ResourcesTab />}
        {tab === 'more' && <MoreTab />}
      </div>

      {/* 底部标签栏 */}
      <nav className="flex border-t border-slate-800 bg-slate-900/95 backdrop-blur-xl">
        {[
          { k: 'songs', icon: Music, label: '歌单' },
          { k: 'resources', icon: Globe, label: '资源' },
          { k: 'more', icon: MoreHorizontal, label: '更多' },
        ].map(({ k, icon: Icon, label }) => (
          <button
            key={k}
            onClick={() => {
              setTab(k as typeof tab);
              useAppStore.getState().setViewMode('list');
            }}
            className={`flex-1 flex flex-col items-center justify-center py-2.5 transition-colors ${
              tab === k ? 'text-indigo-400' : 'text-slate-600'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] mt-0.5">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ========== 歌单标签页 ==========

function SongsTab() {
  const selectedSongId = useAppStore(s => s.selectedSongId);
  const viewMode = useAppStore(s => s.viewMode);
  const isLandscape = useMediaQuery('(min-width: 768px) and (orientation: landscape)');
  const [listWidth, setListWidth] = useState(() => {
    if (typeof window === 'undefined') return 320;
    return Math.min(480, Math.max(220, Number(localStorage.getItem('karaoke-list-width')) || 320));
  });
  const resizingRef = useRef(false);
  const widthRef = useRef(listWidth);

  useEffect(() => {
    widthRef.current = listWidth;
  }, [listWidth]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const width = Math.min(480, Math.max(220, e.clientX));
      widthRef.current = width;
      setListWidth(width);
    };
    const handleUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        if (typeof window !== 'undefined') {
          localStorage.setItem('karaoke-list-width', String(widthRef.current));
        }
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  if (!selectedSongId) return <SongListView />;

  if (isLandscape) {
    return (
      <div className="flex h-full">
        <div
          className="border-r border-slate-800 overflow-hidden flex-shrink-0 flex flex-col"
          style={{ width: listWidth, minWidth: 220, maxWidth: 480 }}
        >
          <SongListView />
        </div>
        <div
          onMouseDown={() => { resizingRef.current = true; }}
          className="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-indigo-500/30 active:bg-indigo-500/50 transition-colors"
          title="拖动调整宽度"
        />
        <div className="flex-1 overflow-hidden">
          <PlayerView />
        </div>
      </div>
    );
  }

  return viewMode === 'player' ? <PlayerView /> : <SongListView />;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// ========== 歌单列表 ==========

function SongListView() {
  const searchQuery = useAppStore(s => s.searchQuery);
  const setSearchQuery = useAppStore(s => s.setSearchQuery);
  const filterTag = useAppStore(s => s.filterTag);
  const setFilterTag = useAppStore(s => s.setFilterTag);
  const allTags = useAppStore(s => s.allTags);
  const songs = useAppStore(s => s.songs);
  const importSongs = useAppStore(s => s.importSongs);
  const importing = useAppStore(s => s.importing);
  const selectSong = useAppStore(s => s.selectSong);
  const setViewMode = useAppStore(s => s.setViewMode);

  // 标签区域拖动滚动
  const tagScrollRef = useRef<HTMLDivElement>(null);
  const tagDragStartX = useRef(0);
  const tagScrollStartX = useRef(0);
  const tagDragMoved = useRef(false);

  const handleTagPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!tagScrollRef.current) return;
    tagDragStartX.current = e.clientX;
    tagScrollStartX.current = tagScrollRef.current.scrollLeft;
    tagDragMoved.current = false;
  };

  const handleTagPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!tagScrollRef.current) return;
    const dx = e.clientX - tagDragStartX.current;
    if (!tagDragMoved.current && Math.abs(dx) > 5) {
      tagDragMoved.current = true;
      tagScrollRef.current.setPointerCapture(e.pointerId);
      tagScrollRef.current.style.cursor = 'grabbing';
    }
    if (tagDragMoved.current) {
      tagScrollRef.current.scrollLeft = tagScrollStartX.current - dx;
    }
  };

  const handleTagPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tagScrollRef.current && tagDragMoved.current) {
      tagScrollRef.current.releasePointerCapture(e.pointerId);
      tagScrollRef.current.style.cursor = '';
    }
    tagDragMoved.current = false;
  };

  const filteredSongs = useMemo(() => {
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
  }, [songs, searchQuery, filterTag]);

  const handleImport = async () => {
    try {
      const files = await selectAudioFiles();
      if (files.length) await importSongs(files);
    } catch { /* cancelled */ }
  };

  const handleSongClick = async (song: SongInfo) => {
    const engine = getAudioEngine();
    const previousId = useAppStore.getState().selectedSongId;
    selectSong(song.id);
    setViewMode('player');
    if (previousId === song.id) {
      console.log('[Layout] handleSongClick: same song selected, keep/resume playback', song.id);
      if (!useAppStore.getState().isPlaying) {
        try {
          const ctx = engine.getAudioContext();
          if (ctx && ctx.state === 'suspended') {
            await ctx.resume();
          }
          engine.play();
          useAppStore.getState().setPlaying(true);
        } catch (e) {
          console.error('[Layout] resume failed:', e);
        }
      }
    } else {
      console.log('[Layout] handleSongClick: switch song', { from: previousId, to: song.id });
      engine.stop();
      useAppStore.getState().setPlaying(false);
      try {
        await loadSongAudio(song, engine);
        const ctx = engine.getAudioContext();
        if (ctx && ctx.state === 'suspended') {
          await ctx.resume();
        }
        engine.play();
        useAppStore.getState().setPlaying(true);
      } catch (e) {
        console.error('[Layout] failed to load audio:', e);
      }
    }
    if (song.lyricsText) {
      const { lines } = parseLRC(song.lyricsText);
      useAppStore.getState().setLyrics(lines);
    } else {
      useAppStore.getState().setLyrics([]);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 pb-2 flex-shrink-0">
        {/* Header Banner */}
        <ColorBar className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center flex-shrink-0">
                <Music2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white leading-tight">乐曲 · Karaoke</h1>
                <p className="text-xs text-white/70">你的音乐，随心唱</p>
              </div>
            </div>
            <button onClick={handleImport} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur text-white text-xs px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
              <Upload className="w-3.5 h-3.5" />导入
            </button>
          </div>
        </ColorBar>
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索歌曲、歌手、文件名..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"><X className="w-4 h-4" /></button>}
        </div>
        {allTags.length > 0 && (
          <div
            ref={tagScrollRef}
            onPointerDown={handleTagPointerDown}
            onPointerMove={handleTagPointerMove}
            onPointerUp={handleTagPointerUp}
            onPointerLeave={handleTagPointerUp}
            className="flex items-center gap-1.5 overflow-x-auto pb-1 cursor-grab active:cursor-grabbing select-none [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none', touchAction: 'pan-y' }}
          >
            <button onClick={() => setFilterTag([])}
              className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${filterTag.length === 0 ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>全部</button>
            {allTags.map(tag => (
              <button key={tag} onClick={() => {
                if (tagDragMoved.current) return;
                if (filterTag.includes(tag)) {
                  setFilterTag(filterTag.filter(t => t !== tag));
                } else {
                  setFilterTag([...filterTag, tag]);
                }
              }}
                className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${filterTag.includes(tag) ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{tag}</button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2">
        {filteredSongs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-600">
            <Music className="w-12 h-12 mb-3 opacity-50" />
            {searchQuery ? <p className="text-sm">没有找到匹配的歌曲</p> : (
              <><p className="text-sm mb-3">歌单为空</p><button onClick={handleImport} className="text-sm text-indigo-400 hover:text-indigo-300">点击导入本地音乐</button></>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredSongs.map(song => (
              <SongItem key={song.id} song={song} onClick={() => handleSongClick(song)} />
            ))}
          </div>
        )}
      </div>

      {/* 导入中遮罩 */}
      {importing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="px-6 py-3 bg-slate-800/90 rounded-xl shadow-lg">
            <p className="text-sm text-slate-100">加载中</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SongItem({ song, onClick }: { song: SongInfo; onClick: () => void }) {
  const deleteSong = useAppStore(s => s.deleteSong);
  const selectedSongId = useAppStore(s => s.selectedSongId);
  const isActive = selectedSongId === song.id;

  const formatDuration = (s: number) => {
    if (!s) return '--:--';
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const subtitle = [
    song.artist || song.fileName,
    song.duration > 0 ? formatDuration(song.duration) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`播放 ${song.name}`}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors relative ${
        isActive ? 'bg-indigo-500/20 border border-indigo-500/30' : 'hover:bg-slate-800/60 border border-transparent'
      }`}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-indigo-500' : 'bg-slate-700'}`}>
        <Music2 className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isActive ? 'text-indigo-300' : 'text-white'}`}>{song.name}</p>
        <p className="text-xs text-slate-500 truncate">{subtitle}</p>
        {song.tags.length > 0 && (
          <div className="flex gap-1 mt-0.5 overflow-hidden">
            {song.tags.slice(0, 3).map(t => <span key={t} className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">{t}</span>)}
            {song.tags.length > 3 && <span className="text-[10px] text-slate-600">+{song.tags.length - 3}</span>}
          </div>
        )}
      </div>
      <div className={`flex items-center gap-0.5 ${isActive ? 'flex' : 'hidden'}`}>
        <button onClick={e => { e.stopPropagation(); if (confirm(`删除 "${song.name}"？`)) deleteSong(song.id); }} className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-slate-800 rounded-md transition-colors">
          <Trash2 className="w-4 h-4 pointer-events-none" />
        </button>
      </div>
    </div>
  );
}

// ========== 编辑歌曲弹窗 ==========

// 简单的编辑状态（非持久化）
interface EditingState {
  editingSongId: string | null;
  setEditingSong: (id: string | null) => void;
}
const useEditingSongStore = create<EditingState>(set => ({
  editingSongId: null,
  setEditingSong: (id: string | null) => set({ editingSongId: id }),
}));

function SongDetailDrawer() {
  const editingSongId = useEditingSongStore(s => s.editingSongId);
  const setEditingSong = useEditingSongStore(s => s.setEditingSong);
  const song = useAppStore(s => s.songs.find(sg => sg.id === editingSongId));
  const updateSongInfo = useAppStore(s => s.updateSongInfo);
  const updateSongTags = useAppStore(s => s.updateSongTags);
  const updateSongLyrics = useAppStore(s => s.updateSongLyrics);
  const allTags = useAppStore(s => s.allTags);

  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  const [lyricsMode, setLyricsMode] = useState<'import' | 'online'>('online');
  const [lyricsSearchResults, setLyricsSearchResults] = useState<LRCSearchResult[]>([]);
  const [lyricsSearchLoading, setLyricsSearchLoading] = useState(false);
  const [lyricsSearchQuery, setLyricsSearchQuery] = useState('');
  const [toast, setToast] = useState({ message: '', visible: false });

  // 抽屉动画状态
  const [show, setShow] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (editingSongId && song) {
      setName(song.name);
      setArtist(song.artist);
      setTags([...song.tags]);
      setNewTag('');
      setShowTagSuggestions(false);
      setLyricsMode('online');
      setLyricsSearchResults([]);
      setLyricsSearchLoading(false);
      setLyricsSearchQuery(song.name + (song.artist ? ` ${song.artist}` : ''));
      setShow(true);
      requestAnimationFrame(() => setIsOpen(true));
    }
  }, [editingSongId, song]);

  if (!show || !song) return null;

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(() => {
      setShow(false);
      setEditingSong(null);
    }, 300);
  };

  const handleSave = async () => {
    if (name !== song.name || artist !== song.artist) {
      await updateSongInfo(song.id, { name, artist });
    }
    await updateSongTags(song.id, tags);
    handleClose();
  };

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setNewTag('');
    setShowTagSuggestions(false);
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleImportLyrics = async () => {
    try {
      const file = await selectFile('.lrc, .txt, text/plain');
      const text = await file.text();
      await updateSongLyrics(song.id, text);
      const { lines } = parseLRC(text);
      if (useAppStore.getState().selectedSongId === song.id) {
        useAppStore.getState().setLyrics(lines);
      }
      setLyricsSearchResults([]);
    } catch { /* cancelled */ }
  };

  const showToast = (message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 2500);
  };

  const handleSearchLyrics = async (query?: string) => {
    const q = query?.trim() || lyricsSearchQuery.trim() || song.name;
    setLyricsSearchLoading(true);
    setLyricsSearchResults([]);
    try {
      const results = await searchLyrics(q);
      if (results.length === 0) {
        showToast('未找到歌词，请尝试其他关键词');
      } else {
        setLyricsSearchResults(results);
      }
    } catch (err) {
      console.error('歌词搜索失败:', err);
      showToast('歌词搜索失败，请稍后重试');
    } finally {
      setLyricsSearchLoading(false);
    }
  };

  const handleDownloadLyrics = async (result: LRCSearchResult) => {
    const text = downloadLyrics(result);
    await updateSongLyrics(song.id, text);
    setLyricsSearchResults([]);
  };

  const suggestions = allTags.filter(t => !tags.includes(t) && t.toLowerCase().includes(newTag.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" onClick={handleClose}>
      <div className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`absolute inset-y-0 right-0 w-full sm:max-w-md bg-slate-800 border-l border-slate-700 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0">
          <h2 className="text-lg font-bold">编辑歌曲信息</h2>
          <button onClick={handleClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 flex flex-col overflow-hidden p-4">
          <div className="flex-shrink overflow-y-auto space-y-4">
            {/* 封面 */}
            <div className="flex items-center gap-3 pb-3 border-b border-slate-700">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                <Music2 className="w-7 h-7 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{song.fileName}</p>
                <p className="text-xs text-slate-500">{formatFileSize(song.fileSize)} · {formatDuration(song.duration)}</p>
                <p className="text-xs text-slate-600 mt-0.5">创建时间: {new Date(song.createdAt).toLocaleString()}</p>
              </div>
            </div>

            {/* 歌曲信息 */}
            <div className="space-y-2">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="歌曲名"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={artist}
                onChange={e => setArtist(e.target.value)}
                placeholder="歌手"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* 标签管理 */}
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                <Tag className="w-4 h-4" />标签
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 bg-indigo-500/20 text-indigo-300 text-xs px-2 py-1 rounded-full">
                    {tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-white"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="relative">
                <div className="flex gap-2">
                  <input
                    type="text" value={newTag} onChange={e => { setNewTag(e.target.value); setShowTagSuggestions(true); }}
                    onKeyDown={e => { if (e.key === 'Enter') addTag(newTag); }}
                    placeholder="输入标签名称..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    onFocus={() => setShowTagSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
                  />
                  <button onClick={() => addTag(newTag)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors">
                    <PlusCircle className="w-4 h-4" />
                  </button>
                </div>
                {showTagSuggestions && newTag && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-lg z-10 py-1">
                    {suggestions.slice(0, 5).map(s => (
                      <button key={s} className="w-full px-3 py-1.5 text-sm text-left text-slate-300 hover:bg-slate-800" onMouseDown={() => addTag(s)}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
              {allTags.filter(t => !tags.includes(t)).length > 0 && !newTag && (
                <div className="mt-2">
                  <p className="text-[10px] text-slate-600 mb-1">已有标签</p>
                  <div className="flex flex-wrap gap-1">
                    {allTags.filter(t => !tags.includes(t)).map(t => (
                      <button key={t} onClick={() => addTag(t)} className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full hover:bg-slate-600">{t}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 歌词导入 */}
            <div>
              <label className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                <FileText className="w-4 h-4" />歌词
              </label>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setLyricsMode('online')}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${lyricsMode === 'online' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
                >
                  在线搜索
                </button>
                <button
                  onClick={() => setLyricsMode('import')}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${lyricsMode === 'import' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}
                >
                  导入 LRC
                </button>
              </div>

              {lyricsMode === 'import' ? (
                <button onClick={handleImportLyrics} className="w-full border border-dashed border-slate-700 rounded-lg p-3 text-sm text-slate-500 hover:text-indigo-400 hover:border-indigo-500/50 transition-colors">
                  导入 LRC 文件
                </button>
              ) : (
                <>
                  {song.lyricsText && (
                    <div className="mb-2 flex items-center justify-between bg-slate-900 rounded-lg p-2.5">
                      <span className="text-sm text-green-400">已导入 ({song.lyricsText.split('\n').filter(Boolean).length} 行)</span>
                      <button onClick={() => handleSearchLyrics()} className="text-xs text-indigo-400 hover:text-indigo-300">更换</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={lyricsSearchQuery}
                      onChange={e => setLyricsSearchQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSearchLyrics(lyricsSearchQuery); }}
                      placeholder="搜索歌词..."
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                    <button onClick={() => handleSearchLyrics(lyricsSearchQuery)} disabled={lyricsSearchLoading} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 rounded-lg text-sm transition-colors">
                      {lyricsSearchLoading ? '搜索中...' : '搜索'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 歌曲信息 */}
            {song.hasSeparation && (
              <div className="space-y-2 pt-2 border-t border-slate-700">
                <p className="text-xs text-green-500">已分离人声/伴奏</p>
              </div>
            )}
          </div>

          {/* 歌词搜索结果：自适应填充剩余高度 */}
          {lyricsMode === 'online' && lyricsSearchResults.length > 0 && (
            <div className="flex-1 min-h-0 mt-4 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg">
              {lyricsSearchResults.map(r => (
                <button
                  key={r.id}
                  onClick={() => handleDownloadLyrics(r)}
                  className="w-full px-3 py-2 text-left hover:bg-slate-800 border-b border-slate-800 last:border-0 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-200 truncate">{r.trackName}</span>
                    <span className="text-xs text-slate-500">{r.isSynced ? '同步' : '普通'}</span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {r.artistName} {r.duration > 0 && `· ${formatDuration(r.duration)}`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="p-4 border-t border-slate-700 flex gap-2 flex-shrink-0">
          <button onClick={handleClose} className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors">取消</button>
          <button onClick={handleSave} className="flex-1 py-2.5 bg-indigo-500 hover:bg-indigo-400 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1">
            <Save className="w-4 h-4" />保存
          </button>
        </div>

        <Toast message={toast.message} visible={toast.visible} onClose={() => setToast(prev => ({ ...prev, visible: false }))} />
      </div>
    </div>
  );
}

// ========== 播放器视图 ==========

function PlayerView() {
  const selectedSong = useAppStore(s => s.getSelectedSong());
  const selectSong = useAppStore(s => s.selectSong);
  const songs = useAppStore(s => s.songs);
  const setViewMode = useAppStore(s => s.setViewMode);
  const isPlaying = useAppStore(s => s.isPlaying);
  const setPlaying = useAppStore(s => s.setPlaying);
  const currentTime = useAppStore(s => s.currentTime);
  const setCurrentTime = useAppStore(s => s.setCurrentTime);
  const lyrics = useAppStore(s => s.lyrics);
  const setLyrics = useAppStore(s => s.setLyrics);
  const currentLyricIndex = useAppStore(s => s.currentLyricIndex);
  const setCurrentLyricIndex = useAppStore(s => s.setCurrentLyricIndex);
  const setEditingSong = useEditingSongStore(s => s.setEditingSong);
  const [lyricFontSize, setLyricFontSize] = useState(() => {
    try {
      const v = localStorage.getItem('karaoke-lyric-font-size');
      return v ? Math.max(12, Math.min(32, Number(v))) : 16;
    } catch { return 16; }
  });
  const handleLyricFontSize = (delta: number) => {
    setLyricFontSize(prev => {
      const next = Math.max(12, Math.min(32, prev + delta));
      try { localStorage.setItem('karaoke-lyric-font-size', String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const vocalsVolume = useAppStore(s => s.vocalsVolume);
  const accompVolume = useAppStore(s => s.accompVolume);
  const eqGains = useAppStore(s => s.eqGains);
  const micEnabled = useAppStore(s => s.micEnabled);
  const micVolume = useAppStore(s => s.micVolume);
  const echoDelay = useAppStore(s => s.echoDelay);
  const metronomeEnabled = useAppStore(s => s.metronomeEnabled);
  const metronomeBpm = useAppStore(s => s.metronomeBpm);
  const metronomeVolume = useAppStore(s => s.metronomeVolume);
  const metronomeSound = useAppStore(s => s.metronomeSound);

  const [showKaraokeDrawer, setShowKaraokeDrawer] = useState(false);
  const [playMode, setPlayMode] = useState<'sequential' | 'listCycle' | 'singleRepeat' | 'shuffle'>('sequential');
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const [showPlayModeDrawer, setShowPlayModeDrawer] = useState(false);

  const [separationJob, setSeparationJob] = useState(getCurrentJob);
  useEffect(() => {
    return subscribeSeparation(setSeparationJob);
  }, []);

  const progressRef = useRef<HTMLInputElement>(null);
  const isDraggingRef = useRef(false);
  const currentLyricRef = useRef<HTMLDivElement | null>(null);
  const musicCurveRef = useRef<MusicCurveRef>(null);

  const engine = getAudioEngine();

  // 歌词引用，确保时间同步回调始终使用最新歌词
  const lyricsRef = useRef(lyrics);
  const setCurrentLyricIndexRef = useRef(setCurrentLyricIndex);
  lyricsRef.current = lyrics;
  setCurrentLyricIndexRef.current = setCurrentLyricIndex;

  // 时间同步
  useEffect(() => {
    engine.onTimeUpdate = (t: number) => {
      if (!isDraggingRef.current) setCurrentTime(t);
      if (lyricsRef.current.length > 0) {
        for (let i = lyricsRef.current.length - 1; i >= 0; i--) {
          if (lyricsRef.current[i].start <= t) {
            setCurrentLyricIndexRef.current(i);
            break;
          }
        }
      }
    };
    engine.onEnded = async () => {
      const state = useAppStore.getState();
      const current = state.getSelectedSong();
      const allSongs = state.songs;
      const mode = playModeRef.current;

      if (!current || allSongs.length === 0) {
        setPlaying(false);
        setCurrentTime(0);
        return;
      }

      if (mode === 'singleRepeat') {
        engine.seek(0);
        engine.play();
        setPlaying(true);
        setCurrentTime(0);
        return;
      }

      // 与列表保持相同排序
      const sorted = [...allSongs].sort((a, b) => b.createdAt - a.createdAt);
      const idx = sorted.findIndex(s => s.id === current.id);

      let nextIdx = -1;
      if (mode === 'sequential') nextIdx = idx + 1;
      else if (mode === 'listCycle') nextIdx = (idx + 1) % sorted.length;
      else if (mode === 'shuffle') nextIdx = Math.floor(Math.random() * sorted.length);

      if (nextIdx >= 0 && nextIdx < sorted.length) {
        const next = sorted[nextIdx];
        state.selectSong(next.id);
        engine.stop();
        try {
          await loadSongAudio(next, engine);
          engine.play();
          setPlaying(true);
        } catch (e) {
          console.error('[PlayerView] next song failed:', e);
          setPlaying(false);
          setCurrentTime(0);
        }
      } else {
        // 顺序播放到末尾
        setPlaying(false);
        setCurrentTime(0);
      }
    };
    return () => { engine.onTimeUpdate = undefined; engine.onEnded = undefined; };
  }, [engine, setCurrentTime, setPlaying]);

  // 选中歌曲变化时加载歌词，仅切换歌曲时复位时间/索引，避免更新歌词时打断播放
  const selectedSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedSong) {
      if (selectedSong.lyricsText) {
        const { lines } = parseLRC(selectedSong.lyricsText);
        setLyrics(lines);
      } else {
        setLyrics([]);
      }
      if (selectedSongIdRef.current !== selectedSong.id) {
        selectedSongIdRef.current = selectedSong.id;
        setCurrentLyricIndex(-1);
        setCurrentTime(0);
      }
    }
  }, [selectedSong, setLyrics, setCurrentLyricIndex, setCurrentTime]);

  // 当前歌词自动滚动
  useEffect(() => {
    if (currentLyricRef.current) {
      currentLyricRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentLyricIndex]);

  // K歌音量/回声/麦克风同步
  useEffect(() => {
    engine.setVocalsVolume(vocalsVolume);
    engine.setAccompanimentVolume(accompVolume);
    engine.setEchoDelay(echoDelay);
    if (micEnabled) engine.setMicVolume(micVolume);
  }, [vocalsVolume, accompVolume, echoDelay, micEnabled, micVolume, engine]);

  // EQ 同步
  useEffect(() => { eqGains.forEach((g, i) => engine.setEQBand(i, g)); }, [eqGains, engine]);

  // 加载“动次打次”节拍器采样
  useEffect(() => {
    let cancelled = false;
    async function loadDrums() {
      try {
        const ctx = engine.getAudioContext();
        if (!ctx) return;
        const res = await fetch('/metronome_dongcida.mp3');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const audio = await ctx.decodeAudioData(buf);
        if (!cancelled) engine.setMetronomeDrumsBuffer(audio, 120);
      } catch (err) {
        console.error('加载节拍器采样失败:', err);
      }
    }
    loadDrums();
    return () => { cancelled = true; };
  }, [engine]);

  // 节拍器
  useEffect(() => {
    engine.setMetronomeVolume(metronomeVolume);
    engine.setMetronomeBpm(metronomeBpm);
    engine.setMetronomeSound(metronomeSound);
    if (metronomeEnabled && isPlaying) {
      engine.startMetronome();
    } else {
      engine.stopMetronome();
    }
    return () => { engine.stopMetronome(); };
  }, [metronomeEnabled, isPlaying, metronomeBpm, metronomeVolume, metronomeSound, engine]);

  // 音波曲线与播放状态同步
  useEffect(() => {
    if (!selectedSong) return;
    if (isPlaying) {
      musicCurveRef.current?.play();
    } else if (currentTime > 0) {
      musicCurveRef.current?.pause();
    } else {
      musicCurveRef.current?.stop();
    }
  }, [isPlaying, currentTime, selectedSong]);

  const generateAccompaniment = async () => {
    if (!selectedSong) return;
    try {
      await separateSong(selectedSong.id, selectedSong.fileName, selectedSong.audioData);
      // 刷新内存对象，使当前歌曲标记为已分离
      const fresh = await import('../db/index').then(m => m.getSong(selectedSong.id));
      if (fresh) {
        Object.assign(selectedSong, fresh);
      }
      // 如果正在播放这首歌，重新加载分离音轨
      if (useAppStore.getState().selectedSongId === selectedSong.id && isPlaying) {
        engine.stop();
        await loadSongAudio(selectedSong, engine);
        engine.play();
      }
    } catch (e) {
      console.error('[Layout] accompaniment generation failed:', e);
    }
  };


  if (!selectedSong) return null;

  const duration = selectedSong.duration || engine.duration;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handlePlayPause = () => {
    try {
      if (isPlaying) { engine.pause(); setPlaying(false); }
      else { engine.play(); setPlaying(true); }
    } catch (e) {
      console.error('[PlayerView] play/pause error:', e);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = parseFloat(e.target.value);
    const time = (pct / 100) * duration;
    setCurrentTime(time);
    engine.seek(time);
  };

  // 与歌单列表保持一致的排序
  const sortedSongs = useMemo(() => {
    return [...songs].sort((a, b) => b.createdAt - a.createdAt);
  }, [songs]);

  const playNext = async () => {
    if (!selectedSong || sortedSongs.length === 0) return;
    const idx = sortedSongs.findIndex(s => s.id === selectedSong.id);
    let nextIdx = -1;
    if (playMode === 'shuffle') {
      nextIdx = Math.floor(Math.random() * sortedSongs.length);
    } else {
      nextIdx = (idx + 1) % sortedSongs.length;
    }
    if (nextIdx >= 0 && nextIdx < sortedSongs.length) {
      const next = sortedSongs[nextIdx];
      selectSong(next.id);
      engine.stop();
      try {
        await loadSongAudio(next, engine);
        engine.play();
        setPlaying(true);
      } catch (e) {
        console.error('[PlayerView] playNext failed:', e);
      }
    }
  };

  const playPrev = async () => {
    if (!selectedSong || sortedSongs.length === 0) return;
    // 已播放超过 3 秒则退回开头
    if (currentTime > 3) {
      engine.seek(0);
      setCurrentTime(0);
      return;
    }
    const idx = sortedSongs.findIndex(s => s.id === selectedSong.id);
    const prevIdx = (idx - 1 + sortedSongs.length) % sortedSongs.length;
    if (prevIdx >= 0 && prevIdx < sortedSongs.length) {
      const prev = sortedSongs[prevIdx];
      selectSong(prev.id);
      engine.stop();
      try {
        await loadSongAudio(prev, engine);
        engine.play();
        setPlaying(true);
      } catch (e) {
        console.error('[PlayerView] playPrev failed:', e);
      }
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <button onClick={() => { setEditingSong(null); setViewMode('list'); }} className="text-slate-400 hover:text-white flex items-center gap-1">
          <ChevronDown className="w-5 h-5" /><span className="text-sm">歌单</span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => selectedSong && setEditingSong(selectedSong.id)}
            className="p-2 text-slate-500 hover:text-indigo-400 transition-colors"
            title="编辑歌曲信息">
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 主体内容 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 封面 */}
        <div className="flex flex-col items-center justify-center px-6 py-2">
          <MusicCurve
            ref={musicCurveRef}
            className="w-24 h-24"
          />
          <h2 className="text-base font-bold mt-2 text-center">{selectedSong.name}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{selectedSong.artist || selectedSong.fileName}</p>
          {selectedSong.tags.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1 mt-1.5">
              {selectedSong.tags.map(t => <span key={t} className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">{t}</span>)}
            </div>
          )}
          {micEnabled && <div className="mt-2 flex items-center gap-2 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-full"><Mic className="w-3 h-3" />麦克风已开启</div>}
        </div>

        {/* 歌词 */}
        <div className="flex-1 overflow-y-auto px-4 pb-2 relative">
          {lyrics.length > 0 && (
            <div className="absolute top-2 right-4 z-10 flex items-center gap-1 bg-slate-900/80 border border-slate-800 rounded-full px-1 py-0.5 backdrop-blur-sm">
              <button
                onClick={() => handleLyricFontSize(-2)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
                title="减小字号">
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-[10px] text-slate-500 w-4 text-center select-none">{lyricFontSize}</span>
              <button
                onClick={() => handleLyricFontSize(2)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
                title="加大字号">
                <Plus className="w-3 h-3" />
              </button>
            </div>
          )}
          {lyrics.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-600 text-base text-center">暂无歌词 — 编辑歌曲信息导入 LRC 文件</div>
          ) : (
            <div className="py-4 space-y-1">
              {lyrics.map((line, i) => {
                const isCurrent = i === currentLyricIndex;
                return (
                  <div
                    key={i}
                    ref={isCurrent ? currentLyricRef : null}
                    style={{ fontSize: `${isCurrent ? lyricFontSize + 2 : lyricFontSize}px` }}
                    className={`py-1 px-3 rounded-lg transition-all duration-300 text-center ${
                      isCurrent ? 'text-indigo-300 font-medium bg-indigo-500/10' :
                      i < currentLyricIndex ? 'text-slate-600' : 'text-slate-500'}`}>{line.text}</div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* K歌面板 */}
      <KaraokeDrawer
        isOpen={showKaraokeDrawer}
        onClose={() => setShowKaraokeDrawer(false)}
        onGenerateAccompaniment={generateAccompaniment}
      />

      {/* 歌曲编辑抽屉 */}
      <SongDetailDrawer />

      {/* 进度条 */}
      <div className="px-4 pt-2">
        <input type="range" min={0} max={100} step={0.1} value={progress} onChange={handleSeek}
          onMouseDown={() => { isDraggingRef.current = true; }} onMouseUp={() => { isDraggingRef.current = false; }}
          onTouchStart={() => { isDraggingRef.current = true; }} onTouchEnd={() => { isDraggingRef.current = false; }}
          className="w-full" />
        <div className="flex justify-between text-xs text-slate-600 mt-0.5">
          <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* 播放控制 */}
      <div className="flex items-center justify-between px-4 py-3">
        {/* 播放模式切换 */}
        <button onClick={() => setShowPlayModeDrawer(true)}
          className="text-slate-500 hover:text-indigo-400 transition-colors w-8 flex items-center justify-center"
          title={{ sequential: '顺序播放', listCycle: '列表循环', singleRepeat: '单曲循环', shuffle: '随机播放' }[playMode]}>
          {playMode === 'sequential' && <ListMusic className="w-4 h-4" />}
          {playMode === 'listCycle' && <Repeat className="w-4 h-4" />}
          {playMode === 'singleRepeat' && <Repeat1 className="w-4 h-4" />}
          {playMode === 'shuffle' && <Shuffle className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-6">
          <SkipBack className="w-5 h-5 text-slate-500 hover:text-white cursor-pointer" onClick={playPrev} />
          <button id="main-play-button" onClick={handlePlayPause} className="w-12 h-12 rounded-full bg-indigo-500 hover:bg-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
          <SkipForward className="w-5 h-5 text-slate-500 hover:text-white cursor-pointer" onClick={playNext} />
        </div>
        <div className="w-8 flex items-center justify-center">
          <button onClick={() => setShowKaraokeDrawer(true)}
            className={`text-slate-500 hover:text-indigo-400 transition-colors ${showKaraokeDrawer ? 'text-indigo-400' : ''}`}
            title="K歌">
            <Mic className="w-5 h-5" />
          </button>
        </div>
      </div>
      <PlayModeDrawer
        isOpen={showPlayModeDrawer}
        onClose={() => setShowPlayModeDrawer(false)}
        mode={playMode}
        onChange={setPlayMode}
      />
    </div>
  );
}

// ========== 资源标签 ==========

interface MusicResource {
  name: string;
  url: string;
  desc: string;
  tags: string[];
}

const MUSIC_RESOURCES: MusicResource[] = [
  {
    name: 'Jamendo Music',
    url: 'https://www.jamendo.com',
    desc: '超过 60 万首独立音乐人分享的免费 MP3，可直接下载并用于个人项目。',
    tags: ['免费 MP3', '独立音乐'],
  },
  {
    name: 'ccMixter',
    url: 'https://ccmixter.org',
    desc: '基于 Creative Commons 授权的 remix 与人声伴奏社区，适合寻找可翻唱素材。',
    tags: ['CC 授权', '伴奏/Remix'],
  },
  {
    name: 'Bensound',
    url: 'https://www.bensound.com',
    desc: '提供大量免版税背景音乐，免费版可下载 MP3 并用于非商业用途。',
    tags: ['免版税', '背景音乐'],
  },
  {
    name: 'Mobygratis',
    url: 'https://mobygratis.com',
    desc: '音乐人 Moby 提供的 400+ 首免费器乐，支持 MP3/WAV 下载，适用于影视/游戏。',
    tags: ['免费下载', '影视配乐'],
  },
  {
    name: 'Freesound',
    url: 'https://freesound.org',
    desc: '庞培法布拉大学运营的音效与音乐片段库，适合寻找采样和loop。',
    tags: ['音效', '采样'],
  },
  {
    name: 'Internet Archive Audio',
    url: 'https://archive.org/details/audio',
    desc: '互联网档案馆的音频收藏，包含大量公共领域录音、现场演出与历史音频。',
    tags: ['档案馆', '公共领域'],
  },
];

function ResourcesTab() {
  const handleOpen = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4">
        <h1 className="text-xl font-bold mb-1">音乐资源</h1>
        <p className="text-sm text-slate-400 mb-4">可下载 MP3 音乐、伴奏和采样的站点</p>

        <div className="grid grid-cols-1 gap-3">
          {MUSIC_RESOURCES.map(site => (
            <button
              key={site.url}
              onClick={() => handleOpen(site.url)}
              className="text-left bg-slate-800 rounded-xl p-4 border border-slate-700/50 hover:border-indigo-500/50 hover:bg-slate-800/80 transition-colors group"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-medium text-slate-200 group-hover:text-indigo-300 transition-colors">
                  {site.name}
                </h3>
                <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 shrink-0 mt-0.5" />
              </div>
              <p className="text-sm text-slate-400 leading-relaxed mb-3">{site.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {site.tags.map(tag => (
                  <span
                    key={tag}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 mt-4 text-center">
          下载后可在「歌单」页点击上传，导入到本应用中使用。
        </p>
      </div>
    </div>
  );
}

// ========== 更多标签 ==========

function MoreTab() {
  const totalSongs = useAppStore(s => s.songs.length);
  const handleClearData = async () => {
    if (confirm('确定要清除所有数据吗？此操作不可撤销。')) {
      const { db } = await import('../db');
      await db.songs.clear();
      await db.settings.clear();
      await db.separationCache.clear();
      window.location.reload();
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4">
        <h1 className="text-xl font-bold mb-4">更多</h1>

        {/* 统计 */}
        <div className="bg-slate-800 rounded-xl p-4 mb-4 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/20 flex items-center justify-center">
              <Music className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalSongs}</p>
              <p className="text-xs text-slate-500">首歌曲</p>
            </div>
          </div>
        </div>

        {/* 设置项 */}
        <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate-700/50">
            <p className="text-sm text-slate-400">数据管理</p>
          </div>
          <button onClick={handleClearData} className="w-full px-4 py-3 text-sm text-red-400 hover:bg-slate-700/50 transition-colors text-left">
            清除所有数据
          </button>
        </div>

        <p className="text-xs text-slate-700 text-center mt-6">Karaoke Web v1.0.0</p>
      </div>
    </div>
  );
}

// ========== 辅助组件 & 函数 ==========

async function selectAudioFiles(): Promise<File[]> {
  return selectFiles('audio/*', true);
}

async function selectFile(accept: string): Promise<File> {
  const files = await selectFiles(accept, false);
  return files[0];
}

function selectFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => {
      if (input.files && input.files.length > 0) resolve(Array.from(input.files));
      else reject(new Error('No files'));
    };
    input.click();
  });
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function formatDuration(s: number): string {
  if (!s || !isFinite(s)) return '--:--';
  return formatTime(s);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
