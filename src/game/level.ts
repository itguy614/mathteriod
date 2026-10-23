import * as THREE from 'three';
import type {
  AnswerEvent,
  AudioBus,
  Fact,
  GameCallbacks,
  LevelConfig,
  LevelOptions,
  LevelResult,
  Question,
  ReverseProvider,
  ShipLoadout,
  WaveKind,
} from '../types';
import { HITS_ALLOWED } from '../catalog';
import type { Asteroid, AsteroidField } from './asteroids';
import { circlesOverlap, segmentHitsCircle } from './collision';
import { AimGuide } from './aimGuide';
import { AIM_ASSIST, ASTEROID, BOSS, ENTRY, HINT, HULL, LASER, LEVEL, POWERUP, REVEAL, SHIP, TAP_TARGET, UFO, WAVE, type AsteroidSize } from './constants';
import { POWER_INFO, POWER_KINDS, PowerUpField, Ufo, type Crystal, type PowerKind } from './bonus';
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
/** Hull capacity in segments (HULL.segmentsPerShip per ship icon). */
const HULL_MAX = HITS_ALLOWED * HULL.segmentsPerShip;
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
 * collisions, hull damage and repair, shield, scoring and the level-end timeline.
 */
export class LevelController {
  readonly ship: Ship;
  private simTime = 0;
  private question: Question | null = null;
  private qStart = 0;
  /** Ship heading when the answer clock started (for the turn allowance). */
  private qHeading = 0;
  /** Seconds the ship spent destroyed since the answer clock started. */
  private qDead = 0;
  /** Last tap on a rock: tap-to-target answers are timed from the tap. */
  private tapDecision: { target: Asteroid; t: number } | null = null;
  /** When each bolt was fired, the ship's heading then, and the tap time when it was a tap-to-target shot. */
  private laserShots = new WeakMap<Laser, { t: number; heading: number; tapT: number | null }>();
  private answers: AnswerEvent[] = [];
  /** Collisions this level (reported in the result). */
  private hitsTaken = 0;
  /** Hull damage in segments, 0..HULL_MAX. Collisions and wrong answers add, correct streaks repair. */
  private damage = 0;
  /** Correct answers in a row; a wrong answer resets it. */
  private streak = 0;
  private bestStreak = 0;
  /** Hull segments lost this level (for the result; repairs don't subtract). */
  private damageTaken = 0;
  private wrongGrace = 0;
  /** Wrong answers on the current question (drives the fact reveal and rock hint). */
  private questionMisses = 0;
  /** Time left showing the revealed fact instead of "= ?". */
  private revealT = 0;
  /** Reverse wave in play: rocks carry equations, the question is a target number. */
  private reverse: ReverseProvider | null = null;
  private waves: WaveKind[];
  private waveIndex = 0;
  /** Breather between waves; the next wave starts when it runs out. */
  private betweenT = 0;
  private powerups: PowerUpField;
  /** The collected power-up in effect, and its time left. */
  private power: { kind: PowerKind; t: number } | null = null;
  /** Bolts fired with Big blaster active. */
  private wideLasers = new WeakSet<Laser>();
  private ufo: Ufo | null = null;
  /** Countdown to this wave's UFO, or null when the wave has none. */
  private ufoT: number | null = null;
  private ufoHits = 0;
  /** Boss wave in play: the boss rock, its orbiting numbered shards, and its health. */
  private boss: { rock: Asteroid; shards: Asteroid[]; hp: number; t: number } | null = null;
  private bossesBeaten = 0;
  /** Rock each bolt locked onto when fired (aim assist curves only toward it). */
  private laserTargets = new WeakMap<Laser, Asteroid>();
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
    flyActive: false,
    flyX: 0,
    flyY: 0,
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

    this.waves = config.waves.length > 0 ? config.waves : ['classic'];
    this.powerups = new PowerUpField(gfx, ctx.labels);
    this.ship = new Ship(loadout);
    this.ship.reset(0, 0);
    this.ship.shieldUp = loadout.perks.includes('shield');
    this.shieldState = this.ship.shieldUp ? 'up' : 'none';
    gfx.scene.add(this.ship.group);

    this.eqLabel = makeLabelSprite(null);
    this.eqLabel.visible = false;
    gfx.overlay.add(this.eqLabel);
    this.aimGuide = new AimGuide(gfx);

    hud.setLevel(config.levelNumber, config.stageName, this.waves.length > 1 ? { n: 1, of: this.waves.length } : null);
    this.updateHull();
    hud.setStreak(0, HULL.repairStreak);
    hud.setScore(0);
    hud.setMessage(null);
    hud.show(true);
    if (options.showControlsHint) {
      this.hintKind = ctx.input.isTouch ? (options.touchMode === 'joystick' ? 'touch' : 'tapdrag') : options.controlMode;
      this.hintT = HINT.maxSec;
      hud.showHint(this.hintKind);
    }

    this.startWave(0);
  }

  /**
   * Fly in wave `i`. The field starts empty: rocks wait off-screen and fly in
   * after the first question.
   */
  private startWave(i: number): void {
    const { field, hud, audio } = this.ctx;
    this.waveIndex = i;
    const kind = this.waves[i];
    this.reverse = kind === 'reverse' ? (this.config.reverse ?? null) : null;
    this.removeUfo();
    this.ufoT = kind === 'classic' && Math.random() < UFO.chancePerWave ? randRange(UFO.delay[0], UFO.delay[1]) : null;
    if (this.waves.length > 1) hud.setLevel(this.config.levelNumber, this.config.stageName, { n: i + 1, of: this.waves.length });
    hud.setMessage(null);
    if (kind === 'boss') {
      this.spawnBoss();
      this.nextQuestion();
      return;
    }
    this.spawnInitial();
    if (field.liveValues().length === 0) {
      this.waveCleared();
      return;
    }
    if (i > 0 && this.reverse) audio.speak('Reverse! Shoot every equation that makes the number.');
    this.nextQuestion();
  }

  /** The field is empty: next wave after a breather (with a free repair), or the level is cleared. */
  private waveCleared(): void {
    const next = this.waveIndex + 1;
    if (next >= this.waves.length) {
      this.endLevel('cleared');
      return;
    }
    const { hud, audio, effects } = this.ctx;
    this.question = null;
    this.reverse = null;
    this.setEquationLabel(null);
    hud.setQuestion(null);
    this.betweenT = WAVE.pauseSec;
    const upNext = this.waves[next] === 'reverse' ? ' · Reverse!' : this.waves[next] === 'boss' ? ' · BOSS!' : '';
    hud.setMessage(`Wave ${next + 1} of ${this.waves.length}${upNext}`, 'clear');
    audio.play('levelClear');
    effects.fireworks(1);
    if (this.damage > 0) {
      this.damage = Math.max(0, this.damage - WAVE.repair);
      this.updateHull('repair');
    }
  }

  private baseSpeed(size: AsteroidSize): number {
    const speed = this.reverse && this.config.reversePace ? this.config.reversePace.speed : this.config.asteroidSpeed;
    return Math.min(ASTEROID.maxSpeed, Math.max(0, speed) * ASTEROID.speedMult[size]);
  }

  /**
   * Level start: every rock waits just outside a screen edge and flies in,
   * staggered over ENTRY.window seconds. Entry points favor the edges away from
   * the ship, and each path must cross the field without passing near the ship.
   */
  private spawnInitial(): void {
    const { gfx, field } = this.ctx;
    const pace = this.reverse ? this.config.reversePace : undefined;
    const n = Math.max(0, Math.floor(pace?.asteroids ?? this.config.initialAsteroids));
    let values: number[] = [];
    let facts: Fact[] | null = null;
    try {
      if (this.reverse) {
        facts = this.reverse.initialFacts(n).slice(0, n);
        values = facts.map((f) => f.answer);
      } else values = this.config.questions.initialValues(n).slice(0, n);
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
      const rock = field.spawnEntering(3, values[i], best.x, best.y, best.ang, cruise, ENTRY.duration, delay);
      if (facts?.[i]) field.setValue(rock, values[i], facts[i]);
    }
  }

  // -------------------------------------------------------------------------
  // Questions

  private nextQuestion(): void {
    const { field } = this.ctx;
    const live = field.liveValues();
    let q: Question;
    try {
      q = this.boss
        ? this.bossQuestion()
        : this.reverse
          ? this.reverseQuestion(this.reverse.pickTarget(this.liveFacts()))
          : this.config.questions.pickQuestion(live);
    } catch (err) {
      console.error('[game] pickQuestion failed', err);
      return;
    }
    // (boss questions paint their own shards, answer included)
    if (!this.boss && !live.includes(q.answer)) {
      // Contract violation: keep the level clearable by painting the answer on a rock.
      console.warn('[game] pickQuestion answer not on any live asteroid; repainting one', q, live);
      const labeled = field.list.filter((a) => a.value !== null);
      const target = labeled[(Math.random() * labeled.length) | 0];
      if (target) field.setValue(target, q.answer);
    }
    this.question = q;
    this.startAnswerClock();
    this.questionMisses = 0;
    this.revealT = 0;
    this.setEquationLabel(this.questionText(q));
    this.ctx.hud.setQuestion(this.questionText(q));
    if (this.ufo) this.ufo.setValue(this.ufoValue(q));
    this.safeCall(() => this.callbacks.onQuestion?.(q));
    this.ctx.audio.speak(q.speech);
  }

  /** Reverse mode "question": find every rock whose equation makes `target`. */
  private reverseQuestion(target: number): Question {
    return { factId: `target:${target}`, prompt: String(target), speech: `Find ${target}`, answer: target };
  }

  private liveFacts(): Fact[] {
    const out: Fact[] = [];
    for (const a of this.ctx.field.list) if (a.fact && a.value !== null) out.push(a.fact);
    return out;
  }

  /** "7 + 5 = ?", or "? = 24" in Reverse mode. */
  private questionText(q: Question): string {
    return this.reverse ? `? = ${q.answer}` : `${q.prompt} = ?`;
  }

  /** `teach` draws it in the teaching color (a revealed fact). */
  private setEquationLabel(text: string | null, teach = false): void {
    const mat = this.eqLabel.material as THREE.SpriteMaterial;
    if (this.eqTex) {
      this.eqTex.dispose();
      this.eqTex = null;
    }
    if (text === null) {
      mat.map = null;
      this.eqLabel.visible = false;
      return;
    }
    const accent = teach ? REVEAL.color : this.ship.color.rainbow ? '#ffffff' : `#${this.ship.color.color.getHexString()}`;
    const { tex, aspect } = this.ctx.labels.equationTexture(text, accent);
    this.eqTex = tex;
    this.eqAspect = aspect;
    mat.map = tex;
    mat.needsUpdate = true;
  }

  /**
   * After a wrong answer: show the full fact (and say it), then go back to
   * "= ?" so the kid still has to find and shoot the answer. Repeated misses
   * also make the correct rock pulse. In Reverse mode the fact is the equation
   * on the rock that was hit ("5 × 5 = 25", not 24).
   */
  private revealFact(q: Question, hitFact: Fact | null): void {
    this.questionMisses++;
    this.revealT = REVEAL.factSec;
    const fact = this.reverse ? hitFact : null;
    const text = fact ? `${fact.text} = ${fact.answer}` : `${q.prompt} = ${q.answer}`;
    this.setEquationLabel(text, true);
    this.ctx.hud.revealAnswer(text);
    this.ctx.audio.speak(fact ? `${fact.speech} equals ${fact.answer}` : `${q.speech} equals ${q.answer}`);
  }

  private updateReveal(dt: number): void {
    const q = this.question;
    if (this.revealT > 0) {
      this.revealT -= dt;
      if (this.revealT <= 0 && q && this.state === 'playing') {
        this.setEquationLabel(this.questionText(q));
        this.ctx.hud.setQuestion(this.questionText(q));
      }
    }
    const hintOn = q !== null && this.state === 'playing' && this.questionMisses >= REVEAL.hintAfterMisses;
    for (const a of this.ctx.field.list) a.hint = hintOn && a.value === q!.answer;
  }

  private startAnswerClock(): void {
    this.qStart = this.simTime;
    this.qHeading = this.ship.angle;
    this.qDead = 0;
  }

  /**
   * Recall time for a hit, so steering skill doesn't count against the math:
   * stop at the tap (tap-to-target) or when the bolt was fired (not when it
   * landed), minus the least time the ship needed to turn from its heading at
   * question start to the heading it fired at, minus time spent destroyed.
   */
  private responseMs(l: Laser): number {
    const shot = this.laserShots.get(l);
    let secs: number;
    if (!shot) secs = this.simTime - this.qStart;
    else if (shot.tapT !== null) secs = Math.max(shot.tapT, this.qStart) - this.qStart;
    else {
      const turn = Math.abs(wrapAngle(shot.heading - this.qHeading)) / SHIP.turnRate;
      secs = shot.t - this.qStart - turn;
    }
    return Math.max(0, Math.round((secs - this.qDead) * 1000));
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
    // The answer clock starts once the rocks have flown in; otherwise the first
    // answer of every level would count as slow for mastery.
    if (field.entering) this.startAnswerClock();
    if (!this.ship.alive) this.qDead += dt;

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
          this.fire(LASER.cooldown, this.tapTarget);
          this.tapTarget = null;
        }
      }
    } else if (this.respawnT > 0 && this.state === 'playing') {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn();
    }
    // Slow-mo slows the rocks only; the ship and bolts keep full speed
    field.update(this.power?.kind === 'slow' ? dt * POWERUP.slowFactor : dt);
    this.updateBonuses(dt);
    this.updateBoss(dt);
    if (this.betweenT > 0 && this.state === 'playing') {
      this.betweenT -= dt;
      if (this.betweenT <= 0) this.startWave(this.waveIndex + 1);
    }
    this.wrongGrace = Math.max(0, this.wrongGrace - dt);
    this.updateReveal(dt);
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
          ufoHits: this.ufoHits,
          bossesBeaten: this.bossesBeaten,
          bestStreak: this.bestStreak,
          hullDamage: this.damageTaken,
          waves: this.waves.length,
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

  /** The live, targetable numbered rock under a world point (with `padPx` screen padding), if any. */
  rockAt(wx: number, wy: number, padPx: number = TAP_TARGET.pickPadPx): Asteroid | null {
    if (this.state !== 'playing') return null;
    const pad = padPx / this.ctx.gfx.pxPerUnit;
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
    return best;
  }

  /** Tap/click on the field (world coords): lock onto the nearest numbered rock under it. */
  tapAt(wx: number, wy: number, padPx: number = TAP_TARGET.pickPadPx): void {
    if (this.state !== 'playing' || !this.ship.alive) return;
    const best = this.rockAt(wx, wy, padPx);
    if (best) {
      this.tapTarget = best;
      this.tapT = TAP_TARGET.timeout;
      this.tapDecision = { target: best, t: this.simTime };
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

  /** Gentle magnetism: each bolt curves toward the rock it locked onto, while it stays inside a narrow cone. */
  private steerLasers(dt: number): void {
    for (const l of this.ctx.lasers.list) {
      if (l.cosmetic) continue;
      const a = this.laserTargets.get(l);
      if (!a || !a.alive || a.value === null || !a.active) continue;
      const dx = a.pos.x - l.pos.x;
      const dy = a.pos.y - l.pos.y;
      const diff = wrapAngle(Math.atan2(dy, dx) - Math.atan2(l.vel.y, l.vel.x));
      // once it's beside or behind the bolt, the shot has missed: let it fly on
      if (Math.abs(diff) > this.assistCone()) continue;
      const rate = AIM_ASSIST.turnRate * (this.power?.kind === 'magnet' ? POWERUP.magnetTurn : 1);
      const step = THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
      l.vel.rotateAround(ORIGIN, step);
    }
  }

  /**
   * The rock a freshly fired bolt is aimed at: the one its straight path passes
   * closest to (by how far it would miss the rock's edge, with the rock's motion
   * led), inside the assist cone and range. Bolts already on course for several
   * rocks pick the nearest, since that's the one they'd hit first.
   */
  private pickLaserTarget(l: Laser): Asteroid | null {
    const sp = l.vel.length() || 1;
    const fx = l.vel.x / sp;
    const fy = l.vel.y / sp;
    let best: Asteroid | null = null;
    let bestMiss = Infinity;
    let bestAlong = Infinity;
    for (const a of this.ctx.field.list) {
      if (a.value === null || !a.active) continue;
      const d0 = Math.hypot(a.pos.x - l.pos.x, a.pos.y - l.pos.y);
      if (d0 > AIM_ASSIST.range) continue;
      const t = d0 / sp;
      const dx = a.pos.x + a.vel.x * t - l.pos.x;
      const dy = a.pos.y + a.vel.y * t - l.pos.y;
      const along = dx * fx + dy * fy;
      if (along <= 0) continue;
      if (Math.abs(Math.atan2(dx * fy - dy * fx, along)) > this.assistCone()) continue;
      const miss = Math.max(0, Math.abs(dx * fy - dy * fx) - a.hitRadius - LASER.radius);
      if (miss < bestMiss || (miss === bestMiss && along < bestAlong)) {
        best = a;
        bestMiss = miss;
        bestAlong = along;
      }
    }
    return best;
  }

  /** Aim-assist cone (wider with Magnet). */
  private assistCone(): number {
    return AIM_ASSIST.cone * (this.power?.kind === 'magnet' ? POWERUP.magnetCone : 1);
  }

  private fire(cooldown: number, target: Asteroid | null = null): void {
    const { lasers, audio } = this.ctx;
    const m = this.ship.muzzleWorld(this.tmpV);
    const wide = this.power?.kind === 'wide';
    const l = lasers.fire(m.x, m.y, this.ship.angle, this.ship.vel.x * 0.5, this.ship.vel.y * 0.5, wide ? { scale: POWERUP.wideScale } : {});
    if (wide) this.wideLasers.add(l);
    const lock = target ?? this.pickLaserTarget(l);
    if (lock) this.laserTargets.set(l, lock);
    const tap = this.tapDecision;
    this.laserShots.set(l, { t: this.simTime, heading: this.ship.angle, tapT: target && tap?.target === target ? tap.t : null });
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
      const seg = (x: number, y: number, r: number) => segmentHitsCircle(l.prev.x, l.prev.y, l.pos.x, l.pos.y, x, y, r + LASER.radius);
      const crystal = this.powerups.list.find((c) => seg(c.pos.x, c.pos.y, POWERUP.radius));
      if (crystal) {
        lasers.remove(l);
        this.collectPowerUp(crystal);
        continue;
      }
      if (this.ufo && this.question && seg(this.ufo.pos.x, this.ufo.pos.y, UFO.radius)) {
        lasers.remove(l);
        this.onUfoHit(l);
        if (this.state !== 'playing') return;
        continue;
      }
      if (this.boss && seg(this.boss.rock.pos.x, this.boss.rock.pos.y, this.boss.rock.hitRadius * 0.9)) {
        // the boss's hide is too tough: only the shards crack it
        lasers.remove(l);
        this.ctx.effects.sparks(l.pos.x, l.pos.y, this.boss.rock.rimMat.color);
        this.boss.rock.flashT = 0.2;
        continue;
      }
      const extra = this.wideLasers.has(l) ? POWERUP.wideHit : 0;
      let hit: Asteroid | null = null;
      for (const a of field.list) {
        // rocks still flying in can't be shot yet: bolts pass through
        if (a.value === null || !a.active) continue;
        const n = a.images(IMAGES);
        for (let i = 0; i < n && !hit; i++) {
          const p = IMAGES[i];
          if (seg(p.x, p.y, a.hitRadius + extra)) hit = a;
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

  private recordAnswer(factId: string, correct: boolean, responseMs: number, chosenValue: number): void {
    const ev: AnswerEvent = { factId, correct, responseMs, chosenValue };
    this.answers.push(ev);
    this.safeCall(() => this.callbacks.onAnswer?.(ev));
  }

  private onAsteroidHit(a: Asteroid, l: Laser): void {
    const q = this.question;
    if (!q || a.value === null) return;
    const { field, effects } = this.ctx;
    const responseMs = this.responseMs(l);
    const correct = a.value === q.answer;
    // Reverse mode scores the equation on the rock: shooting 5×5 for 24 is a miss on 5×5
    this.recordAnswer(a.fact?.id ?? q.factId, correct, responseMs, a.value);

    if (correct && this.boss) {
      this.rewardCorrect(a.pos.x, a.pos.y, a.radius, responseMs, 0);
      this.crackBoss();
      return;
    }
    if (correct) {
      this.rewardCorrect(a.pos.x, a.pos.y, a.radius, responseMs, 0);
      field.remove(a);
      const live = field.liveValues();
      if (live.length === 0) this.waveCleared();
      else if (this.reverse && live.includes(q.answer)) this.startAnswerClock(); // more rocks make this number
      else this.nextQuestion();
      return;
    }

    const counted = this.punishWrong(q, a.fact, a.pos.x, a.pos.y);
    if (this.state !== 'playing') return;
    if (this.boss) {
      if (counted) this.healBoss();
      a.shakeT = 0.45;
      effects.sparks(a.pos.x, a.pos.y, a.rimMat.color);
      return;
    }
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

  /** Score, effects, streak (hull repair, power-up drops) for a correct answer at (x, y). */
  private rewardCorrect(x: number, y: number, radius: number, responseMs: number, extraScore: number): void {
    const { audio, effects, hud } = this.ctx;
    const bonus =
      responseMs <= LEVEL.speedBonusFullMs
        ? LEVEL.speedBonusMax
        : Math.max(
            0,
            Math.round(
              LEVEL.speedBonusMax * (1 - (responseMs - LEVEL.speedBonusFullMs) / (LEVEL.speedBonusZeroMs - LEVEL.speedBonusFullMs)),
            ),
          );
    this.score += LEVEL.scoreCorrect + bonus + extraScore;
    hud.setScore(this.score);
    hud.react('correct');
    audio.play('correct');
    audio.play('explode');
    effects.correctBurst(x, y, radius);
    effects.popIcon('check', x, y);
    if (responseMs < LEVEL.speedyMs) effects.popSpeedy(bonus, x, y);
    effects.flash();
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    hud.setStreak(this.streak, HULL.repairStreak);
    if (this.streak % HULL.repairStreak === 0 && this.damage > 0) this.repairHull();
    if (this.streak % POWERUP.every === 0) this.dropPowerUp(x, y);
  }

  /**
   * A wrong answer: ✗, streak reset, and (once per burst) the fact reveal and hull
   * damage. Returns true when it counted as a miss (not inside the burst grace).
   */
  private punishWrong(q: Question, hitFact: Fact | null, x: number, y: number): boolean {
    const { audio, effects, hud } = this.ctx;
    audio.play('wrong');
    hud.react('wrong');
    effects.popIcon('cross', x, y);
    this.streak = 0;
    hud.setStreak(0, HULL.repairStreak);
    // a held-fire burst into one rock is one miss (the fact is still showing anyway)
    if (this.wrongGrace <= 0) {
      this.wrongGrace = HULL.wrongGraceSec;
      this.revealFact(q, hitFact);
      this.wrongAnswerDamage();
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Boss wave

  private spawnBoss(): void {
    const { field, gfx, hud, audio } = this.ctx;
    const c = this.bossCenter(0);
    const rock = field.spawnBoss(BOSS.scale, c.x, c.y);
    const shards: Asteroid[] = [];
    for (let i = 0; i < BOSS.shards; i++) {
      const p = this.shardPos(rock, 0, i);
      shards.push(field.spawn(1, 0, p.x, p.y, 0, 0, true));
    }
    this.boss = { rock, shards, hp: BOSS.hp, t: 0 };
    // face the boss from the bottom of the screen while it arrives
    const s = this.ship;
    if (s.alive) {
      s.pos.set(0, -gfx.halfH * 0.62);
      s.vel.set(0, 0);
      s.angle = 0;
      this.qHeading = 0;
    }
    this.entryGrace = BOSS.entryGrace;
    hud.setBoss(BOSS.hp, BOSS.hp);
    hud.setMessage('BOSS!', 'clear');
    audio.play('promote');
    audio.speak('Boss! Shoot the shard with the answer.');
    this.bossMessageT = 1.6;
  }

  private bossMessageT = 0;

  private bossCenter(t: number): { x: number; y: number } {
    const { halfW, halfH } = this.ctx.gfx;
    const P = BOSS.path;
    return {
      x: halfW * P.x * Math.sin(t * P.fx),
      y: halfH * P.y + halfH * P.wobble * Math.sin(t * P.fy),
    };
  }

  private shardPos(rock: Asteroid, t: number, i: number): { x: number; y: number } {
    const r = rock.radius + BOSS.orbitGap;
    const ang = t * BOSS.orbitSpeed + (i * Math.PI * 2) / BOSS.shards;
    return { x: rock.pos.x + Math.cos(ang) * r, y: rock.pos.y + Math.sin(ang) * r };
  }

  /** Move the boss on its path and its shards around it (velocities kept for aim lead). */
  private updateBoss(dt: number): void {
    const b = this.boss;
    if (!b) return;
    if (this.bossMessageT > 0) {
      this.bossMessageT -= dt;
      if (this.bossMessageT <= 0 && this.state === 'playing') this.ctx.hud.setMessage(null);
    }
    if (dt <= 0) return;
    // Slow-mo slows the boss too
    b.t += this.power?.kind === 'slow' ? dt * POWERUP.slowFactor : dt;
    const c = this.bossCenter(b.t);
    b.rock.vel.set((c.x - b.rock.pos.x) / dt, (c.y - b.rock.pos.y) / dt);
    b.rock.pos.set(c.x, c.y);
    b.shards.forEach((s, i) => {
      const p = this.shardPos(b.rock, b.t, i);
      s.vel.set((p.x - s.pos.x) / dt, (p.y - s.pos.y) / dt);
      s.pos.set(p.x, p.y);
    });
  }

  /** A question for the boss: a weighted stage fact, its answer on one shard and near misses on the rest. */
  private bossQuestion(): Question {
    const b = this.boss!;
    const qs = this.config.questions;
    const v = qs.initialValues(1)[0];
    const q = qs.pickQuestion([v]);
    const values = [q.answer];
    for (let i = 1; i < b.shards.length; i++) {
      let d = q.answer + i;
      try {
        for (let tries = 0; tries < 6; tries++) {
          d = qs.splitValue(q, values);
          if (!values.includes(d)) break;
        }
      } catch (err) {
        console.error('[game] splitValue failed', err);
      }
      while (values.includes(d)) d++;
      values.push(d);
    }
    // shuffle so the answer isn't always on the same shard
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    b.shards.forEach((s, i) => {
      this.ctx.field.setValue(s, values[i]);
      s.flashT = 0.35;
    });
    return q;
  }

  private crackBoss(): void {
    const b = this.boss!;
    const { effects, gfx, audio, hud } = this.ctx;
    b.hp--;
    b.rock.shakeT = 0.45;
    b.rock.flashT = 0.35;
    effects.correctBurst(b.rock.pos.x, b.rock.pos.y, b.rock.radius * 0.6);
    gfx.shake(0.8, 0.3);
    audio.play('split');
    hud.setBoss(b.hp, BOSS.hp);
    if (b.hp > 0) {
      this.nextQuestion();
      return;
    }
    // defeated
    this.bossesBeaten++;
    this.score += BOSS.defeatScore;
    hud.setScore(this.score);
    effects.shipExplosion(b.rock.pos.x, b.rock.pos.y, b.rock.rimMat.color);
    effects.correctBurst(b.rock.pos.x, b.rock.pos.y, b.rock.radius);
    effects.popLabel(`👾 Boss beaten! +${BOSS.defeatScore}`, b.rock.pos.x, b.rock.pos.y, true);
    gfx.shake(1.6, 0.6);
    this.removeBoss();
    this.waveCleared();
  }

  private healBoss(): void {
    const b = this.boss!;
    if (b.hp >= BOSS.hp) return;
    b.hp++;
    this.ctx.hud.setBoss(b.hp, BOSS.hp, true);
  }

  private removeBoss(): void {
    const b = this.boss;
    if (!b) return;
    for (const s of b.shards) this.ctx.field.remove(s);
    this.ctx.field.remove(b.rock);
    this.boss = null;
    this.ctx.hud.setBoss(null);
  }

  // -------------------------------------------------------------------------
  // Power-ups and the bonus UFO

  private dropPowerUp(x: number, y: number): void {
    const kinds = POWER_KINDS.filter((k) => k !== this.power?.kind);
    this.powerups.spawn(kinds[Math.floor(Math.random() * kinds.length)], x, y);
  }

  private collectPowerUp(c: Crystal): void {
    const { audio, effects, hud } = this.ctx;
    this.powerups.remove(c);
    this.power = { kind: c.kind, t: POWERUP.durationSec };
    audio.play('shieldHit');
    effects.popLabel(`${POWER_INFO[c.kind].icon} ${POWER_INFO[c.kind].name}!`, c.pos.x, c.pos.y);
    effects.sparks(c.pos.x, c.pos.y, new THREE.Color(POWER_INFO[c.kind].color));
    hud.setPower(POWER_INFO[c.kind].icon, POWER_INFO[c.kind].name, 1);
  }

  private updateBonuses(dt: number): void {
    const { audio, hud } = this.ctx;
    this.powerups.update(dt);
    const s = this.ship;
    if (s.alive) {
      for (const c of this.powerups.list.slice()) {
        if (circlesOverlap(s.pos.x, s.pos.y, SHIP.radius, c.pos.x, c.pos.y, POWERUP.radius)) this.collectPowerUp(c);
      }
    }
    if (this.power) {
      this.power.t -= dt;
      if (this.power.t <= 0) {
        this.power = null;
        hud.setPower(null);
      } else hud.setPower(POWER_INFO[this.power.kind].icon, POWER_INFO[this.power.kind].name, this.power.t / POWERUP.durationSec);
    }
    // the UFO waits for the wave's rocks to arrive, and only visits Classic waves
    const canFly = this.state === 'playing' && this.question !== null && !this.reverse && !this.ctx.field.entering;
    if (this.ufoT !== null && canFly) {
      this.ufoT -= dt;
      if (this.ufoT <= 0) {
        this.ufoT = null;
        const y = randRange(-0.35, 0.45) * this.ctx.gfx.halfH;
        this.ufo = new Ufo(this.ctx.gfx, this.ctx.labels, Math.random() < 0.5, y);
        this.ufo.setValue(this.ufoValue(this.question!));
        audio.play('shieldHit');
      }
    }
    if (this.ufo && (!this.ufo.update(dt) || this.state !== 'playing' || this.reverse)) this.removeUfo();
  }

  /** The UFO's number: the current answer, or a plausible near miss. */
  private ufoValue(q: Question): number {
    if (Math.random() < UFO.correctChance) return q.answer;
    try {
      const v = this.config.questions.splitValue(q, this.ctx.field.liveValues());
      if (v !== q.answer) return v;
    } catch (err) {
      console.error('[game] splitValue failed', err);
    }
    return q.answer + (Math.random() < 0.5 && q.answer > 1 ? -1 : 1);
  }

  private onUfoHit(l: Laser): void {
    const ufo = this.ufo;
    const q = this.question;
    if (!ufo || !q) return;
    const { effects, audio } = this.ctx;
    const { x, y } = ufo.pos;
    const correct = ufo.value === q.answer;
    this.recordAnswer(q.factId, correct, this.responseMs(l), ufo.value);
    this.removeUfo();
    effects.shipExplosion(x, y, new THREE.Color(0x7dff9b));
    if (correct) {
      this.ufoHits++;
      this.rewardCorrect(x, y, UFO.radius, this.responseMs(l), UFO.bonusScore);
      audio.play('purchase');
      effects.popLabel('🛸 UFO bonus!', x, y, true);
      // the rock carrying this answer stays; a new question follows
      this.nextQuestion();
    } else this.punishWrong(q, null, x, y);
  }

  /** Dev/test hooks (see GameEngineImpl.debug()). */
  debugBonus() {
    return {
      ufo: this.ufo ? { value: this.ufo.value, x: this.ufo.pos.x, y: this.ufo.pos.y } : null,
      ufoT: this.ufoT,
      crystals: this.powerups.list.map((c) => ({ kind: c.kind, x: c.pos.x, y: c.pos.y })),
      power: this.power ? { ...this.power } : null,
      streak: this.streak,
    };
  }

  debugSpawnUfo(): boolean {
    if (!this.question || this.reverse) return false;
    this.ufoT = 0.01;
    return true;
  }

  debugDropPowerUp(kind: PowerKind, x: number, y: number): boolean {
    this.powerups.spawn(kind, x, y);
    return true;
  }

  private removeUfo(): void {
    this.ufo?.dispose();
    this.ufo = null;
  }

  private split(a: Asteroid, q: Question, dirX: number, dirY: number): void {
    const { field, audio, effects } = this.ctx;
    const size = (a.size - 1) as AsteroidSize;
    const canSpawnSecond = field.list.length < this.config.maxAsteroids;
    const parentValue = a.value;
    const parentFact = a.fact;
    const { x, y } = a.pos;
    const baseAngle = a.vel.lengthSq() > 0.01 ? Math.atan2(a.vel.y, a.vel.x) : Math.atan2(dirY, dirX);
    // children barely speed up: their own base speed, never the parent's accumulated kicks
    const sp = this.baseSpeed(size);
    field.remove(a);
    audio.play('split');
    effects.rockPuff(x, y, a.radius);

    const r = ASTEROID.radius[size];
    const mk = (value: number, fact: Fact | null, side: number) => {
      const ang = baseAngle + side * randRange(ASTEROID.splitSpread[0], ASTEROID.splitSpread[1]);
      const s = sp * randRange(0.92, 1.05);
      const px = x + Math.cos(ang) * r * 0.7;
      const py = y + Math.sin(ang) * r * 0.7;
      const k = ASTEROID.splitKick;
      const child = field.spawn(size, value, px, py, Math.cos(ang) * s + dirX * k, Math.sin(ang) * s + dirY * k);
      if (fact) field.setValue(child, value, fact);
      this.clampSpeed(child);
      child.shakeT = 0.45;
      child.flashT = 0.35;
      return child;
    };
    mk(parentValue as number, parentFact, 1);
    if (canSpawnSecond) {
      let v = parentValue as number;
      let f: Fact | null = parentFact;
      try {
        if (this.reverse) {
          f = this.reverse.splitFact(q.answer, this.liveFacts());
          v = f.answer;
        } else v = this.config.questions.splitValue(q, field.liveValues());
      } catch (err) {
        console.error('[game] splitValue failed', err);
      }
      mk(v, f, -1);
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
    const { audio, effects } = this.ctx;
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
    this.updateHull();
  }

  private shipHit(): void {
    const s = this.ship;
    const { audio, effects, gfx } = this.ctx;
    this.hitsTaken++;
    audio.play('shipHit');
    gfx.shake(1.3, 0.45);
    effects.shipExplosion(s.pos.x, s.pos.y, s.color.color);
    s.alive = false;
    s.thrustAmt = 0;
    s.vel.set(0, 0);
    this.damageTaken += Math.min(HULL.collisionDamage, HULL_MAX - this.damage);
    this.damage = Math.min(HULL_MAX, this.damage + HULL.collisionDamage);
    this.updateHull('damage');
    this.safeCall(() => this.callbacks.onShipHit?.(this.hitsTaken, HITS_ALLOWED));
    if (this.damage >= HULL_MAX) this.endLevel('failed');
    else this.respawnT = SHIP.respawnDelay;
  }

  /** A wrong answer chips one segment off the hull; an empty hull destroys the ship. */
  private wrongAnswerDamage(): void {
    const s = this.ship;
    const { audio, effects, gfx } = this.ctx;
    this.damageTaken += Math.min(HULL.wrongDamage, HULL_MAX - this.damage);
    this.damage = Math.min(HULL_MAX, this.damage + HULL.wrongDamage);
    this.updateHull('damage');
    if (this.damage < HULL_MAX) {
      gfx.shake(0.45, 0.18);
      return;
    }
    if (s.alive) {
      audio.play('shipHit');
      gfx.shake(1.3, 0.45);
      effects.shipExplosion(s.pos.x, s.pos.y, s.color.color);
      s.alive = false;
      s.thrustAmt = 0;
      s.vel.set(0, 0);
    }
    this.endLevel('failed');
  }

  private repairHull(): void {
    this.damage = Math.max(0, this.damage - 1);
    this.ctx.audio.play('shieldHit');
    this.updateHull('repair');
  }

  private updateHull(pulse?: 'damage' | 'repair'): void {
    this.ctx.hud.setHull(HULL_MAX - this.damage, HITS_ALLOWED, HULL.segmentsPerShip, this.shieldState, pulse);
  }

  private respawn(): void {
    const p = this.safeSpawnPoint();
    this.ship.reset(p.x, p.y);
    this.qHeading = this.ship.angle;
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
    if ((kind === 'touch' || kind === 'tapdrag') && keys) {
      // a touch-capable device that's actually being played with a keyboard
      const hadFire = !this.ctx.hud.hintHas('fire');
      this.hintKind = this.options.controlMode;
      this.ctx.hud.showHint(this.hintKind);
      if (hadFire) this.ctx.hud.hintUsed('fire');
    }
    const touchUsed = this.ctx.input.consumeUsed();
    if (c.stickActive || touchUsed.stick) this.hintUsed('stick');
    if (c.flyActive || touchUsed.fly) this.hintUsed('drag');
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
    this.removeUfo();
    this.removeBoss();
    this.powerups.clear();
    this.power = null;
    hud.setPower(null);
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
    this.removeUfo();
    this.powerups.dispose();
    this.ctx.hud.setPower(null);
    this.ctx.hud.setBoss(null);
    this.ctx.hud.hideHint();
    if (this.eqTex) this.eqTex.dispose();
    (this.eqLabel.material as THREE.SpriteMaterial).dispose();
    this.eqLabel.removeFromParent();
  }
}

