import * as THREE from 'three';
import type { AnswerEvent, AudioBus, GameCallbacks, LevelConfig, LevelResult, Question, ShipLoadout } from '../types';
import { HITS_ALLOWED } from '../catalog';
import type { Asteroid, AsteroidField } from './asteroids';
import { circlesOverlap, segmentHitsCircle } from './collision';
import { AIM_ASSIST, ASTEROID, LASER, LEVEL, SHIP, TAP_TARGET, type AsteroidSize } from './constants';
import type { Effects } from './effects';
import type { Graphics } from './graphics';
import type { Hud, ShieldState } from './hud';
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
  private eqTex: THREE.Texture | null = null;
  private controls: Controls = { turn: 0, thrust: 0, fire: false, stickX: 0, stickY: 0, stickActive: false };
  private tmpV = new THREE.Vector3();
  private disposed = false;
  private tapTarget: Asteroid | null = null;
  private tapT = 0;

  constructor(
    private ctx: GameContext,
    private config: LevelConfig,
    loadout: ShipLoadout,
    private callbacks: GameCallbacks,
  ) {
    const { gfx, field, lasers, hud } = ctx;
    field.clear();
    lasers.setStyle(loadout.laser, loadout.laserColor);
    ctx.effects.clear();

    this.ship = new Ship(loadout);
    this.ship.reset(0, 0);
    this.ship.invuln = SHIP.spawnGrace;
    this.ship.shieldUp = loadout.perks.includes('shield');
    this.shieldState = this.ship.shieldUp ? 'up' : 'none';
    gfx.scene.add(this.ship.group);

    this.eqLabel = makeLabelSprite(null);
    this.eqLabel.visible = false;
    gfx.overlay.add(this.eqLabel);

    hud.setLevel(config.levelNumber, config.stageName);
    hud.setHull(0, HITS_ALLOWED, this.shieldState);
    hud.setScore(0);
    hud.setMessage(null);
    hud.show(true);

    this.spawnInitial();
    if (field.liveValues().length === 0) this.endLevel('cleared');
    else this.nextQuestion();
  }

  private baseSpeed(size: AsteroidSize): number {
    return this.config.asteroidSpeed * ASTEROID.speedMult[size];
  }

  private spawnInitial(): void {
    const { gfx, field } = this.ctx;
    const n = Math.max(0, Math.floor(this.config.initialAsteroids));
    let values: number[] = [];
    try {
      values = this.config.questions.initialValues(n).slice(0, n);
    } catch (err) {
      console.error('[game] initialValues failed', err);
    }
    const safe = Math.min(ASTEROID.safeRadius, Math.min(gfx.halfW, gfx.halfH) * 0.8);
    for (let i = 0; i < values.length; i++) {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 40; tries++) {
        x = randRange(-gfx.halfW, gfx.halfW);
        y = randRange(-gfx.halfH, gfx.halfH);
        if (Math.hypot(x, y) >= safe) break;
        if (tries === 39) {
          // fall back to the screen edge
          const a = Math.random() * Math.PI * 2;
          x = Math.cos(a) * gfx.halfW;
          y = Math.sin(a) * gfx.halfH;
        }
      }
      const a = Math.random() * Math.PI * 2;
      const sp = this.baseSpeed(3) * randRange(0.75, 1.25);
      field.spawn(3, values[i], x, y, Math.cos(a) * sp, Math.sin(a) * sp, true);
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
    if (this.ship.alive) {
      const aligned = this.applyTapTarget(dt);
      this.ship.fly(dt, this.controls, gfx.halfW, gfx.halfH);
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
    this.ship.updateVisual(dt, time, particles);

    field.update(dt);
    this.steerLasers(dt);
    lasers.update(dt, time, true);

    if (this.state === 'playing') {
      this.checkLaserHits();
      if (this.state === 'playing') this.checkShipCollisions();
    }

    this.updateEquationLabel();

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
      if (a.value === null) continue;
      const d = Math.hypot(a.pos.x - wx, a.pos.y - wy);
      if (d <= a.radius + pad && d < bestD) {
        best = a;
        bestD = d;
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
    // Aim along the shortest path on the wrapping field (lasers wrap with a 1-unit
    // margin), so rocks across the screen edge are within laser range.
    const { halfW, halfH } = this.ctx.gfx;
    const dx0 = shortestWrap(a.pos.x - s.pos.x, 2 * (halfW + 1));
    const dy0 = shortestWrap(a.pos.y - s.pos.y, 2 * (halfH + 1));
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
    if (!tgt.alive || tgt.value === null || this.tapT <= 0 || c.turn !== 0 || c.stickActive) {
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
        if (a.value === null) continue;
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
  }

  private updateEquationLabel(): void {
    const s = this.ship;
    const show = this.state === 'playing' && s.alive && this.question !== null;
    this.eqLabel.visible = show;
    if (!show) return;
    const gfx = this.ctx.gfx;
    const h = gfx.labelSize(EQ_LABEL_H, EQ_LABEL_MIN_PX);
    const w = h * this.eqAspect;
    this.eqLabel.scale.set(w, h, 1);
    const off = Math.max(EQ_LABEL_OFFSET, h * 0.5 + 3.2);
    let y = s.pos.y + off;
    if (y + h / 2 > gfx.halfH) y = s.pos.y - off;
    const x = THREE.MathUtils.clamp(s.pos.x, -gfx.halfW + w / 2, gfx.halfW - w / 2);
    this.eqLabel.position.set(x, y, 6);
  }

  private checkLaserHits(): void {
    const { lasers, field } = this.ctx;
    for (const l of lasers.list.slice()) {
      if (l.cosmetic) continue;
      for (const a of field.list) {
        if (a.value === null) continue;
        if (segmentHitsCircle(l.prev.x, l.prev.y, l.pos.x, l.pos.y, a.pos.x, a.pos.y, a.hitRadius + LASER.radius)) {
          lasers.remove(l);
          this.onAsteroidHit(a, l);
          break;
        }
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
      a.vel.x += dirX * 5;
      a.vel.y += dirY * 5;
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
    const sp = Math.max(a.vel.length(), this.baseSpeed(size)) * 1.15;
    field.remove(a);
    audio.play('split');
    effects.rockPuff(x, y, a.radius);

    const r = ASTEROID.radius[size];
    const mk = (value: number, side: number) => {
      const ang = baseAngle + side * randRange(0.45, 0.8);
      const s = sp * randRange(0.9, 1.15);
      const px = x + Math.cos(ang) * r * 0.7;
      const py = y + Math.sin(ang) * r * 0.7;
      const child = field.spawn(size, value, px, py, Math.cos(ang) * s + dirX * 2, Math.sin(ang) * s + dirY * 2);
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
    if (!s.alive || s.invuln > 0) return;
    const { field } = this.ctx;
    for (const a of field.list) {
      if (!circlesOverlap(s.pos.x, s.pos.y, SHIP.radius, a.pos.x, a.pos.y, a.hitRadius)) continue;
      this.bounceAsteroid(a);
      if (s.shieldUp) this.absorbWithShield(a);
      else this.shipHit();
      return;
    }
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
    const sp = Math.max(a.vel.length(), this.baseSpeed(a.size)) * 1.1;
    a.vel.set(nx * sp, ny * sp);
    const push = SHIP.radius + a.hitRadius + 0.6;
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
    this.ship.reset(0, 0);
    this.ship.invuln = SHIP.invulnSec;
    this.ctx.input.consumeFirePress();
    this.fireCd = 0.2;
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
    if (this.eqTex) this.eqTex.dispose();
    (this.eqLabel.material as THREE.SpriteMaterial).dispose();
    this.eqLabel.removeFromParent();
  }
}

/** Map a coordinate delta on a wrapping axis of length `period` into [-period/2, period/2]. */
function shortestWrap(d: number, period: number): number {
  return d - period * Math.round(d / period);
}
