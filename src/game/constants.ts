/**
 * Tunables for the arcade layer.
 *
 * World scale: the play field is a 2D plane (XY), viewed top-down by an
 * orthographic camera. The long screen axis is WORLD_SPAN units (so a
 * landscape screen is 100 units wide, a portrait one 100 units tall).
 * A sensible LevelConfig.asteroidSpeed range is ~3 (gentle) to ~12 (fast).
 */
export const WORLD_SPAN = 100;

export const SHIP = {
  turnRate: 3.9, // rad/s
  thrust: 44, // units/s^2
  drag: 0.55, // exponential damping per second (gentle)
  maxSpeed: 44,
  radius: 1.9, // collision radius (forgiving)
  visualScale: 1.3, // procedural models are ~5 units long; drawn 30% larger
  invulnSec: 2.5,
  respawnDelay: 1.3,
  spawnGrace: 1.0,
  agileMult: 1.15,
  stickDeadzone: 0.15,
} as const;

export const LASER = {
  speed: 80,
  life: 0.8,
  cooldown: 0.15, // minimum time between tapped shots
  holdRepeat: 0.28, // auto-fire interval while the button is held
  max: 5,
  radius: 0.55,
} as const;

export type AsteroidSize = 1 | 2 | 3;

export const ASTEROID = {
  radius: { 1: 2.7, 2: 4.2, 3: 6.2 } as Record<AsteroidSize, number>,
  speedMult: { 1: 1.55, 2: 1.25, 3: 1 } as Record<AsteroidSize, number>,
  /** Number label height in world units, and a minimum on-screen pixel height. */
  labelHeight: { 1: 3.9, 2: 4.7, 3: 5.6 } as Record<AsteroidSize, number>,
  labelMinPx: { 1: 42, 2: 48, 3: 54 } as Record<AsteroidSize, number>,
  hitScale: 0.88, // collision radius factor vs. visual radius
  safeRadius: 24,
} as const;

/** Gentle laser magnetism toward any numbered asteroid (never only the answer). */
export const AIM_ASSIST = {
  cone: (20 * Math.PI) / 180,
  range: 45,
  turnRate: 1.6, // rad/s
} as const;

/** Tap/click-to-target: quick turn toward the tapped rock, one auto shot when aligned. */
export const TAP_TARGET = {
  turnMult: 2.2,
  alignTol: (4 * Math.PI) / 180,
  timeout: 1.6,
  pickPadPx: 28,
} as const;

export const LEVEL = {
  clearDelay: 2.4,
  failDelay: 2.6,
  scoreCorrect: 100,
  speedBonusMax: 100,
  speedBonusFullMs: 2000,
  speedBonusZeroMs: 6000,
  /** Correct answers faster than this get a small "Speedy!" popup. */
  speedyMs: 3000,
} as const;

export const ATTRACT_ASTEROIDS = 5;
export const MAX_DPR = 2;
