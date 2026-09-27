/** Small WebAudio building blocks shared by SFX and music. */

export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  /** Optional frequency to glide to by the end. */
  toFreq?: number;
  start: number;
  duration: number;
  gain?: number;
  attack?: number;
  detune?: number;
}

/** A single enveloped oscillator note. */
export function tone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOpts): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.start);
  if (o.toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.toFreq), o.start + o.duration);
  if (o.detune) osc.detune.value = o.detune;
  const peak = o.gain ?? 0.3;
  const attack = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, o.start);
  g.gain.exponentialRampToValueAtTime(peak, o.start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, o.start + o.duration);
  osc.connect(g).connect(dest);
  osc.start(o.start);
  osc.stop(o.start + o.duration + 0.05);
}

export interface NoiseOpts {
  start: number;
  duration: number;
  gain?: number;
  filter?: BiquadFilterType;
  freq?: number;
  toFreq?: number;
  q?: number;
}

/** A filtered, enveloped noise burst. */
export function noise(ctx: BaseAudioContext, dest: AudioNode, buffer: AudioBuffer, o: NoiseOpts): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'lowpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, o.start);
  if (o.toFreq) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.toFreq), o.start + o.duration);
  f.Q.value = o.q ?? 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.gain ?? 0.4, o.start);
  g.gain.exponentialRampToValueAtTime(0.0001, o.start + o.duration);
  src.connect(f).connect(g).connect(dest);
  src.start(o.start, Math.random() * 0.5);
  src.stop(o.start + o.duration + 0.05);
}
