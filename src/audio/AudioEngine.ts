import type { AudioBus, Settings, SfxName } from '../types';
import { MusicSequencer } from './music';
import { SFX } from './sfx';
import { cancelSpeech, primeSpeech, speakNow } from './speech';
import { createNoiseBuffer } from './synth';

type Ctor = typeof AudioContext;

function getAudioContextCtor(): Ctor | null {
  const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * The game's AudioBus. Everything is synthesized with WebAudio.
 *
 * The AudioContext is created lazily on the first user gesture (browser
 * autoplay policy); calls before that are silently dropped, except music,
 * which is remembered and started once audio unlocks.
 */
export class AudioEngine implements AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private music: MusicSequencer | null = null;
  private thrust: { src: AudioBufferSourceNode; osc: OscillatorNode; gain: GainNode } | null = null;
  private wantMusic = false;
  private unlocked = false;
  private lastPlayed = new Map<SfxName, number>();
  private settings: Settings = { musicVolume: 0.5, sfxVolume: 0.8, readAloud: false, controlMode: 'rotate', touchMode: 'tapdrag' };

  constructor() {
    this.installUnlock();
  }

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
    if (this.ctx && this.musicGain && this.sfxGain) {
      const t = this.ctx.currentTime;
      this.musicGain.gain.setTargetAtTime(this.curve(settings.musicVolume) * 0.6, t, 0.05);
      this.sfxGain.gain.setTargetAtTime(this.curve(settings.sfxVolume), t, 0.05);
    }
    if (!settings.readAloud) cancelSpeech();
  }

  play(name: SfxName): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxGain || !this.noiseBuf) return;
    if (this.settings.sfxVolume <= 0) return;
    // Throttle identical sounds that fire in the same instant (e.g. many rocks exploding).
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlayed.set(name, now);
    try {
      SFX[name](ctx, this.sfxGain, this.noiseBuf, now + 0.005);
    } catch (err) {
      console.warn('[audio] sfx failed', name, err);
    }
  }

  setThrust(on: boolean): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxGain || !this.noiseBuf) return;
    const t = ctx.currentTime;
    if (on) {
      if (!this.thrust) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 55;
        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.25;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(lp).connect(gain);
        osc.connect(oscGain).connect(lp);
        gain.connect(this.sfxGain);
        src.start();
        osc.start();
        this.thrust = { src, osc, gain };
      }
      this.thrust.gain.gain.setTargetAtTime(0.22, t, 0.05);
    } else if (this.thrust) {
      this.thrust.gain.gain.setTargetAtTime(0, t, 0.08);
    }
  }

  startMusic(): void {
    this.wantMusic = true;
    const ctx = this.ensure();
    if (!ctx || !this.music) return;
    this.music.start();
  }

  stopMusic(): void {
    this.wantMusic = false;
    this.music?.stop();
    this.setThrust(false);
  }

  speak(text: string): void {
    if (!this.settings.readAloud || !text) return;
    speakNow(text);
  }

  /** Speak regardless of the readAloud setting (for the Settings "test" button). */
  speakTest(text: string): void {
    speakNow(text);
  }

  /** Suspend/resume the whole context (e.g. when the tab is hidden). */
  suspend(): void {
    this.setThrust(false);
    void this.ctx?.suspend().catch(() => {});
  }

  resumeContext(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  // -------------------------------------------------------------------------

  /** Perceptual volume curve so the slider feels linear. */
  private curve(v: number): number {
    const c = Math.min(1, Math.max(0, v));
    return c * c;
  }

  private installUnlock(): void {
    if (typeof window === 'undefined') return;
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    // iOS: play through the ringer/silent switch like a game, not like a ringtone (Safari 17+)
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = 'playback';
      } catch {
        /* older Safari: ignore */
      }
    }
    let primed = false;
    const unlock = () => {
      this.unlocked = true;
      if (!primed) {
        primed = true;
        primeSpeech();
      }
      const ctx = this.ensure();
      if (ctx && ctx.state === 'running') {
        events.forEach((e) => window.removeEventListener(e, unlock, true));
      }
    };
    events.forEach((e) => window.addEventListener(e, unlock, true));
  }

  /** Create (or resume) the AudioContext. Returns null before the first gesture. */
  private ensure(): AudioContext | null {
    if (this.ctx) {
      // iOS reports 'interrupted' after a call or the app going to the background
      if ((this.ctx.state as string) !== 'running' && this.unlocked && !document.hidden) {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }
    if (!this.unlocked) return null;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.musicGain = ctx.createGain();
      this.sfxGain = ctx.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.noiseBuf = createNoiseBuffer(ctx, 1.5);
      this.music = new MusicSequencer(ctx, this.musicGain, this.noiseBuf);
      this.setSettings(this.settings);
      this.musicGain.gain.value = this.curve(this.settings.musicVolume) * 0.6;
      this.sfxGain.gain.value = this.curve(this.settings.sfxVolume);
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      if (this.wantMusic) this.music.start();
      return ctx;
    } catch (err) {
      console.warn('[audio] WebAudio unavailable', err);
      return null;
    }
  }
}
