import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getAudioEngine } from '../engine/AudioEngine';

const EQ_BANDS = [
  { freq: 60, label: '60' },
  { freq: 250, label: '250' },
  { freq: 1000, label: '1k' },
  { freq: 4000, label: '4k' },
  { freq: 12000, label: '12k' },
];

const MIN_GAIN = -12;
const MAX_GAIN = 12;

const WIDTH = 340;
const HEIGHT = 150;
const PADDING = { top: 12, right: 12, bottom: 28, left: 34 };
const PLOT_WIDTH = WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom;

export default function Equalizer() {
  const eqGains = useAppStore(s => s.eqGains);
  const setEQGain = useAppStore(s => s.setEQGain);
  const engine = getAudioEngine();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const getX = (index: number) => PADDING.left + (index / (EQ_BANDS.length - 1)) * PLOT_WIDTH;

  const getY = useCallback((gain: number) => {
    const t = (gain - MIN_GAIN) / (MAX_GAIN - MIN_GAIN);
    return PADDING.top + (1 - t) * PLOT_HEIGHT;
  }, []);

  const getGainFromY = useCallback((y: number) => {
    const t = 1 - (y - PADDING.top) / PLOT_HEIGHT;
    const gain = MIN_GAIN + t * (MAX_GAIN - MIN_GAIN);
    return Math.max(MIN_GAIN, Math.min(MAX_GAIN, Math.round(gain * 2) / 2));
  }, []);

  // Catmull-Rom 样条转为平滑三次贝塞尔曲线
  const buildSmoothPath = useCallback((points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }, []);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    if (dragIndex === null || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const scaleY = HEIGHT / rect.height;
    const y = (clientY - rect.top) * scaleY;
    const gain = getGainFromY(y);
    setEQGain(dragIndex, gain);
    engine.setEQBand(dragIndex, gain);
  }, [dragIndex, getGainFromY, setEQGain, engine]);

  useEffect(() => {
    if (dragIndex === null) return;
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onUp = () => setDragIndex(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragIndex, handleMove]);

  const points = EQ_BANDS.map((band, i) => ({ x: getX(i), y: getY(eqGains[i] ?? 0) }));
  const pathD = buildSmoothPath(points);

  return (
    <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50 select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto overflow-visible"
      >
        <defs>
          <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 背景网格 - 水平 dB 线 */}
        <line
          x1={PADDING.left}
          y1={getY(12)}
          x2={WIDTH - PADDING.right}
          y2={getY(12)}
          stroke="rgba(255,255,255,0.08)"
        />
        <line
          x1={PADDING.left}
          y1={getY(0)}
          x2={WIDTH - PADDING.right}
          y2={getY(0)}
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="4 3"
        />
        <line
          x1={PADDING.left}
          y1={getY(-12)}
          x2={WIDTH - PADDING.right}
          y2={getY(-12)}
          stroke="rgba(255,255,255,0.08)"
        />

        {/* 背景网格 - 垂直频率线 */}
        {EQ_BANDS.map((_, i) => (
          <line
            key={`grid-${i}`}
            x1={getX(i)}
            y1={PADDING.top}
            x2={getX(i)}
            y2={HEIGHT - PADDING.bottom}
            stroke="rgba(255,255,255,0.05)"
          />
        ))}

        {/* 曲线填充区域 */}
        <path
          d={`${pathD} L ${getX(EQ_BANDS.length - 1)} ${HEIGHT - PADDING.bottom} L ${getX(0)} ${HEIGHT - PADDING.bottom} Z`}
          fill="url(#eqGradient)"
          opacity={0.25}
        />

        {/* 曲线 */}
        <path
          d={pathD}
          fill="none"
          stroke="#6366f1"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* 控制点 */}
        {points.map((p, i) => (
          <circle
            key={`point-${i}`}
            cx={p.x}
            cy={p.y}
            r={dragIndex === i ? 6 : 5}
            fill="#818cf8"
            stroke="#e0e7ff"
            strokeWidth={2}
            className="cursor-pointer"
            onMouseDown={() => setDragIndex(i)}
            onTouchStart={() => setDragIndex(i)}
          />
        ))}

        {/* X 轴频率标签 */}
        {EQ_BANDS.map((band, i) => (
          <text
            key={`label-${i}`}
            x={getX(i)}
            y={HEIGHT - 8}
            textAnchor="middle"
            fontSize="9"
            fill="#94a3b8"
          >
            {band.label}
          </text>
        ))}

        {/* Y 轴 dB 标签 */}
        <text x={PADDING.left - 8} y={getY(12) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">+12</text>
        <text x={PADDING.left - 8} y={getY(0) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">0</text>
        <text x={PADDING.left - 8} y={getY(-12) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">-12</text>
      </svg>
    </div>
  );
}
