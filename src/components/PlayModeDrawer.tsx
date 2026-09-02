import { useEffect, useState } from 'react';
import { X, ListMusic, Repeat, Repeat1, Shuffle, Check } from 'lucide-react';

export type PlayMode = 'sequential' | 'listCycle' | 'singleRepeat' | 'shuffle';

interface PlayModeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  mode: PlayMode;
  onChange: (mode: PlayMode) => void;
}

const MODES: { value: PlayMode; label: string; desc: string; icon: typeof ListMusic }[] = [
  { value: 'sequential', label: '顺序播放', desc: '播放完列表后停止', icon: ListMusic },
  { value: 'listCycle', label: '列表循环', desc: '循环播放整个列表', icon: Repeat },
  { value: 'singleRepeat', label: '单曲循环', desc: '重复播放当前歌曲', icon: Repeat1 },
  { value: 'shuffle', label: '随机播放', desc: '随机打乱播放顺序', icon: Shuffle },
];

export function PlayModeDrawer({ isOpen, onClose, mode, onChange }: PlayModeDrawerProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShow(true);
    } else {
      const t = setTimeout(() => setShow(false), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  if (!show && !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`} />
      {/* Drawer panel */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-sm bg-slate-900 border-l border-slate-800 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">播放模式</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {MODES.map(({ value, label, desc, icon: Icon }) => {
            const active = value === mode;
            return (
              <button
                key={value}
                onClick={() => {
                  onChange(value);
                  onClose();
                }}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                  active
                    ? 'bg-indigo-500/15 border-indigo-500/50 text-white'
                    : 'bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${active ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{label}</div>
                  <div className={`text-sm mt-0.5 ${active ? 'text-indigo-200' : 'text-slate-500'}`}>{desc}</div>
                </div>
                {active && <Check className="w-5 h-5 text-indigo-400" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
