// Tiny synthesized sound kit. No audio files: everything is oscillators and
// filtered noise, so games stay asset-free and sounds can follow the action
// (rising pitch on combos is the single cheapest way to make a chain feel good).

type ToneOptions = {
  freq: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** Glide to this frequency over the note. */
  slideTo?: number;
  delay?: number;
  /** 0..1 send to the shared echo. */
  echo?: number;
  detune?: number;
};

type NoiseOptions = { dur?: number; gain?: number; freq?: number; q?: number; delay?: number; slideTo?: number; type?: BiquadFilterType };

// Major pentatonic: any run of steps sounds pleasant, which is what a combo ladder needs.
const PENTATONIC = [0, 2, 4, 7, 9];

export function stepToFreq(step: number, base = 220): number {
  const octave = Math.floor(step / PENTATONIC.length);
  const degree = ((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  return base * Math.pow(2, octave + PENTATONIC[degree] / 12);
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastAt = new Map<string, number>();
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('inad:muted') === '1'; } catch { /* storage optional */ }
  }

  /** Call from a user gesture. Browsers keep audio suspended until then. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.5;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14; limiter.knee.value = 12; limiter.ratio.value = 8;
      master.connect(limiter).connect(ctx.destination);

      // One shared feedback echo gives every sound a little space for free.
      const echoIn = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.19;
      const feedback = ctx.createGain(); feedback.gain.value = 0.34;
      const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2400;
      echoIn.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay);
      tone.connect(master);

      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx; this.master = master; this.echoIn = echoIn; this.noiseBuffer = buffer;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try { localStorage.setItem('inad:muted', muted ? '1' : '0'); } catch { /* optional */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  /** Drops repeats of the same sound that arrive within gapMs, so 40 hits in one frame do not clip. */
  private throttled(key: string, gapMs: number): boolean {
    const now = performance.now();
    if (now - (this.lastAt.get(key) ?? -1e9) < gapMs) return true;
    this.lastAt.set(key, now);
    return false;
  }

  tone(o: ToneOptions) {
    const ctx = this.ctx; if (!ctx || !this.master || this.muted) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const dur = o.dur ?? 0.16;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    const gain = ctx.createGain();
    const peak = o.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.006));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(this.master);
    if (o.echo && this.echoIn) { const send = ctx.createGain(); send.gain.value = o.echo; gain.connect(send); send.connect(this.echoIn); }
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  noise(o: NoiseOptions = {}) {
    const ctx = this.ctx; if (!ctx || !this.master || !this.noiseBuffer || this.muted) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const dur = o.dur ?? 0.12;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = o.type ?? 'bandpass';
    filter.frequency.setValueAtTime(o.freq ?? 1800, t0); filter.Q.value = o.q ?? 0.9;
    if (o.slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.slideTo), t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.gain ?? 0.18, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.03);
  }

  // ---- Ready-made sounds ----------------------------------------------------

  /** A note on the combo ladder. Pass the chain index and it climbs. */
  note(step: number, opts: { gain?: number; type?: OscillatorType; dur?: number; base?: number; echo?: number } = {}) {
    if (this.throttled('note', 18)) return;
    const freq = stepToFreq(Math.min(step, 34), opts.base ?? 220);
    this.tone({ freq, type: opts.type ?? 'triangle', gain: opts.gain ?? 0.2, dur: opts.dur ?? 0.22, echo: opts.echo ?? 0.35 });
    this.tone({ freq: freq * 2, type: 'sine', gain: (opts.gain ?? 0.2) * 0.35, dur: 0.12 });
  }

  click() { if (!this.throttled('click', 30)) this.tone({ freq: 660, dur: 0.05, type: 'square', gain: 0.06 }); }
  place() { this.tone({ freq: 190, slideTo: 110, dur: 0.09, type: 'sine', gain: 0.3 }); this.noise({ dur: 0.04, gain: 0.08, freq: 900 }); }
  deny() { this.tone({ freq: 140, slideTo: 90, dur: 0.14, type: 'sawtooth', gain: 0.08 }); }
  pop(step = 0) { if (this.throttled('pop', 24)) return; this.tone({ freq: stepToFreq(step, 330), slideTo: stepToFreq(step, 330) * 1.5, dur: 0.09, type: 'sine', gain: 0.22, echo: 0.2 }); }
  thud(power = 1) { this.tone({ freq: 120, slideTo: 42, dur: 0.22, type: 'sine', gain: 0.4 * power }); this.noise({ dur: 0.12, gain: 0.14 * power, freq: 320, type: 'lowpass' }); }
  boom(power = 1) {
    this.tone({ freq: 90, slideTo: 30, dur: 0.5, type: 'sine', gain: 0.5 * power });
    this.noise({ dur: 0.45, gain: 0.3 * power, freq: 1400, slideTo: 120, type: 'lowpass' });
  }
  whoosh() { this.noise({ dur: 0.28, gain: 0.1, freq: 500, slideTo: 3200, q: 1.4 }); }
  sparkle() { for (let i = 0; i < 4; i++) this.tone({ freq: stepToFreq(10 + i * 2, 440), dur: 0.14, gain: 0.07, delay: i * 0.045, echo: 0.5 }); }
  chord(steps: number[], opts: { base?: number; gain?: number; dur?: number; stagger?: number } = {}) {
    steps.forEach((step, i) => this.tone({ freq: stepToFreq(step, opts.base ?? 220), type: 'triangle', gain: opts.gain ?? 0.14, dur: opts.dur ?? 0.5, delay: i * (opts.stagger ?? 0.05), echo: 0.4 }));
  }
  win() { this.chord([5, 7, 9, 12, 14], { stagger: 0.07, dur: 0.6 }); }
  lose() { this.chord([7, 5, 3, 0], { stagger: 0.11, dur: 0.5, base: 165, gain: 0.12 }); }
  /** Soft two-note chime used when the agent needs its human. */
  chime() { this.tone({ freq: 880, dur: 0.5, gain: 0.16, echo: 0.5 }); this.tone({ freq: 1174.7, dur: 0.7, gain: 0.16, delay: 0.16, echo: 0.5 }); }
}
