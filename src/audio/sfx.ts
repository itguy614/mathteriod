import type { SfxName } from '../types';
import { midiToHz, noise, tone } from './synth';

type SfxFn = (ctx: BaseAudioContext, out: AudioNode, noiseBuf: AudioBuffer, t: number) => void;

/** Play a sequence of notes (midi numbers) as an arpeggio. */
function arp(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  notes: number[],
  step: number,
  noteLen: number,
  type: OscillatorType,
  gain: number,
): void {
  notes.forEach((n, i) => {
    tone(ctx, out, { type, freq: midiToHz(n), start: t + i * step, duration: noteLen, gain });
    // A soft octave shimmer on top for sparkle.
    tone(ctx, out, { type: 'sine', freq: midiToHz(n + 12), start: t + i * step, duration: noteLen * 0.8, gain: gain * 0.3 });
  });
}

/** Every SFX is synthesized: no audio files. */
export const SFX: Record<SfxName, SfxFn> = {
  laser(ctx, out, _n, t) {
    tone(ctx, out, { type: 'square', freq: 1400, toFreq: 220, start: t, duration: 0.12, gain: 0.08 });
    tone(ctx, out, { type: 'sawtooth', freq: 900, toFreq: 160, start: t, duration: 0.1, gain: 0.05 });
  },

  explode(ctx, out, n, t) {
    noise(ctx, out, n, { start: t, duration: 0.6, gain: 0.5, filter: 'lowpass', freq: 3000, toFreq: 120 });
    tone(ctx, out, { type: 'sine', freq: 120, toFreq: 35, start: t, duration: 0.45, gain: 0.35 });
  },

  correct(ctx, out, _n, t) {
    // Bright rising major arpeggio: C6 E6 G6 C7
    arp(ctx, out, t, [84, 88, 91, 96], 0.06, 0.25, 'triangle', 0.16);
  },

  wrong(ctx, out, _n, t) {
    // Soft, low, round "bonk": gentle, not punishing.
    tone(ctx, out, { type: 'sine', freq: 220, toFreq: 150, start: t, duration: 0.22, gain: 0.22, attack: 0.01 });
    tone(ctx, out, { type: 'triangle', freq: 330, toFreq: 220, start: t, duration: 0.14, gain: 0.06 });
  },

  split(ctx, out, n, t) {
    noise(ctx, out, n, { start: t, duration: 0.18, gain: 0.35, filter: 'bandpass', freq: 2500, toFreq: 600, q: 2 });
    tone(ctx, out, { type: 'square', freq: 500, toFreq: 180, start: t, duration: 0.08, gain: 0.05 });
  },

  shipHit(ctx, out, n, t) {
    noise(ctx, out, n, { start: t, duration: 0.5, gain: 0.45, filter: 'lowpass', freq: 1800, toFreq: 100 });
    tone(ctx, out, { type: 'sawtooth', freq: 180, toFreq: 60, start: t, duration: 0.4, gain: 0.12 });
  },

  shieldHit(ctx, out, _n, t) {
    tone(ctx, out, { type: 'sine', freq: 660, toFreq: 990, start: t, duration: 0.3, gain: 0.15 });
    tone(ctx, out, { type: 'triangle', freq: 1320, toFreq: 880, start: t, duration: 0.35, gain: 0.07, detune: 12 });
  },

  levelClear(ctx, out, _n, t) {
    // C major fanfare: G4 C5 E5 G5 ... C6
    arp(ctx, out, t, [67, 72, 76, 79], 0.11, 0.3, 'square', 0.07);
    tone(ctx, out, { type: 'sawtooth', freq: midiToHz(84), start: t + 0.46, duration: 0.8, gain: 0.07, attack: 0.02 });
    tone(ctx, out, { type: 'triangle', freq: midiToHz(72), start: t + 0.46, duration: 0.9, gain: 0.12, attack: 0.02 });
    tone(ctx, out, { type: 'triangle', freq: midiToHz(76), start: t + 0.46, duration: 0.9, gain: 0.1, attack: 0.02 });
  },

  levelFail(ctx, out, _n, t) {
    // Gentle descending phrase that ends on a hopeful major note.
    const notes = [72, 69, 65, 67];
    notes.forEach((m, i) =>
      tone(ctx, out, { type: 'triangle', freq: midiToHz(m), start: t + i * 0.18, duration: 0.35, gain: 0.13, attack: 0.02 }),
    );
  },

  purchase(ctx, out, _n, t) {
    // Coin sparkle: two quick high notes then twinkles.
    tone(ctx, out, { type: 'square', freq: midiToHz(88), start: t, duration: 0.08, gain: 0.07 });
    tone(ctx, out, { type: 'square', freq: midiToHz(93), start: t + 0.07, duration: 0.3, gain: 0.07 });
    for (let i = 0; i < 5; i++) {
      tone(ctx, out, {
        type: 'sine',
        freq: midiToHz(100 + ((i * 5) % 12)),
        start: t + 0.12 + i * 0.05,
        duration: 0.12,
        gain: 0.05,
      });
    }
  },

  click(ctx, out, _n, t) {
    tone(ctx, out, { type: 'triangle', freq: 1100, toFreq: 700, start: t, duration: 0.05, gain: 0.12 });
  },

  promote(ctx, out, n, t) {
    // Bigger fanfare: two rising arpeggios + sustained chord + shimmer.
    arp(ctx, out, t, [60, 64, 67, 72], 0.09, 0.25, 'square', 0.06);
    arp(ctx, out, t + 0.4, [65, 69, 72, 77], 0.09, 0.25, 'square', 0.06);
    const chordAt = t + 0.8;
    [72, 76, 79, 84].forEach((m) => {
      tone(ctx, out, { type: 'sawtooth', freq: midiToHz(m), start: chordAt, duration: 1.4, gain: 0.05, attack: 0.03, detune: 6 });
      tone(ctx, out, { type: 'triangle', freq: midiToHz(m), start: chordAt, duration: 1.5, gain: 0.07, attack: 0.03 });
    });
    noise(ctx, out, n, { start: chordAt, duration: 1.2, gain: 0.06, filter: 'highpass', freq: 7000 });
  },
};
