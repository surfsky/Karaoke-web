/**
 * 音频引擎 — Web Audio API 封装
 * 支持双轨播放（人声+伴奏）、麦克风输入、均衡器
 */

import { Metronome } from './Metronome';

export interface ActiveSource {
  node: AudioBufferSourceNode | null;
  gain: GainNode;
  buffer: AudioBuffer;
}

export type EQBand = {
  type: BiquadFilterType;
  frequency: number;
  gain: number; // dB
};

export const DEFAULT_EQ: EQBand[] = [
  { type: 'lowshelf', frequency: 60, gain: 0 },
  { type: 'peaking', frequency: 250, gain: 0 },
  { type: 'peaking', frequency: 1000, gain: 0 },
  { type: 'peaking', frequency: 4000, gain: 0 },
  { type: 'highshelf', frequency: 12000, gain: 0 },
];

const GLOBAL_KEY = '__AUDIO_ENGINE__';

export function getAudioEngine(): AudioEngine {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
  if (!w) return new AudioEngine();
  if (!w[GLOBAL_KEY]) w[GLOBAL_KEY] = new AudioEngine();
  return w[GLOBAL_KEY] as AudioEngine;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];

  // 双轨
  private vocals: ActiveSource | null = null;
  private accompaniment: ActiveSource | null = null;
  private vocalsVolume = 1;
  private accompVolume = 1;

  // 麦克风
  private micStream: MediaStream | null = null;
  private micGain: GainNode | null = null;

  // 全局回声
  private echoDelay: DelayNode | null = null;
  private echoFeedback: GainNode | null = null;

  // 节拍器
  private metronomeGain: GainNode | null = null;
  private metronome: Metronome | null = null;

  // 状态
  private _state: 'idle' | 'playing' | 'paused' = 'idle';
  private _startTime = 0;
  private _pauseOffset = 0;
  private _duration = 0;
  private animationFrame: number | null = null;

  public onTimeUpdate?: (time: number) => void;
  public onEnded?: () => void;

  // ========== 初始化 ==========

  private ensureCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;

      // EQ 链
      this.eqFilters = [];
      let prev: AudioNode = this.masterGain;
      for (const band of DEFAULT_EQ) {
        const filter = this.ctx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.gain.value = band.gain;
        filter.Q.value = band.type === 'peaking' ? 1.4 : 0.7;
        prev.connect(filter);
        prev = filter;
        this.eqFilters.push(filter);
      }

      // 最后的 filter 分成干声与回声两路
      this.echoDelay = this.ctx.createDelay(1.0);
      this.echoDelay.delayTime.value = 0;
      this.echoFeedback = this.ctx.createGain();
      this.echoFeedback.gain.value = 0;

      prev.connect(this.echoDelay);
      this.echoDelay.connect(this.echoFeedback);
      this.echoFeedback.connect(this.echoDelay);
      this.echoDelay.connect(this.ctx.destination);

      prev.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  get state() { return this._state; }
  get duration() { return this._duration; }

  get currentTime(): number {
    if (this._state === 'playing') {
      return (this.ctx?.currentTime ?? 0) - this._startTime;
    }
    return this._pauseOffset;
  }

  // ========== 音频加载 ==========

  /** 从 File 对象加载原始音频（全轨模式） */
  async loadAudioFile(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    return this.loadAudioBuffer(buffer);
  }

  /** 从 ArrayBuffer 加载音频（从 IndexedDB 加载时使用） */
  async loadAudioBuffer(arrayBuffer: ArrayBuffer): Promise<void> {
    const ctx = this.ensureCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    this._duration = audioBuffer.duration;
    this._pauseOffset = 0;
    this._state = 'idle';
    this.stopAnimation();

    // 未分离时只保留一条原声轨道；伴奏在分离完成后单独注入
    this.disposeSource(this.vocals);
    this.disposeSource(this.accompaniment);
    this.vocals = this.createSource(audioBuffer, this.vocalsVolume);
    this.accompaniment = null;
  }

  /** 设置人声轨道 */
  async setVocalsBuffer(buffer: ArrayBuffer): Promise<void> {
    const ctx = this.ensureCtx();
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    this.disposeSource(this.vocals);
    this.vocals = this.createSource(audioBuffer, this.vocalsVolume);
  }

  /** 设置伴奏轨道 */
  async setAccompanimentBuffer(buffer: ArrayBuffer): Promise<void> {
    const ctx = this.ensureCtx();
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    this.disposeSource(this.accompaniment);
    this.accompaniment = this.createSource(audioBuffer, this.accompVolume);
  }

  private createSource(buffer: AudioBuffer, gainValue = 1): ActiveSource {
    const ctx = this.ensureCtx();
    const node = ctx.createBufferSource();
    node.buffer = buffer;

    // 每个轨道的独立增益
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    node.connect(gain);
    gain.connect(this.masterGain!);

    node.onended = () => {
      if (this._state === 'playing' && this.vocals?.node === node) {
        this._state = 'idle';
        this._pauseOffset = 0;
        this.stopAnimation();
        this.onEnded?.();
      }
    };

    return { node, gain, buffer };
  }

  private disposeSource(src: ActiveSource | null): void {
    if (!src) return;
    if (src.node) src.node.onended = null;
    try {
      src.node?.stop();
    } catch {
      // 可能已停止
    }
    src.node?.disconnect();
    src.gain.disconnect();
  }

  // ========== 播放控制 ==========

  play(): void {
    if (!this.vocals) return;

    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => this.doPlay(ctx));
    } else {
      this.doPlay(ctx);
    }
  }

  private doPlay(ctx: AudioContext): void {
    const offset = this._pauseOffset % this._duration;

    // 重建 BufferSource（不能复用已 stopped 的）
    this.startSource('vocals', offset);
    this.startSource('accomp', offset);

    this._startTime = ctx.currentTime - offset;
    this._state = 'playing';
    this.startAnimation();
  }

  pause(): void {
    if (!this.ctx || this._state !== 'playing') return;
    this._pauseOffset = this.ctx.currentTime - this._startTime;

    // 停止当前 sources 并重建静默状态
    this.stopSourceNode(this.vocals);
    this.stopSourceNode(this.accompaniment);

    if (this.vocals?.buffer) {
      this.disposeSource(this.vocals);
      this.vocals = this.createSource(this.vocals.buffer, this.vocalsVolume);
    }
    if (this.accompaniment?.buffer) {
      this.disposeSource(this.accompaniment);
      this.accompaniment = this.createSource(this.accompaniment.buffer, this.accompVolume);
    }

    this._state = 'paused';
    this.stopAnimation();
  }

  stop(): void {
    this._pauseOffset = 0;
    this.stopSourceNode(this.vocals);
    this.stopSourceNode(this.accompaniment);

    if (this.vocals?.buffer) {
      this.disposeSource(this.vocals);
      this.vocals = this.createSource(this.vocals.buffer, this.vocalsVolume);
    }
    if (this.accompaniment?.buffer) {
      this.disposeSource(this.accompaniment);
      this.accompaniment = this.createSource(this.accompaniment.buffer, this.accompVolume);
    }

    this._state = 'idle';
    this.stopAnimation();
  }

  seek(time: number): void {
    this._pauseOffset = Math.max(0, Math.min(time, this._duration));
    if (this._state === 'playing') {
      // 重新播放
      this.stopSourceNode(this.vocals);
      this.stopSourceNode(this.accompaniment);
      const ctx = this.ensureCtx();
      const offset = this._pauseOffset % this._duration;
      this.startSource('vocals', offset);
      this.startSource('accomp', offset);
      this._startTime = ctx.currentTime - offset;
    }
  }

  private startSource(key: 'vocals' | 'accomp', offset: number): void {
    const src = key === 'vocals' ? this.vocals : this.accompaniment;
    if (!src || !this.ctx) return;

    const newNode = this.ctx.createBufferSource();
    newNode.buffer = src.buffer;
    newNode.connect(src.gain);

    // 歌曲自然播完时触发结束回调
    newNode.onended = () => {
      if (this._state === 'playing' && this.vocals?.node === newNode) {
        this._state = 'idle';
        this._pauseOffset = 0;
        this.stopAnimation();
        this.onEnded?.();
      }
    };

    newNode.start(0, offset, src.buffer.duration - offset);
    src.node = newNode;
  }

  private stopSourceNode(src: ActiveSource | null): void {
    if (!src || !src.node) return;
    // 必须先清除 onended，否则 stop() 会同步触发 onended 事件
    src.node.onended = null;
    try {
      src.node.stop();
    } catch {
      // 可能已停止
    }
    src.node.disconnect();
    src.node = null;
  }

  // ========== 音量 ==========

  setVocalsVolume(v: number): void {
    this.vocalsVolume = v;
    if (this.vocals?.gain) this.vocals.gain.gain.value = v;
  }

  setAccompanimentVolume(v: number): void {
    this.accompVolume = v;
    if (this.accompaniment?.gain) this.accompaniment.gain.gain.value = v;
  }

  setMasterVolume(v: number): void {
    if (this.masterGain) this.masterGain.gain.value = v;
  }

  // ========== 均衡器 ==========

  setEQBand(index: number, gainDB: number): void {
    if (index >= 0 && index < this.eqFilters.length) {
      this.eqFilters[index].gain.value = gainDB;
    }
  }

  getEQBands(): EQBand[] {
    return this.eqFilters.map((f) => ({
      type: f.type,
      frequency: f.frequency.value,
      gain: f.gain.value,
    }));
  }

  /** 调试：返回当前轨道状态 */
  getTrackStatus(): { hasVocals: boolean; hasAccomp: boolean; vocalsGain: number; accompGain: number } {
    return {
      hasVocals: !!this.vocals,
      hasAccomp: !!this.accompaniment,
      vocalsGain: this.vocals?.gain.gain.value ?? 0,
      accompGain: this.accompaniment?.gain.gain.value ?? 0,
    };
  }

  // ========== 麦克风 ==========

  async enableMicrophone(enabled: boolean): Promise<void> {
    const ctx = this.ensureCtx();
    if (enabled && !this.micStream) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = ctx.createMediaStreamSource(this.micStream);

        // 麦克风增益
        this.micGain = ctx.createGain();
        this.micGain.gain.value = 1;

        source.connect(this.micGain);
        this.micGain.connect(this.masterGain!);
      } catch (e) {
        console.warn('Microphone access denied:', e);
      }
    } else if (!enabled && this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
      this.micGain?.disconnect();
      this.micGain = null;
    }
  }

  setMicVolume(v: number): void {
    if (this.micGain) this.micGain.gain.value = Math.max(0, v);
  }

  setEchoDelay(delayMs: number): void {
    const seconds = Math.max(0, delayMs) / 1000;
    if (this.echoDelay) this.echoDelay.delayTime.value = seconds;
    if (this.echoFeedback) this.echoFeedback.gain.value = seconds > 0 ? 0.35 : 0;
  }

  get micEnabled(): boolean {
    return this.micStream !== null;
  }

  // ========== 节拍器 ==========

  createMetronomeGain(): GainNode {
    const ctx = this.ensureCtx();
    if (!this.metronomeGain) {
      this.metronomeGain = ctx.createGain();
      this.metronomeGain.gain.value = 0.5;
      this.metronomeGain.connect(this.masterGain!);
    }
    return this.metronomeGain;
  }

  private ensureMetronome(): Metronome {
    const ctx = this.ensureCtx();
    if (!this.metronome) {
      this.metronome = new Metronome(ctx, this.createMetronomeGain());
    }
    return this.metronome;
  }

  setMetronomeDrumsBuffer(buffer: AudioBuffer, baseBpm = 120): void {
    this.ensureMetronome().setDrumsBuffer(buffer, baseBpm);
  }

  setMetronomeSound(sound: 'tick' | 'drums'): void {
    this.ensureMetronome().soundType = sound;
  }

  setMetronomeBpm(bpm: number): void {
    this.ensureMetronome().bpm = bpm;
  }

  setMetronomeVolume(v: number): void {
    const vol = Math.max(0, Math.min(2, v));
    if (this.metronome) {
      this.metronome.setVolume(vol);
    } else if (this.metronomeGain) {
      this.metronomeGain.gain.value = vol;
    }
  }

  startMetronome(): void {
    this.ensureMetronome().start();
  }

  stopMetronome(): void {
    this.metronome?.stop();
  }

  // ========== 动画循环 ==========

  private startAnimation(): void {
    this.stopAnimation();
    const tick = () => {
      if (this._state !== 'playing') return;
      const time = this.currentTime;
      this.onTimeUpdate?.(time);
      if (time >= this._duration) {
        this._state = 'idle';
        this._pauseOffset = 0;
        this.stopAnimation();
        this.onEnded?.();
        return;
      }
      this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  // ========== 分析器（可视化） ==========

  createAnalyser(): AnalyserNode | null {
    if (!this.masterGain || !this.ctx) return null;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    this.masterGain.connect(analyser);
    return analyser;
  }

  // ========== 销毁 ==========

  dispose(): void {
    this.stop();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    this.metronome?.dispose();
    this.metronome = null;
    this.metronomeGain?.disconnect();
    this.vocals?.gain.disconnect();
    this.accompaniment?.gain.disconnect();
    this.micGain?.disconnect();
    this.masterGain?.disconnect();
    this.echoDelay?.disconnect();
    this.echoFeedback?.disconnect();
    this.eqFilters.forEach(f => f.disconnect());
    this.ctx?.close();
    this.ctx = null;
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
    if (w && w[GLOBAL_KEY] === this) delete w[GLOBAL_KEY];
  }
}
