import * as THREE from 'three';
import type { AudioBus, GameCallbacks, GameEngine, LevelConfig, LevelOptions, ShipLoadout } from '../types';
import { AsteroidField } from './asteroids';
import { Background } from './background';
import { ASTEROID, ATTRACT_ASTEROIDS, type AsteroidSize } from './constants';
import { Effects } from './effects';
import { Graphics } from './graphics';
import { HangarView } from './hangar';
import { Hud } from './hud';
import { Input } from './input';
import { LabelFactory } from './labels';
import { Lasers } from './lasers';
import { LevelController, type GameContext } from './level';
import { Particles } from './particles';

type Mode = 'attract' | 'level' | 'hangar';

/**
 * Top-level engine: owns the render loop and switches between attract mode
 * (drifting rocks behind menus), a running level, and the hangar preview.
 */
export class Engine implements GameEngine {
  private ctx: GameContext;
  private gfx: Graphics;
  private background: Background;
  private mode: Mode = 'attract';
  private level: LevelController | null = null;
  private callbacks: GameCallbacks | null = null;
  private hangar: HangarView | null = null;
  private paused = false;
  private userPaused = false;
  private thrustOn = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private attractSpawnT = 0;
  private focus = new THREE.Vector2();
  private resizeObs: ResizeObserver | null = null;
  private disposed = false;
  private cleanup: Array<() => void> = [];

  constructor(
    private container: HTMLElement,
    private audio: AudioBus,
  ) {
    container.classList.add('mt-root');
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    if (container.clientHeight === 0) {
      container.style.position = 'fixed';
      container.style.inset = '0';
    }

    this.gfx = new Graphics(container);
    this.background = new Background(this.gfx);
    const labels = new LabelFactory();
    const particles = new Particles(this.gfx);
    const effects = new Effects(this.gfx, particles, labels, container);
    const field = new AsteroidField(this.gfx, labels);
    const lasers = new Lasers(this.gfx);
    const hud = new Hud(
      container,
      () => this.userPause(),
      () => this.userResume(),
    );
    const input = new Input(
      container,
      () => this.userPause(),
      (cx, cy) => this.onTap(cx, cy),
    );
    this.ctx = { gfx: this.gfx, particles, labels, effects, field, lasers, hud, input, audio };

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.onResize());
      this.resizeObs.observe(container);
    }
    const onWinResize = () => this.onResize();
    window.addEventListener('resize', onWinResize);
    this.cleanup.push(() => window.removeEventListener('resize', onWinResize));
    const onVis = () => {
      if (document.hidden && this.mode === 'level' && !this.paused) this.userPause();
    };
    document.addEventListener('visibilitychange', onVis);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', onVis));

    this.enterAttract(false);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private onResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.gfx.resize(w, h);
  }

  // -------------------------------------------------------------------------
  // GameEngine API

  startLevel(config: LevelConfig, loadout: ShipLoadout, callbacks: GameCallbacks, options: LevelOptions): void {
    if (this.disposed) return;
    this.teardownMode();
    this.mode = 'level';
    this.callbacks = callbacks;
    this.ctx.particles.setDepthTest(false);
    this.ctx.input.setEnabled(true);
    const opts: LevelOptions = {
      controlMode: options?.controlMode === 'direct' ? 'direct' : 'rotate',
      showControlsHint: !!options?.showControlsHint,
    };
    this.level = new LevelController(this.ctx, config, loadout, callbacks, opts);
  }

  /** Freeze the simulation (idempotent). Rendering continues. */
  pause(): void {
    if (this.disposed || this.paused) return;
    this.paused = true;
    this.ctx.input.setPaused(true);
    this.setThrust(false);
  }

  /** Unfreeze (idempotent). */
  resume(): void {
    if (this.disposed || !this.paused) return;
    this.paused = false;
    this.userPaused = false;
    this.ctx.hud.setPaused(false);
    this.ctx.input.setPaused(false);
    this.ctx.input.consumeFirePress();
    this.last = performance.now();
  }

  stop(): void {
    if (this.disposed) return;
    this.teardownMode();
    this.enterAttract(true);
  }

  showAttract(): void {
    if (this.disposed) return;
    if (this.mode === 'attract') return;
    this.teardownMode();
    this.enterAttract(true);
  }

  showHangar(loadout: ShipLoadout, center?: { x: number; y: number }): void {
    if (this.disposed) return;
    const c = center ?? { x: 0.5, y: 0.5 };
    if (this.mode === 'hangar' && this.hangar) {
      this.hangar.setLoadout(loadout);
      this.hangar.setCenter(c.x, c.y);
      return;
    }
    this.teardownMode();
    this.mode = 'hangar';
    this.paused = false;
    const { field, particles, effects, lasers, hud } = this.ctx;
    field.clear();
    particles.clear();
    particles.setDepthTest(true);
    effects.clear();
    hud.show(false);
    this.hangar = new HangarView(this.gfx, lasers, loadout);
    this.hangar.setCenter(c.x, c.y);
  }

  dispose(): void {
    if (this.disposed) return;
    this.teardownMode();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    for (const c of this.cleanup) c();
    const { field, particles, effects, lasers, hud, input, labels } = this.ctx;
    field.dispose();
    lasers.dispose();
    particles.dispose();
    effects.dispose();
    labels.dispose();
    hud.dispose();
    input.dispose();
    this.background.dispose();
    this.gfx.dispose();
    this.container.classList.remove('mt-root', 'mt-is-touch');
  }

  // -------------------------------------------------------------------------
  // Internal

  /**
   * Pause requested from inside the game (P/Esc, HUD pause button, tab hidden).
   * main gets onPause() and shows its menu; without an onPause handler (e.g. the
   * dev harness) the HUD shows its own small pause card with a Resume button.
   */
  private userPause(): void {
    if (this.mode !== 'level' || this.paused) return;
    this.pause();
    const cb = this.callbacks;
    if (cb?.onPause) {
      try {
        cb.onPause();
      } catch (err) {
        console.error('[game] onPause threw', err);
      }
    } else {
      this.userPaused = true;
      this.ctx.hud.setPaused(true);
    }
  }

  /** Tap/click on the canvas → world coords → tap-to-target. */
  /**
   * Dev/test hook (exposed on window only in dev builds): the current answer and
   * live rocks, plus a way to tap-target the rock carrying a given value.
   */
  debug() {
    return {
      answer: this.level?.currentQuestion?.answer ?? null,
      rocks: this.ctx.field.list
        .filter((a) => a.value !== null)
        .map((a) => ({
          value: a.value,
          x: a.pos.x,
          y: a.pos.y,
          vx: a.vel.x,
          vy: a.vel.y,
          r: a.radius,
          entering: a.entering,
          label: a.label ? { x: a.label.position.x, y: a.label.position.y, w: a.label.scale.x, h: a.label.scale.y, visible: a.label.visible } : null,
        })),
      simTime: this.time,
      view: { halfW: this.gfx.halfW, halfH: this.gfx.halfH, pxPerUnit: this.gfx.pxPerUnit },
      ship: this.level
        ? { x: this.level.ship.pos.x, y: this.level.ship.pos.y, angle: this.level.ship.angle, invuln: this.level.ship.invuln, alive: this.level.ship.alive }
        : null,
      lasers: this.ctx.lasers.list.map((l) => ({ x: l.pos.x, y: l.pos.y, age: l.age })),
      tapValue: (value: number) => {
        const a = this.ctx.field.list.find((r) => r.value === value && r.active);
        if (a && this.level) this.level.tapAt(a.pos.x, a.pos.y);
        return !!a;
      },
      /** Move the first rock carrying `value` (for screenshots of edge cases). */
      placeRock: (value: number, x: number, y: number, vx = 0, vy = 0) => {
        const a = this.ctx.field.list.find((r) => r.value === value);
        if (!a) return false;
        a.entering = false;
        a.pos.set(x, y);
        a.vel.set(vx, vy);
        return true;
      },
      /** Put the ship somewhere and point it (angle 0 = up). */
      placeShip: (x: number, y: number, angle = 0) => {
        if (!this.level) return false;
        this.level.ship.pos.set(x, y);
        this.level.ship.vel.set(0, 0);
        this.level.ship.angle = angle;
        return true;
      },
    };
  }

  private onTap(clientX: number, clientY: number): void {
    if (this.mode !== 'level' || this.paused || !this.level) return;
    const r = this.gfx.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const wx = ((clientX - r.left) / r.width) * 2 * this.gfx.halfW - this.gfx.halfW;
    const wy = this.gfx.halfH - ((clientY - r.top) / r.height) * 2 * this.gfx.halfH;
    this.level.tapAt(wx, wy);
  }

  private userResume(): void {
    if (!this.userPaused) return;
    this.resume();
  }

  private setThrust(on: boolean): void {
    if (on === this.thrustOn) return;
    this.thrustOn = on;
    this.audio.setThrust(on);
  }

  private teardownMode(): void {
    this.setThrust(false);
    if (this.level) {
      this.level.dispose();
      this.level = null;
    }
    this.callbacks = null;
    if (this.hangar) {
      this.hangar.dispose();
      this.hangar = null;
    }
    this.ctx.input.setEnabled(false);
    this.ctx.input.setPaused(false);
    this.ctx.hud.show(false);
    this.paused = false;
    this.userPaused = false;
  }

  private enterAttract(keepField: boolean): void {
    this.mode = 'attract';
    const { field, lasers, particles } = this.ctx;
    particles.setDepthTest(false);
    lasers.clear();
    if (!keepField) field.clear();
    // leftover level rocks lose their numbers behind the menus
    for (const a of field.list) if (a.value !== null) field.setValue(a, null);
    this.attractSpawnT = 0.5;
  }

  private spawnAttractRock(): void {
    const { gfx, field } = this.ctx;
    const size = (1 + ((Math.random() * 3) | 0)) as AsteroidSize;
    const edge = Math.random() * 4;
    const m = ASTEROID.radius[size] + 0.5;
    let x: number;
    let y: number;
    if (edge < 1) [x, y] = [-gfx.halfW - m, (Math.random() * 2 - 1) * gfx.halfH];
    else if (edge < 2) [x, y] = [gfx.halfW + m, (Math.random() * 2 - 1) * gfx.halfH];
    else if (edge < 3) [x, y] = [(Math.random() * 2 - 1) * gfx.halfW, -gfx.halfH - m];
    else [x, y] = [(Math.random() * 2 - 1) * gfx.halfW, gfx.halfH + m];
    // drift roughly across the field
    const a = Math.atan2(-y, -x) + (Math.random() - 0.5) * 1.2;
    const sp = 2 + Math.random() * 2.5;
    // drifts in at its cruise speed (no fly-in boost), then wraps like any rock
    field.spawnEntering(size, null, x, y, a, sp, 999, 0);
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      this.frame(dt);
    } catch (err) {
      console.error('[game] frame error', err);
    }
  };

  private frame(dt: number): void {
    const { particles, effects, field, lasers } = this.ctx;
    const simDt = this.paused ? 0 : dt;
    this.time += simDt;
    const t = this.time;

    if (simDt > 0) {
      switch (this.mode) {
        case 'level': {
          const lvl = this.level;
          if (lvl) {
            const result = lvl.update(simDt, t);
            this.setThrust(lvl.thrusting);
            this.focus.copy(lvl.ship.pos);
            if (result) {
              const cb = this.callbacks;
              this.teardownMode();
              this.enterAttract(true);
              try {
                cb?.onLevelEnd(result);
              } catch (err) {
                console.error('[game] onLevelEnd threw', err);
              }
            }
          }
          break;
        }
        case 'hangar':
          this.hangar?.update(simDt, t, particles);
          this.focus.multiplyScalar(0.95);
          break;
        default: {
          field.update(simDt);
          lasers.update(simDt, t, true);
          this.attractSpawnT -= simDt;
          if (this.attractSpawnT <= 0) {
            this.attractSpawnT = 1.5;
            if (field.list.length < ATTRACT_ASTEROIDS) this.spawnAttractRock();
          }
          this.focus.multiplyScalar(0.98);
        }
      }
      particles.update(simDt, t);
      effects.update(simDt);
    }
    this.background.update(simDt, t, this.focus);
    this.gfx.render(dt);
  }
}
