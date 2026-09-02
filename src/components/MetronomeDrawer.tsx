import { useEffect, useRef, useState } from 'react';
import { X, Volume2, Music, Drum } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { getAudioEngine } from '../engine/AudioEngine';

const SOUND_OPTIONS = [
  { value: 'tick', label: '经典嘀嗒', icon: Music },
  { value: 'drums', label: '动次打次', icon: Drum },
] as const;

const DRUM_TRACK_BPM = 120; // metronome_dongcida.mp3 默认 BPM 基准

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function MetronomeDrawer({ isOpen, onClose }: Props) {
  const engine = useRef(getAudioEngine()).current;

  const enabled = useAppStore(s => s.metronomeEnabled);
  const bpm = useAppStore(s => s.metronomeBpm);
  const volume = useAppStore(s => s.metronomeVolume);
  const sound = useAppStore(s => s.metronomeSound ?? 'tick');

  const setMetronomeEnabled = useAppStore(s => s.setMetronomeEnabled);
  const setMetronomeBpm = useAppStore(s => s.setMetronomeBpm);
  const setMetronomeVolume = useAppStore(s => s.setMetronomeVolume);
  const setMetronomeSound = useAppStore(s => s.setMetronomeSound);

  const [drumsReady, setDrumsReady] = useState(false);
  const [drumsError, setDrumsError] = useState<string | null>(null);

  // 加载鼓点伴音
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
        if (!cancelled) {
          engine.setMetronomeDrumsBuffer(audio, DRUM_TRACK_BPM);
          setDrumsReady(true);
          setDrumsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setDrumsReady(false);
          setDrumsError((err as Error).message ?? '加载失败');
        }
      }
    }
    loadDrums();
    return () => { cancelled = true; };
  }, [engine]);

  // 当参数变化时同步到引擎
  useEffect(() => {
    engine.setMetronomeSound(sound as 'tick' | 'drums');
  }, [sound, engine]);

  useEffect(() => {
    engine.setMetronomeVolume(volume);
  }, [volume, engine]);

  useEffect(() => {
    engine.setMetronomeBpm(bpm);
  }, [bpm, engine]);

  useEffect(() => {
    if (enabled) engine.startMetronome();
    else engine.stopMetronome();
  }, [enabled, engine]);

  return (
    <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`absolute right-0 top-0 h-full w-full max-w-sm bg-slate-900 border-l border-slate-800 shadow-2xl transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h3 className="text-base font-semibold text-white">节拍器</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto h-[calc(100%-3.5rem)]">
          {/* 开关 */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">启用节拍器</span>
            <button
              onClick={() => setMetronomeEnabled(!enabled)}
              className={`relative w-12 h-6 rounded-full transition-colors ${enabled ? 'bg-indigo-500' : 'bg-slate-700'}`}>
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* BPM */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300">速度</span>
              <span className="text-slate-400 font-mono">{bpm} BPM</span>
            </div>
            <input
              type="range"
              min={40}
              max={208}
              step={1}
              value={bpm}
              onChange={e => setMetronomeBpm(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex gap-2 text-xs">
              {[80, 100, 120, 140, 160].map(v => (
                <button key={v} onClick={() => setMetronomeBpm(v)} className="px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700">{v}</button>
              ))}
            </div>
          </div>

          {/* 音量 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300 flex items-center gap-2"><Volume2 className="w-4 h-4" />音量</span>
              <span className="text-slate-400 font-mono">{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              onChange={e => setMetronomeVolume(Number(e.target.value) / 100)}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* 伴音选择 */}
          <div className="space-y-2">
            <span className="text-sm text-slate-300">伴音选择</span>
            <div className="grid grid-cols-2 gap-2">
              {SOUND_OPTIONS.map(opt => {
                const Icon = opt.icon;
                const disabled = opt.value === 'drums' && drumsError !== null;
                return (
                  <button
                    key={opt.value}
                    disabled={disabled}
                    onClick={() => setMetronomeSound(opt.value as 'tick' | 'drums')}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg border text-xs transition-colors ${
                      sound === opt.value
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                        : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:bg-slate-800'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <Icon className="w-5 h-5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {sound === 'drums' && !drumsReady && drumsError === null && (
              <p className="text-xs text-slate-500">正在加载鼓点伴音…</p>
            )}
            {drumsError && (
              <p className="text-xs text-red-400">鼓点伴音加载失败：{drumsError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
