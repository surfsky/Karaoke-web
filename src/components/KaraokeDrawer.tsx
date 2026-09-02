import { useEffect, useMemo, useState } from 'react';
import { X, Music, Mic, Activity, Wand2, Headphones } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { getAudioEngine } from '../engine/AudioEngine';
import { subscribeSeparation, type SeparationJob, loadSeparationResult } from '../demucs/separation';
import Equalizer from './Equalizer';

const EQ_PRESETS = [
  { label: 'Flat', gains: [0, 0, 0, 0, 0] },
  { label: 'Pop', gains: [0, 2, 4, 2, 0] },
  { label: 'Rock', gains: [4, 1, 3, 5, 4] },
  { label: 'Jazz', gains: [2, 0, 1, 3, 5] },
  { label: 'Vocal', gains: [-2, 0, 3, 4, 2] },
];

interface KaraokeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateAccompaniment: () => void;
}

function downloadWav(name: string, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function mixAndDownload(
  songName: string,
  vocals: ArrayBuffer,
  accompaniment: ArrayBuffer
): Promise<void> {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  const [vocalBuf, accompBuf] = await Promise.all([
    ctx.decodeAudioData(vocals.slice(0)),
    ctx.decodeAudioData(accompaniment.slice(0)),
  ]);
  const length = Math.max(vocalBuf.length, accompBuf.length);
  const mixCtx = new OfflineAudioContext(2, length, vocalBuf.sampleRate);
  const vocalGain = mixCtx.createGain();
  vocalGain.gain.value = 1;
  const accompGain = mixCtx.createGain();
  accompGain.gain.value = 1;

  const vocalSource = mixCtx.createBufferSource();
  vocalSource.buffer = vocalBuf;
  vocalSource.connect(vocalGain);
  vocalGain.connect(mixCtx.destination);

  const accompSource = mixCtx.createBufferSource();
  accompSource.buffer = accompBuf;
  accompSource.connect(accompGain);
  accompGain.connect(mixCtx.destination);

  vocalSource.start(0);
  accompSource.start(0);
  const rendered = await mixCtx.startRendering();

  // Convert AudioBuffer to WAV
  const channels: Float32Array[] = [];
  for (let i = 0; i < rendered.numberOfChannels; i++) {
    channels.push(rendered.getChannelData(i));
  }
  const { encodeWav } = await import('../demucs/wav');
  const wav = encodeWav(channels, rendered.sampleRate);
  downloadWav(`${songName}_混音版.wav`, wav);
}

export function KaraokeDrawer({ isOpen, onClose, onGenerateAccompaniment }: KaraokeDrawerProps) {
  const [show, setShow] = useState(false);
  const [separationJob, setSeparationJob] = useState<SeparationJob | null>(null);

  useEffect(() => {
    if (isOpen) {
      setShow(true);
    } else {
      const t = setTimeout(() => setShow(false), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    return subscribeSeparation(job => setSeparationJob(job));
  }, []);

  const selectedSong = useAppStore(s => s.getSelectedSong());
  const vocalsVolume = useAppStore(s => s.vocalsVolume);
  const accompVolume = useAppStore(s => s.accompVolume);
  const micEnabled = useAppStore(s => s.micEnabled);
  const micVolume = useAppStore(s => s.micVolume);
  const echoDelay = useAppStore(s => s.echoDelay);
  const metronomeEnabled = useAppStore(s => s.metronomeEnabled);
  const metronomeBpm = useAppStore(s => s.metronomeBpm);
  const metronomeVolume = useAppStore(s => s.metronomeVolume);

  const setVocalsVolume = useAppStore(s => s.setVocalsVolume);
  const setAccompVolume = useAppStore(s => s.setAccompVolume);
  const setMicEnabled = useAppStore(s => s.setMicEnabled);
  const setMicVolume = useAppStore(s => s.setMicVolume);
  const setEchoDelay = useAppStore(s => s.setEchoDelay);
  const setMetronomeEnabled = useAppStore(s => s.setMetronomeEnabled);
  const setMetronomeBpm = useAppStore(s => s.setMetronomeBpm);
  const setMetronomeVolume = useAppStore(s => s.setMetronomeVolume);
  const setEQGain = useAppStore(s => s.setEQGain);

  const engine = useMemo(() => getAudioEngine(), []);

  const isSeparationRunning =
    separationJob?.status === 'init' ||
    separationJob?.status === 'loading' ||
    separationJob?.status === 'running';
  const hasSeparation = selectedSong?.hasSeparation ?? false;
  const accompReady = hasSeparation && !isSeparationRunning;

  const handleVocalsVolume = (v: number) => {
    setVocalsVolume(v);
    engine.setVocalsVolume(v);
  };

  const handleAccompVolume = (v: number) => {
    setAccompVolume(v);
    engine.setAccompanimentVolume(v);
  };

  const handleMicToggle = async (enabled: boolean) => {
    setMicEnabled(enabled);
    await engine.enableMicrophone(enabled);
    if (enabled) engine.setMicVolume(micVolume);
  };

  const handleMicVolume = (v: number) => {
    setMicVolume(v);
    if (micEnabled) engine.setMicVolume(v);
  };

  const handleEchoDelay = (v: number) => {
    setEchoDelay(v);
    engine.setEchoDelay(v);
  };

  const handleMetronomeToggle = (enabled: boolean) => {
    setMetronomeEnabled(enabled);
  };

  const handleMetronomeBpm = (bpm: number) => {
    setMetronomeBpm(bpm);
  };

  const handleExportAccompaniment = async () => {
    if (!selectedSong) return;
    const cached = await loadSeparationResult(selectedSong.id);
    if (!cached?.accompaniment) {
      alert('尚未生成伴奏，请先点击“生成伴奏”');
      return;
    }
    downloadWav(`${selectedSong.name}_伴奏.wav`, cached.accompaniment);
  };

  const handleExportMix = async () => {
    if (!selectedSong) return;
    const cached = await loadSeparationResult(selectedSong.id);
    if (!cached?.vocals || !cached?.accompaniment) {
      alert('尚未生成伴奏，请先点击“生成伴奏”');
      return;
    }
    await mixAndDownload(selectedSong.name, cached.vocals, cached.accompaniment);
  };

  const applyEQPreset = (gains: number[]) => {
    gains.forEach((g, i) => {
      setEQGain(i, g);
      engine.setEQBand(i, g);
    });
  };

  if (!show && !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Drawer panel */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-sm bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">K歌设置</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* 原声 */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-200 w-20 shrink-0">原声</span>
            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={vocalsVolume}
                onChange={e => handleVocalsVolume(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <span className="text-xs text-slate-400 w-10 text-right">
                {Math.round(vocalsVolume * 100)}%
              </span>
            </div>
          </div>

          {/* 伴奏 */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-200 w-20 shrink-0">伴奏</span>
            <div className="flex-1 flex items-center gap-3">
              {isSeparationRunning ? (
                <div className="flex-1 flex items-center gap-2 text-sm text-slate-400">
                  <Activity className="w-4 h-4 animate-pulse text-cyan-400" />
                  <span>生成伴奏中 {Math.round((separationJob?.progress ?? 0) * 100)}%</span>
                </div>
              ) : accompReady ? (
                <>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.01}
                    value={accompVolume}
                    onChange={e => handleAccompVolume(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                  />
                  <span className="text-xs text-slate-400 w-10 text-right">
                    {Math.round(accompVolume * 100)}%
                  </span>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-500">未生成伴奏</span>
                  <button
                    onClick={onGenerateAccompaniment}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-400 text-xs hover:bg-cyan-500/25 transition-colors"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    生成
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 节拍器 */}
          <div className="flex items-start gap-4">
            <span className="text-sm text-slate-200 w-20 shrink-0 pt-2">节拍器</span>
            <div className="flex-1 bg-slate-800/50 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">启用</span>
                <button
                  onClick={() => handleMetronomeToggle(!metronomeEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    metronomeEnabled ? 'bg-indigo-500' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      metronomeEnabled ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-10">BPM</span>
                <input
                  type="range"
                  min={40}
                  max={208}
                  step={1}
                  value={metronomeBpm}
                  onChange={e => handleMetronomeBpm(parseInt(e.target.value, 10))}
                  className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                />
                <span className="text-xs text-slate-400 w-8 text-right">{metronomeBpm}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-10">音量</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.01}
                  value={metronomeVolume}
                  onChange={e => setMetronomeVolume(parseFloat(e.target.value))}
                  className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                />
                <span className="text-xs text-slate-400 w-10 text-right">{Math.round(metronomeVolume * 100)}%</span>
              </div>
            </div>
          </div>

          {/* 回音 */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-200 w-20 shrink-0">回音</span>
            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1000}
                step={10}
                value={echoDelay}
                onChange={e => handleEchoDelay(parseInt(e.target.value, 10))}
                className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <span className="text-xs text-slate-400 w-12 text-right">{echoDelay}ms</span>
            </div>
          </div>

          {/* 麦克风 */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-200 w-20 shrink-0">麦克风</span>
            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={micVolume}
                onChange={e => handleMicVolume(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-slate-700 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <span className="text-xs text-slate-400 w-10 text-right">{Math.round(micVolume * 100)}%</span>
              <button
                onClick={() => handleMicToggle(!micEnabled)}
                className={`p-2 rounded-full transition-colors ${
                  micEnabled ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-700 text-slate-400'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 麦克风曲线 / 均衡器 */}
          <div className="flex items-start gap-4">
            <span className="text-sm text-slate-200 w-20 shrink-0 pt-2">麦克风曲线</span>
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-slate-500">dB</span>
              </div>
              <Equalizer />
              <div className="flex flex-wrap gap-2">
                {EQ_PRESETS.map(({ label, gains }) => (
                  <button
                    key={label}
                    onClick={() => applyEQPreset(gains)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-indigo-500 hover:text-white transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer export buttons */}
        <div className="p-4 border-t border-slate-800 grid grid-cols-2 gap-3">
          <button
            onClick={handleExportAccompaniment}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-800 text-slate-200 text-sm hover:bg-slate-700 transition-colors"
          >
            <Music className="w-4 h-4" />
            导出伴奏
          </button>
          <button
            onClick={handleExportMix}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-500/15 text-indigo-300 text-sm hover:bg-indigo-500/25 transition-colors"
          >
            <Headphones className="w-4 h-4" />
            导出混音版
          </button>
        </div>
      </div>
    </div>
  );
}

export default KaraokeDrawer;
