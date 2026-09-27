import { midiToHz, noise, tone } from './synth';

const BPM = 100;
const STEPS_PER_BAR = 16; // 16th notes
const LOOKAHEAD_S = 0.15;
const TICK_MS = 25;

/** Am – F – C – G, the classic synthwave loop. Root midi notes (octave 2). */
const PROGRESSION: { root: number; chord: number[] }[] = [
  { root: 45, chord: [57, 60, 64] }, // A minor
  { root: 41, chord: [57, 60, 65] }, // F major
  { root: 48, chord: [55, 60, 64] }, // C major
  { root: 43, chord: [55, 59, 62] }, // G major
];

/** Bass arpeggio pattern per 8th note, as semitone offsets from the root. */
const BASS_PATTERN = [0, 12, 7, 12, 0, 12, 7, 10];

/**
 * A tiny lookahead sequencer: bass arpeggio, a soft pad and light drums.
 * Kept quiet and mellow so it sits under the gameplay without distracting.
 */
export class MusicSequencer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private bus: GainNode;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    private noiseBuf: AudioBuffer,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    // Gentle lowpass keeps everything warm and out of the way of SFX.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    this.bus.connect(lp).connect(out);
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(1, now + 1.5);
    this.nextTime = now + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0, now + 0.6);
  }

  private schedule(): void {
    const stepDur = 60 / BPM / 4;
    // If the tab was backgrounded we may be far behind: skip ahead instead of bursting.
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % (STEPS_PER_BAR * PROGRESSION.length * 2);
    }
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const ctx = this.ctx;
    const out = this.bus;
    const barIndex = Math.floor(step / STEPS_PER_BAR) % PROGRESSION.length;
    const inBar = step % STEPS_PER_BAR;
    const bar = PROGRESSION[barIndex]!;
    const secondPass = step >= STEPS_PER_BAR * PROGRESSION.length;

    // Pad: one long, soft detuned chord per bar.
    if (inBar === 0) {
      const len = stepDur * STEPS_PER_BAR;
      for (const m of bar.chord) {
        for (const detune of [-8, 8]) {
          tone(ctx, out, { type: 'sawtooth', freq: midiToHz(m), start: t, duration: len, gain: 0.018, attack: 0.6, detune });
        }
      }
    }

    // Bass arpeggio on 8th notes.
    if (inBar % 2 === 0) {
      const offset = BASS_PATTERN[(inBar / 2) % BASS_PATTERN.length]!;
      tone(ctx, out, { type: 'sawtooth', freq: midiToHz(bar.root + offset), start: t, duration: stepDur * 1.8, gain: 0.07 });
      tone(ctx, out, { type: 'sine', freq: midiToHz(bar.root + offset - 12), start: t, duration: stepDur * 1.8, gain: 0.08 });
    }

    // Sparkly lead arpeggio on the second pass, 16ths, very quiet.
    if (secondPass && inBar % 2 === 1) {
      const n = bar.chord[(inBar >> 1) % bar.chord.length]! + 12;
      tone(ctx, out, { type: 'triangle', freq: midiToHz(n), start: t, duration: stepDur * 1.2, gain: 0.025 });
    }

    // Drums: kick on 1 & 3, snare on 2 & 4, closed hats on 8ths.
    if (inBar === 0 || inBar === 8) {
      tone(ctx, out, { type: 'sine', freq: 140, toFreq: 45, start: t, duration: 0.25, gain: 0.35 });
    }
    if (inBar === 4 || inBar === 12) {
      noise(ctx, out, this.noiseBuf, { start: t, duration: 0.18, gain: 0.1, filter: 'bandpass', freq: 1800, q: 0.8 });
      tone(ctx, out, { type: 'triangle', freq: 220, toFreq: 160, start: t, duration: 0.1, gain: 0.06 });
    }
    if (inBar % 2 === 0) {
      noise(ctx, out, this.noiseBuf, { start: t, duration: 0.04, gain: inBar % 4 === 2 ? 0.05 : 0.03, filter: 'highpass', freq: 8000 });
    }
  }
}
