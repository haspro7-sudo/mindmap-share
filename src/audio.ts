/** WebAudio で合成する効果音（外部アセット不要） */

export type Sfx = 'ui' | 'lock' | 'whoosh' | 'hit' | 'counter' | 'block' | 'throw' | 'slam' | 'clash' | 'gauge' | 'super' | 'superhit' | 'ko' | 'shrink' | 'round' | 'escape';

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  volume = 0.6;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** ユーザー操作の直後に呼ぶ（自動再生制限の解除） */
  unlock() {
    this.ensure();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  play(name: Sfx) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'ui':
        this.tone(ctx, t, 880, 0.05, 'square', 0.12);
        break;
      case 'lock':
        this.tone(ctx, t, 520, 0.06, 'square', 0.15);
        this.tone(ctx, t + 0.05, 780, 0.06, 'square', 0.12);
        break;
      case 'whoosh':
        this.noise(ctx, t, 0.16, 0.18, 1800, 400);
        break;
      case 'hit':
        this.noise(ctx, t, 0.09, 0.5, 900, 200);
        this.tone(ctx, t, 140, 0.12, 'triangle', 0.5, 60);
        break;
      case 'counter':
        this.noise(ctx, t, 0.12, 0.6, 1400, 200);
        this.tone(ctx, t, 180, 0.16, 'sawtooth', 0.45, 50);
        this.tone(ctx, t + 0.02, 90, 0.2, 'triangle', 0.5, 40);
        break;
      case 'block':
        this.tone(ctx, t, 1400, 0.08, 'square', 0.25, 900);
        this.noise(ctx, t, 0.05, 0.2, 3000, 1500);
        break;
      case 'throw':
        this.noise(ctx, t, 0.2, 0.25, 600, 150);
        break;
      case 'slam':
        this.noise(ctx, t, 0.18, 0.7, 500, 80);
        this.tone(ctx, t, 70, 0.3, 'triangle', 0.7, 30);
        break;
      case 'clash':
        this.tone(ctx, t, 2200, 0.1, 'square', 0.2, 1200);
        this.noise(ctx, t, 0.08, 0.3, 4000, 2000);
        break;
      case 'gauge':
        this.tone(ctx, t, 1200, 0.05, 'sine', 0.15);
        this.tone(ctx, t + 0.06, 1600, 0.05, 'sine', 0.12);
        break;
      case 'escape':
        this.tone(ctx, t, 600, 0.06, 'sine', 0.15, 1200);
        break;
      case 'super':
        this.tone(ctx, t, 200, 0.5, 'sawtooth', 0.35, 1200);
        this.noise(ctx, t, 0.5, 0.2, 300, 3000);
        break;
      case 'superhit':
        this.noise(ctx, t, 0.35, 0.9, 800, 60);
        this.tone(ctx, t, 60, 0.6, 'triangle', 0.8, 25);
        this.tone(ctx, t, 400, 0.2, 'square', 0.3, 100);
        break;
      case 'ko':
        this.noise(ctx, t, 0.5, 0.9, 700, 40);
        this.tone(ctx, t, 55, 0.9, 'triangle', 0.9, 20);
        break;
      case 'shrink':
        this.noise(ctx, t, 0.4, 0.35, 200, 60);
        this.tone(ctx, t, 45, 0.5, 'triangle', 0.5, 30);
        break;
      case 'round':
        this.tone(ctx, t, 440, 0.12, 'square', 0.2);
        this.tone(ctx, t + 0.12, 660, 0.12, 'square', 0.2);
        this.tone(ctx, t + 0.24, 880, 0.25, 'square', 0.25);
        break;
    }
  }

  private tone(ctx: AudioContext, t: number, freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(ctx: AudioContext, t: number, dur: number, gain: number, freqStart: number, freqEnd: number) {
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(freqStart, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

export const audio = new Audio();
