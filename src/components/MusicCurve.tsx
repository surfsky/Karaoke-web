import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Music2 } from 'lucide-react';
import { getAudioEngine } from '../engine/AudioEngine';

export interface MusicCurveRef {
  /** 确保 analyser 已创建（循环已自动运行，此方法仅作兼容） */
  play: () => void;
  /** 清空画布，下一次帧会继续保持清空 */
  pause: () => void;
  /** 清空画布，下一次帧会继续保持清空 */
  stop: () => void;
}

interface MusicCurveProps {
  className?: string;
}

export const MusicCurve = forwardRef<MusicCurveRef, MusicCurveProps>(
  ({ className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const rafRef = useRef<number | null>(null);
    const engineRef = useRef(getAudioEngine());
    const sizeRef = useRef({ width: 0, height: 0 });

    const ensureAnalyser = useCallback(() => {
      if (!analyserRef.current) {
        const analyser = engineRef.current.createAnalyser();
        analyserRef.current = analyser;
        if (analyser) {
          dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
        }
      }
      return analyserRef.current;
    }, []);

    const resizeCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        sizeRef.current = { width: rect.width, height: rect.height };
      }
    }, []);

    const clearCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, []);

    const draw = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const analyser = analyserRef.current;
      const dataArray = dataArrayRef.current;

      // 卸载后不再继续调度，防止内存泄漏
      if (!canvas || !container || !analyser || !dataArray) return;

      // 持续循环，自动跟随 AudioEngine 的播放状态
      rafRef.current = requestAnimationFrame(draw);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 未播放时清空画布，仅显示白色音乐图标
      if (engineRef.current.state !== 'playing') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const width = sizeRef.current.width || canvas.width / (window.devicePixelRatio || 1);
      const height = sizeRef.current.height || canvas.height / (window.devicePixelRatio || 1);
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      analyser.getByteFrequencyData(dataArray);

      const maxAmplitude = height * 0.55;
      const pointCount = 32;
      const step = Math.max(1, Math.floor(dataArray.length / pointCount));

      const amplitudes: number[] = [];
      for (let i = 0; i < pointCount; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) {
          sum += dataArray[i * step + j] ?? 0;
        }
        amplitudes.push(sum / step / 255);
      }

      // 原点位于左下角，曲线从底部向上延伸
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < amplitudes.length; i++) {
        const x = (i / (amplitudes.length - 1)) * width;
        const y = height - amplitudes[i] * maxAmplitude;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();

      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0.15)');
      gradient.addColorStop(1, 'rgba(255,255,255,0.65)');
      ctx.fillStyle = gradient;
      ctx.fill();

      // 顶部高亮曲线
      ctx.beginPath();
      for (let i = 0; i < amplitudes.length; i++) {
        const x = (i / (amplitudes.length - 1)) * width;
        const y = height - amplitudes[i] * maxAmplitude;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }, []);

    useImperativeHandle(ref, () => ({
      play: () => { ensureAnalyser(); },
      pause: () => { clearCanvas(); },
      stop: () => { clearCanvas(); },
    }), [ensureAnalyser, clearCanvas]);

    useEffect(() => {
      ensureAnalyser();
      resizeCanvas();
      if (!rafRef.current) draw();

      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        analyserRef.current?.disconnect();
        analyserRef.current = null;
        dataArrayRef.current = null;
      };
    }, [draw, ensureAnalyser, resizeCanvas]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(container);
      return () => observer.disconnect();
    }, [resizeCanvas]);

    return (
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-indigo-500/20 ${className}`}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <Music2 className="relative z-10 w-10 h-10 text-white/90 drop-shadow-md" />
      </div>
    );
  }
);

MusicCurve.displayName = 'MusicCurve';
