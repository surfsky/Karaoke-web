/**
 * 节拍器 — 基于 Web Audio API 的高精度节拍器
 * 支持两种伴音：合成嘀嗒（tick）或鼓点循环采样（drums）
 */

export class Metronome {
  private ctx: AudioContext;
  private gainNode: GainNode;
  private _bpm = 120;
  private _playing = false;
  private _soundType: 'tick' | 'drums' = 'tick';
  private nextTickTime = 0;
  private tickBuffer: AudioBuffer | null = null;
  private schedulerId: number | null = null;
  private lookAhead = 0.1; // seconds
  private scheduleInterval = 25; // ms
  private destination: AudioNode;

  // 鼓点循环伴音
  private drumsBuffer: AudioBuffer | null = null;
  private drumsSource: AudioBufferSourceNode | null = null;
  private drumsBaseBpm = 120;

  /** 每拍回调 */
  public onTick?: (beat: number, totalBeats: number) => void;
  private beatCount = 0;

  constructor(ctx: AudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.destination = destination;
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0.5;
    this.gainNode.connect(destination);
    this.buildTick();
  }

  get bpm() { return this._bpm; }
  set bpm(v: number) {
    this._bpm = Math.max(30, Math.min(300, v));
    this.updateDrumsRate();
  }
  get playing() { return this._playing; }
  get soundType() { return this._soundType; }
  set soundType(v: 'tick' | 'drums') {
    if (this._soundType === v) return;
    this._soundType = v;
    if (this._playing) {
      this.stop();
      this.start();
    }
  }

  /** 合成短促咔嗒声 */
  private buildTick(): void {
    const sr = this.ctx.sampleRate;
    const duration = 0.03;
    const length = Math.ceil(sr * duration);
    const buffer = this.ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      data[i] = Math.sin(2 * Math.PI * 800 * t) * Math.exp(-t * 100);
    }
    this.tickBuffer = buffer;
  }

  /** 设置鼓点循环采样及其基准 BPM */
  setDrumsBuffer(buffer: AudioBuffer, baseBpm = 120): void {
    this.drumsBuffer = buffer;
    this.drumsBaseBpm = Math.max(40, baseBpm);
    this.updateDrumsRate();
  }

  start(): void {
    if (this._playing) return;
    if (this._soundType === 'drums' && this.drumsBuffer) {
      this.startDrums();
    } else if (this.tickBuffer) {
      this.startTick();
    }
  }

  private startTick(): void {
    this._playing = true;
    this.beatCount = 0;
    this.nextTickTime = this.ctx.currentTime;
    this.schedule();
  }

  private startDrums(): void {
    this._playing = true;
    this.stopDrumsSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.drumsBuffer;
    src.loop = true;
    src.connect(this.gainNode);
    const rate = this._bpm / this.drumsBaseBpm;
    src.playbackRate.value = rate;
    src.start(0);
    this.drumsSource = src;
  }

  stop(): void {
    this._playing = false;
    if (this.schedulerId !== null) {
      clearTimeout(this.schedulerId);
      this.schedulerId = null;
    }
    this.stopDrumsSource();
  }

  private stopDrumsSource(): void {
    if (this.drumsSource) {
      try { this.drumsSource.stop(); } catch { /* ignore */ }
      this.drumsSource.disconnect();
      this.drumsSource = null;
    }
  }

  private updateDrumsRate(): void {
    if (!this.drumsSource) return;
    this.drumsSource.playbackRate.value = this._bpm / this.drumsBaseBpm;
  }

  private schedule = (): void => {
    if (!this._playing || this._soundType !== 'tick') return;

    while (this.nextTickTime < this.ctx.currentTime + this.lookAhead) {
      this.tick(this.nextTickTime);
      this.beatCount++;
      this.nextTickTime += 60.0 / this._bpm;
    }
    this.schedulerId = window.setTimeout(this.schedule, this.scheduleInterval);
  };

  private tick(time: number): void {
    if (!this.tickBuffer || this._soundType !== 'tick') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.tickBuffer;
    src.connect(this.gainNode);
    src.start(time);
    this.onTick?.(this.beatCount % 4, this.beatCount);
  }

  setVolume(v: number): void {
    this.gainNode.gain.value = v;
  }

  dispose(): void {
    this.stop();
    this.gainNode.disconnect();
  }
}
