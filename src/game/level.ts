import * as THREE from 'three';
import type {
  AnswerEvent,
  AudioBus,
  GameCallbacks,
  LevelConfig,
  LevelOptions,
  LevelResult,
  Question,
  ShipLoadout,
} from '../types';
import { HITS_ALLOWED } from '../catalog';
import type { Asteroid, AsteroidField } from './asteroids';
import { circlesOverlap, segmentHitsCircle } from './collision';
import { AimGuide } from './aimGuide';
import { AIM_ASSIST, ASTEROID, ENTRY, HINT, LASER, LEVEL, SHIP, TAP_TARGET, type AsteroidSize } from './constants';
import type { Effects } from './effects';
import type { Graphics } from './graphics';
import type { HintKind, HintPart, Hud, ShieldState } from './hud';
import type { Input } from './input';
import { makeLabelSprite, type LabelFactory } from './labels';
import type { Laser, Lasers } from './lasers';
import type { Particles } from './particles';
import { Ship, type Controls } from './ship';

export interface GameContext {
  gfx: Graphics;
  particles: Particles;
  labels: LabelFactory;
  effects: Effects;
  field: AsteroidField;
  lasers: Lasers;
  hud: Hud;
  input: Input;
  audio: AudioBus;
}

const EQ_LABEL_H = 3.4;
const EQ_LABEL_MIN_PX = 36;
const EQ_LABEL_OFFSET = 6.2;

const ORIGIN = new THREE.Vector2();
/** Scratch list for Asteroid.images(). */
const IMAGES: THREE.Vector2[] = [];

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function randRange(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * Classic-mode rules for one level: spawning, questions, hits, splits, ship
 * collisions, shield, scoring and the level-end timeline.
 */
export class LevelController {
  readonly ship: Ship;
  private simTime = 0;
  private question: Question | null = null;
  private qStart = 0;
  private answers: AnswerEvent[] = [];
  private hitsTaken = 0;
  private score = 0;
  private shieldState: ShieldState;
  private state: 'playing' | 'ending' = 'playing';
  private outcome: 'cleared' | 'failed' = 'cleared';
  private endTimer = 0;
  private durationMs = 0;
  private fireworkT = 0;
  private respawnT = 0;
  private fireCd = 0;
  private eqLabel: THREE.Sprite;
  private eqAspect = 3;
  private eqBelow = true;
  private eqSide = -1;
  private eqTex: THREE.Texture | null = null;
  private controls: Controls = {
    turn: 0,
    thrust: 0,
    brake: 0,
    moveX: 0,
    moveY: 0,
    fire: false,
    stickX: 0,
    stickY: 0,
    stickActive: false,
  };
  private aimGuide: AimGuide;
  /** Ship stays invulnerable while rocks fly in, and for ENTRY.graceAfter after. */
  private entryGrace: number = ENTRY.graceAfter;
  private hintKind: HintKind | null = null;
  private hintT = 0;
  private tmpV = new THREE.Vector3();
  private disposed = false;
  private tapTarget: Asteroid | null = null;
  private tapT = 0;

  constructor(
    private ctx: GameContext,
    private config: LevelConfig,
    loadout: ShipLoadout,
    private callbacks: GameCallbacks,
    private options: LevelOptions,
  ) {
    const { gfx, field, lasers, hud } = ctx;
    field.clear();
    lasers.setStyle(loadout.laser, loadout.laserColor);
    ctx.effects.clear();

    this.ship = new Ship(loadout);
    this.ship.reset(0, 0);
    this.ship.shieldUp = loadout.perks.includes('shield');
    this.shieldState = this.ship.shieldUp ? 'up' : 'none';
    gfx.scene.add(this.ship.group);

    this.eqLabel = makeLabelSprite(null);
    this.eqLabel.visible = false;
    gfx.overlay.add(this.eqLabel);
    this.aimGuide = new AimGuide(gfx);

    hud.setLevel(config.levelNumber, config.stageName);
    hud.setHull(0, HITS_ALLOWED, this.shieldState);
    hud.setScore(0);
    hud.setMessage(null);
    hud.show(true);
    if (options.showControlsHint) {
      this.hintKind = ctx.input.isTouch ? 'touch' : options.controlMode;
      this.hintT = HINT.maxSec;
      hud.showHint(this.hintKind);
    }

    // The field starts empty: rocks wait off-screen and fly in after the first question.
    this.spawnInitial();
    if (field.liveValues().length === 0) this.endLevel('cleared');
    else this.nextQuestion();
  }

  private baseSpeed(size: AsteroidSize): number {
    return Math.min(ASTEROID.maxSpeed, Math.max(0, this.config.asteroidSpeed) * ASTEROID.speedMult[size]);
  }

  /**
   * Level start: every rock waits just outside a screen edge and flies in,
   * staggered over ENTRY.window seconds. Entry points favor the edges away from
   * the ship, and each path must cross the field without passing near the ship.
   */
  private spawnInitial(): void {
    const { gfx, field } = this.ctx;
    const n = Math.max(0, Math.floor(this.config.initialAsteroids));
    let values: number[] = [];
    try {
      values = this.config.questions.initialValues(n).slice(0, n);
    } catch (err) {
      console.error('[game] initialValues failed', err);
    }
    const { halfW, halfH } = gfx;
    const sx = this.ship.pos.x;
    const sy = this.ship.pos.y;
    const r = ASTEROID.radius[3];
    const pathLen = 2 * Math.max(halfW, halfH);
    const need = r + SHIP.radius + ENTRY.clearance;
    // edges: inward normal, and how far the ship is from each (favor the far side)
    const edges = [
      { nx: 1, ny: 0, len: halfH, w: (sx + halfW) / (2 * halfW) }, // left edge, heading right
      { nx: -1, ny: 0, len: halfH, w: (halfW - sx) / (2 * halfW) }, // right
      { nx: 0, ny: 1, len: halfW, w: (sy + halfH) / (2 * halfH) }, // bottom
      { nx: 0, ny: -1, len: halfW, w: (halfH - sy) / (2 * halfH) }, // top
    ].map((e) => ({ ...e, weight: e.len * (0.3 + e.w) }));
    const totalW = edges.reduce((t, e) => t + e.weight, 0);
    const starts: THREE.Vector2[] = [];

    for (let i = 0; i < values.length; i++) {
      let best: { x: number; y: number; ang: number; score: number } | null = null;
      for (let tries = 0; tries < 48; tries++) {
        let pick = Math.random() * totalW;
        let e = edges[0];
        for (const cand of edges) {
          e = cand;
          pick -= cand.weight;
          if (pick <= 0) break;
        }
        // keep entry points out of the top corners, under the hull and score widgets
        const u = (e.nx !== 0 ? randRange(-0.78, 0.5) : e.ny < 0 ? randRange(-0.62, 0.62) : randRange(-0.78, 0.78)) * e.len;
        const out = r + 0.6;
        // point just outside the edge (e.nx/ny point inward)
        const x = e.nx !== 0 ? -e.nx * (halfW + out) : u;
        const y = e.ny !== 0 ? -e.ny * (halfH + out) : u;
        const ang = Math.atan2(e.ny, e.nx) + randRange(-ENTRY.maxAngle, ENTRY.maxAngle);
        // closest approach of the path to the ship
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        const t = THREE.MathUtils.clamp((sx - x) * dx + (sy - y) * dy, 0, pathLen);
        const miss = Math.hypot(x + dx * t - sx, y + dy * t - sy);
        let spread = Infinity;
        for (const p of starts) spread = Math.min(spread, Math.hypot(p.x - x, p.y - y));
        const score = Math.min(miss - need, (spread - 2 * r - 2) * 0.5);
        if (!best || score > best.score) best = { x, y, ang, score };
        if (score >= 0) break;
      }
      if (!best) continue;
      starts.push(new THREE.Vector2(best.x, best.y));
      const cruise = this.baseSpeed(3) * randRange(0.8, 1.15);
      const delay = ENTRY.firstDelay + (values.length > 1 ? i / (values.length - 1) : 0) * ENTRY.window + randRange(0, 0.15);
      field.spawnEntering(3, values[i], best.x, best.y, best.ang, cruise, ENTRY.duration, delay);
    }
  }

  // -------------------------------------------------------------------------
  // Questions

  private nextQuestion(): void {
    const { field } = this.ctx;
    const live = field.liveValues();
    let q: Question;
    try {
      q = this.config.questions.pickQuestion(live);
    } catch (err) {
      console.error('[game] pickQuestion failed', err);
      return;
    }
    if (!live.includes(q.answer)) {
      // Contract violation: keep the level clearable by painting the answer on a rock.
      console.warn('[game] pickQuestion answer not on any live asteroid; repainting one', q, live);
      const labeled = field.list.filter((a) => a.value !== null);
      const target = labeled[(Math.random() * labeled.length) | 0];
      if (target) field.setValue(target, q.answer);
    }
    this.question = q;
    this.qStart = this.simTime;
    this.setEquationLabel(q.prompt);
    this.ctx.hud.setQuestion(q.prompt);
    this.safeCall(() => this.callbacks.onQuestion?.(q));
    this.ctx.audio.speak(q.speech);
  }

  private setEquationLabel(prompt: string | null): void {
    const mat = this.eqLabel.material as THREE.SpriteMaterial;
    if (this.eqTex) {
      this.eqTex.dispose();
      this.eqTex = null;
    }
    if (prompt === null) {
      mat.map = null;
      this.eqLabel.visible = false;
      return;
    }
    const accent = this.ship.color.rainbow ? '#ffffff' : `#${this.ship.color.color.getHexString()}`;
    const { tex, aspect } = this.ctx.labels.equationTexture(`${prompt} = ?`, accent);
    this.eqTex = tex;
    this.eqAspect = aspect;
    mat.map = tex;
    mat.needsUpdate = true;
  }

  private safeCall(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error('[game] callback threw', err);
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame

  get thrusting(): boolean {
    return this.ship.alive && this.ship.thrustAmt > 0.05;
  }

  /** Advance one frame. Returns the result once the level-end delay has elapsed. */
  update(dt: number, time: number): LevelResult | null {
    if (this.disposed) return null;
    const { gfx, input, lasers, field, particles } = this.ctx;
    this.simTime += dt;

    // ship
    input.read(this.controls);
    this.trackHint(dt);
    if (this.ship.alive) {
      const aligned = this.applyTapTarget(dt);
      this.ship.fly(dt, this.controls, gfx.halfW, gfx.halfH, this.options.controlMode);
      this.fireCd -= dt;
      if (this.fireCd <= 0 && lasers.count < LASER.max) {
        if (input.consumeFirePress()) this.fire(LASER.cooldown);
        else if (this.controls.fire) this.fire(LASER.holdRepeat);
        else if (aligned && this.tapTarget && this.aimError(this.tapTarget) < TAP_TARGET.alignTol) {
          this.fire(LASER.cooldown);
          this.tapTarget = null;
        }
      }
    } else if (this.respawnT > 0 && this.state === 'playing') {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
    }
    field.update(dt);
    this.updateInvulnerability(dt);
    this.ship.updateVisual(dt, time, particles);

    this.steerLasers(dt);
    lasers.update(dt, time, true);
    this.updateAimGuide(dt);

    if (this.state === 'playing') {
      this.checkLaserHits();
      if (this.state === 'playing') this.checkShipCollisions();
    }

    this.updateEquationLabel(dt);

    if (this.state === 'ending') {
      if (this.outcome === 'cleared') {
        this.fireworkT -= dt;
        if (this.fireworkT <= 0) {
          this.fireworkT = 0.35;
          this.ctx.effects.fireworks(2);
        }
      }
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        return {
          outcome: this.outcome,
          answers: this.answers.slice(),
          durationMs: this.durationMs,
          hitsTaken: this.hitsTaken,
          score: this.score,
        };
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Aim help

  /** Current question, or null between questions (used by the dev test hook). */
  get currentQuestion(): Question | null {
    return this.question;
  }

  /** Tap/click on the field (world coords): lock onto the nearest numbered rock under it. */
  tapAt(wx: number, wy: number): void {
    if (this.state !== 'playing' || !this.ship.alive) return;
    const pad = TAP_TARGET.pickPadPx / this.ctx.gfx.pxPerUnit;
    let best: Asteroid | null = null;
    let bestD = Infinity;
    for (const a of this.ctx.field.list) {
      if (a.value === null || !a.active) continue;
      // the wrapped copy at the far edge counts too: it's what the player sees
      const n = a.images(IMAGES);
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(IMAGES[i].x - wx, IMAGES[i].y - wy);
        if (d <= a.radius + pad && d < bestD) {
          best = a;
          bestD = d;
        }
      }
    }
    if (best) {
      this.tapTarget = best;
      this.tapT = TAP_TARGET.timeout;
    }
  }

  /** Heading the ship needs to hit `a` (with a little lead). */
  private aimAngle(a: Asteroid): number {
    const s = this.ship;
    // Lasers don't wrap, so aim straight at the rock (its center is always on screen).
    const dx0 = a.pos.x - s.pos.x;
    const dy0 = a.pos.y - s.pos.y;
    const t = Math.hypot(dx0, dy0) / LASER.speed;
    return Math.atan2(-(dx0 + a.vel.x * t), dy0 + a.vel.y * t);
  }

  private aimError(a: Asteroid): number {
    return Math.abs(wrapAngle(this.aimAngle(a) - this.ship.angle));
  }

  /** Steer the ship toward the tapped rock; manual steering cancels. Returns true while locked. */
  private applyTapTarget(dt: number): boolean {
    const tgt = this.tapTarget;
    if (!tgt) return false;
    this.tapT -= dt;
    const c = this.controls;
    const manual = this.options.controlMode === 'direct' ? c.moveX !== 0 || c.moveY !== 0 : c.turn !== 0;
    if (!tgt.alive || tgt.value === null || this.tapT <= 0 || manual || c.stickActive) {
      this.tapTarget = null;
      return false;
    }
    const diff = wrapAngle(this.aimAngle(tgt) - this.ship.angle);
    const maxStep = SHIP.turnRate * TAP_TARGET.turnMult * dt;
    // turn value > 1 = faster than manual turning; never overshoot the target heading
    const want = THREE.MathUtils.clamp(diff / (SHIP.turnRate * dt || 1), -TAP_TARGET.turnMult, TAP_TARGET.turnMult);
    c.turn = Math.abs(diff) < maxStep ? diff / (SHIP.turnRate * dt || 1) : want;
    return true;
  }

  /** Gentle magnetism: lasers curve toward the nearest numbered rock inside a narrow cone. */
  private steerLasers(dt: number): void {
    const { lasers, field } = this.ctx;
    for (const l of lasers.list) {
      if (l.cosmetic) continue;
      const heading = Math.atan2(l.vel.y, l.vel.x);
      let bestDiff = 0;
      let bestD = Infinity;
      for (const a of field.list) {
        if (a.value === null || !a.active) continue;
        const dx = a.pos.x - l.pos.x;
        const dy = a.pos.y - l.pos.y;
        const d = Math.hypot(dx, dy);
        if (d > AIM_ASSIST.range || d >= bestD) continue;
        const diff = wrapAngle(Math.atan2(dy, dx) - heading);
        if (Math.abs(diff) > AIM_ASSIST.cone) continue;
        bestD = d;
        bestDiff = diff;
      }
      if (bestD === Infinity) continue;
      const step = THREE.MathUtils.clamp(bestDiff, -AIM_ASSIST.turnRate * dt, AIM_ASSIST.turnRate * dt);
      l.vel.rotateAround(ORIGIN, step);
    }
  }

  private fire(cooldown: number): void {
    const { lasers, audio } = this.ctx;
    const m = this.ship.muzzleWorld(this.tmpV);
    lasers.fire(m.x, m.y, this.ship.angle, this.ship.vel.x * 0.5, this.ship.vel.y * 0.5);
    this.fireCd = cooldown;
    audio.play('laser');
    this.hintUsed('fire');
  }

  /**
   * The equation rides above the ship, or below it while the ship faces up so it
   * never covers the cannon and aim guide (with hysteresis, and a quick glide
   * between the two spots).
   */
  private updateEquationLabel(dt: number): void {
    const s = this.ship;
    const show = this.state === 'playing' && s.alive && this.question !== null;
    this.eqLabel.visible = show;
    if (!show) return;
    const gfx = this.ctx.gfx;
    const h = gfx.labelSize(EQ_LABEL_H, EQ_LABEL_MIN_PX);
    const w = h * this.eqAspect;
    this.eqLabel.scale.set(w, h, 1);
    const off = Math.max(EQ_LABEL_OFFSET, h * 0.5 + 3.2);
    const fy = s.forwardY();
    if (!this.eqBelow && fy > 0.55) this.eqBelow = true;
    else if (this.eqBelow && fy < 0.15) this.eqBelow = false;
    let want = this.eqBelow ? -1 : 1;
    if (want > 0 && s.pos.y + off + h / 2 > gfx.halfH) want = -1;
    else if (want < 0 && s.pos.y - off - h / 2 < -gfx.halfH) want = 1;
    this.eqSide += (want - this.eqSide) * Math.min(1, dt * 12);
    const y = s.pos.y + off * this.eqSide;
    const x = THREE.MathUtils.clamp(s.pos.x, -gfx.halfW + w / 2, gfx.halfW - w / 2);
    this.eqLabel.position.set(x, y, 6);
  }

  private checkLaserHits(): void {
    const { lasers, field } = this.ctx;
    for (const l of lasers.list.slice()) {
      if (l.cosmetic) continue;
      let hit: Asteroid | null = null;
      for (const a of field.list) {
        // rocks still flying in can't be shot yet: bolts pass through
        if (a.value === null || !a.active) continue;
        const n = a.images(IMAGES);
        for (let i = 0; i < n && !hit; i++) {
          const p = IMAGES[i];
          if (segmentHitsCircle(l.prev.x, l.prev.y, l.pos.x, l.pos.y, p.x, p.y, a.hitRadius + LASER.radius)) hit = a;
        }
        if (hit) break;
      }
      if (hit) {
        lasers.remove(l);
        this.onAsteroidHit(hit, l);
      }
      if (this.state !== 'playing') return;
    }
  }

  private onAsteroidHit(a: Asteroid, l: Laser): void {
    const q = this.question;
    if (!q || a.value === null) return;
    const { audio, effects, hud, field } = this.ctx;
    const responseMs = Math.max(0, Math.round((this.simTime - this.qStart) * 1000));
    const correct = a.value === q.answer;
    const ev: AnswerEvent = { factId: q.factId, correct, responseMs, chosenValue: a.value };
    this.answers.push(ev);
    this.safeCall(() => this.callbacks.onAnswer?.(ev));

    if (correct) {
      const bonus =
        responseMs <= LEVEL.speedBonusFullMs
          ? LEVEL.speedBonusMax
          : Math.max(
              0,
              Math.round(
                LEVEL.speedBonusMax * (1 - (responseMs - LEVEL.speedBonusFullMs) / (LEVEL.speedBonusZeroMs - LEVEL.speedBonusFullMs)),
              ),
            );
      this.score += LEVEL.scoreCorrect + bonus;
      hud.setScore(this.score);
      hud.react('correct');
      audio.play('correct');
      audio.play('explode');
      effects.correctBurst(a.pos.x, a.pos.y, a.radius);
      effects.popIcon('check', a.pos.x, a.pos.y);
      if (responseMs < LEVEL.speedyMs) effects.popSpeedy(bonus, a.pos.x, a.pos.y);
      effects.flash();
      field.remove(a);
      if (field.liveValues().length > 0) this.nextQuestion();
      else this.endLevel('cleared');
      return;
    }

    // wrong
    audio.play('wrong');
    hud.react('wrong');
    effects.popIcon('cross', a.pos.x, a.pos.y);
    const dirX = l.vel.x / (l.vel.length() || 1);
    const dirY = l.vel.y / (l.vel.length() || 1);
    if (a.size > 1) {
      this.split(a, q, dirX, dirY);
    } else {
      a.shakeT = 0.45;
      a.flashT = 0.35;
      a.vel.x += dirX * ASTEROID.wrongNudge;
      a.vel.y += dirY * ASTEROID.wrongNudge;
      this.clampSpeed(a);
      effects.sparks(a.pos.x, a.pos.y, a.rimMat.color);
    }
  }

  private split(a: Asteroid, q: Question, dirX: number, dirY: number): void {
    const { field, audio, effects } = this.ctx;
    const size = (a.size - 1) as AsteroidSize;
    const canSpawnSecond = field.list.length < this.config.maxAsteroids;
    const parentValue = a.value;
    const { x, y } = a.pos;
    const baseAngle = a.vel.lengthSq() > 0.01 ? Math.atan2(a.vel.y, a.vel.x) : Math.atan2(dirY, dirX);
    // children barely speed up: their own base speed, never the parent's accumulated kicks
    const sp = this.baseSpeed(size);
    field.remove(a);
    audio.play('split');
    effects.rockPuff(x, y, a.radius);

    const r = ASTEROID.radius[size];
    const mk = (value: number, side: number) => {
      const ang = baseAngle + side * randRange(ASTEROID.splitSpread[0], ASTEROID.splitSpread[1]);
      const s = sp * randRange(0.92, 1.05);
      const px = x + Math.cos(ang) * r * 0.7;
      const py = y + Math.sin(ang) * r * 0.7;
      const k = ASTEROID.splitKick;
      const child = field.spawn(size, value, px, py, Math.cos(ang) * s + dirX * k, Math.sin(ang) * s + dirY * k);
      this.clampSpeed(child);
      child.shakeT = 0.45;
      child.flashT = 0.35;
      return child;
    };
    mk(parentValue as number, 1);
    if (canSpawnSecond) {
      let v: number;
      try {
        v = this.config.questions.splitValue(q, field.liveValues());
      } catch (err) {
        console.error('[game] splitValue failed', err);
        v = parentValue as number;
      }
      mk(v, -1);
    }
  }

  private checkShipCollisions(): void {
    const s = this.ship;
    if (!s.alive || s.invuln > 0 || this.entryGrace > 0) return;
    const a = this.touchingRock(0);
    if (!a) return;
    this.bounceAsteroid(a);
    if (s.shieldUp) this.absorbWithShield(a);
    else this.shipHit();
  }

  /** First active rock whose body (or wrapped copy) overlaps the ship, grown by `pad`. */
  private touchingRock(pad: number): Asteroid | null {
    const s = this.ship;
    for (const a of this.ctx.field.list) {
      if (!a.active) continue;
      const n = a.images(IMAGES);
      for (let i = 0; i < n; i++) {
        if (circlesOverlap(s.pos.x, s.pos.y, SHIP.radius + pad, IMAGES[i].x, IMAGES[i].y, a.bodyRadius)) {
          // bounce relative to the copy that touched
          if (i > 0) a.pos.copy(IMAGES[i]);
          return a;
        }
      }
    }
    return null;
  }

  private clampSpeed(a: Asteroid): void {
    const sp = a.vel.length();
    if (sp > ASTEROID.maxSpeed) a.vel.multiplyScalar(ASTEROID.maxSpeed / sp);
  }

  private bounceAsteroid(a: Asteroid): void {
    const s = this.ship;
    let nx = a.pos.x - s.pos.x;
    let ny = a.pos.y - s.pos.y;
    let len = Math.hypot(nx, ny);
    if (len < 0.001) {
      const r = Math.random() * Math.PI * 2;
      nx = Math.cos(r);
      ny = Math.sin(r);
      len = 1;
    }
    nx /= len;
    ny /= len;
    // gentle bounce: drift away slowly, never faster than it was going
    const sp = Math.max(1, Math.min(a.vel.length(), this.baseSpeed(a.size)) * ASTEROID.bounceSpeed);
    a.vel.set(nx * sp, ny * sp);
    const push = SHIP.radius + a.bodyRadius + 0.6;
    a.pos.set(s.pos.x + nx * push, s.pos.y + ny * push);
    a.shakeT = 0.45;
    a.flashT = 0.3;
  }

  private absorbWithShield(a: Asteroid): void {
    const s = this.ship;
    const { audio, effects, hud } = this.ctx;
    s.popShield();
    s.invuln = 1.0;
    const nx = a.pos.x - s.pos.x;
    const ny = a.pos.y - s.pos.y;
    const l = Math.hypot(nx, ny) || 1;
    s.vel.set((-nx / l) * 12, (-ny / l) * 12);
    audio.play('shieldHit');
    effects.shieldPop(s.pos.x, s.pos.y, s.color.color);
    this.ctx.gfx.shake(0.5, 0.2);
    this.shieldState = 'used';
    hud.setHull(this.hitsTaken, HITS_ALLOWED, this.shieldState);
  }

  private shipHit(): void {
    const s = this.ship;
    const { audio, effects, hud, gfx } = this.ctx;
    this.hitsTaken++;
    audio.play('shipHit');
    gfx.shake(1.3, 0.45);
    effects.shipExplosion(s.pos.x, s.pos.y, s.color.color);
    s.alive = false;
    s.thrustAmt = 0;
    s.vel.set(0, 0);
    hud.setHull(this.hitsTaken, HITS_ALLOWED, this.shieldState);
    this.safeCall(() => this.callbacks.onShipHit?.(this.hitsTaken, HITS_ALLOWED));
    if (this.hitsTaken >= HITS_ALLOWED) this.endLevel('failed');
    else this.respawnT = SHIP.respawnDelay;
  }

  private respawn(): void {
    const p = this.safeSpawnPoint();
    this.ship.reset(p.x, p.y);
    this.ship.invuln = SHIP.invulnSec;
    this.ctx.input.consumeFirePress();
    this.fireCd = 0.2;
  }

  /** Respawn at the center unless a rock is close; then at the roomiest spot. */
  private safeSpawnPoint(): { x: number; y: number } {
    const { halfW, halfH } = this.ctx.gfx;
    const cands: Array<[number, number]> = [[0, 0]];
    for (const fx of [-0.5, 0, 0.5]) for (const fy of [-0.45, 0, 0.45]) if (fx || fy) cands.push([fx * halfW, fy * halfH]);
    let best = cands[0];
    let bestRoom = -Infinity;
    for (const [x, y] of cands) {
      let room = Infinity;
      for (const a of this.ctx.field.list) {
        const n = a.images(IMAGES);
        for (let i = 0; i < n; i++) room = Math.min(room, Math.hypot(IMAGES[i].x - x, IMAGES[i].y - y) - a.radius);
      }
      if (x === 0 && y === 0 && room >= ASTEROID.safeRadius) return { x, y };
      // slight preference for spots near the center
      const score = Math.min(room, ASTEROID.safeRadius * 1.5) - Math.hypot(x, y) * 0.05;
      if (score > bestRoom) {
        bestRoom = score;
        best = [x, y];
      }
    }
    return { x: best[0], y: best[1] };
  }

  /**
   * Keep the ship safe while rocks fly in (plus a moment after), and never let
   * invulnerability run out while it's still inside a rock.
   */
  private updateInvulnerability(dt: number): void {
    const s = this.ship;
    if (this.ctx.field.entering) this.entryGrace = ENTRY.graceAfter;
    else if (this.entryGrace > 0) this.entryGrace = Math.max(0, this.entryGrace - dt);
    if (!s.alive || this.state !== 'playing') return;
    // (entry grace is silent: no blinking while the ship waits for the rocks)
    if (s.invuln > 0 && s.invuln < 0.25 && this.touchingRock(1.2)) s.invuln = 0.25;
    else if (s.invuln <= 0 && this.entryGrace > 0 && this.entryGrace < 0.25 && this.touchingRock(1.2)) this.entryGrace = 0.25;
  }

  private updateAimGuide(dt: number): void {
    const s = this.ship;
    const show = this.state === 'playing' && s.alive;
    if (!show) {
      this.aimGuide.update(dt, 0, 0, 0, this.ctx.lasers.currentColor, false);
      return;
    }
    const m = s.muzzleWorld(this.tmpV);
    this.aimGuide.update(dt, m.x, m.y, s.angle, this.ctx.lasers.currentColor, true);
  }

  // -------------------------------------------------------------------------
  // Controls hint

  /** Fade hint chips as the player uses each control; everything goes after HINT.maxSec. */
  private trackHint(dt: number): void {
    const kind = this.hintKind;
    if (!kind) return;
    this.hintT -= dt;
    if (this.hintT <= 0) {
      this.ctx.hud.hideHint();
      this.hintKind = null;
      return;
    }
    const c = this.controls;
    const keys = !c.stickActive && (c.thrust > 0 || c.brake > 0 || c.turn !== 0);
    if (kind === 'touch' && keys) {
      // a touch-capable device that's actually being played with a keyboard
      const hadFire = !this.ctx.hud.hintHas('fire');
      this.hintKind = this.options.controlMode;
      this.ctx.hud.showHint(this.hintKind);
      if (hadFire) this.ctx.hud.hintUsed('fire');
    }
    if (c.stickActive) this.hintUsed('stick');
    if (this.hintKind === 'rotate') {
      if (c.thrust > 0 || c.stickActive) this.hintUsed('fly');
      if (c.turn !== 0 || c.stickActive) this.hintUsed('turn');
      if (c.brake > 0) this.hintUsed('brake');
    } else if (this.hintKind === 'direct') {
      if (c.moveX !== 0 || c.moveY !== 0 || c.stickActive) this.hintUsed('move');
    }
  }

  private hintUsed(p: HintPart): void {
    if (!this.hintKind) return;
    if (this.ctx.hud.hintUsed(p)) this.hintKind = null;
  }

  private endLevel(outcome: 'cleared' | 'failed'): void {
    if (this.state === 'ending') return;
    const { audio, hud, effects } = this.ctx;
    this.state = 'ending';
    this.outcome = outcome;
    this.durationMs = Math.round(this.simTime * 1000);
    this.endTimer = outcome === 'cleared' ? LEVEL.clearDelay : LEVEL.failDelay;
    this.question = null;
    this.setEquationLabel(null);
    hud.setQuestion(null);
    hud.hideHint();
    this.hintKind = null;
    if (outcome === 'cleared') {
      audio.play('levelClear');
      hud.setMessage('★ Level clear! ★', 'clear');
      effects.fireworks(3);
      this.fireworkT = 0.35;
    } else {
      audio.play('levelFail');
      hud.setMessage('Good try!', 'fail');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ship.dispose();
    this.aimGuide.dispose();
    this.ctx.hud.hideHint();
    if (this.eqTex) this.eqTex.dispose();
    (this.eqLabel.material as THREE.SpriteMaterial).dispose();
    this.eqLabel.removeFromParent();
  }
}

