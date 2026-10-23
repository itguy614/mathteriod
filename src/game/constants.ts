/**
 * Tunables for the arcade layer.
 *
 * World scale: the play field is a 2D plane (XY), viewed top-down by an
 * orthographic camera. The long screen axis is WORLD_SPAN units (so a
 * landscape screen is 100 units wide, a portrait one 100 units tall).
 * A sensible LevelConfig.asteroidSpeed range is ~2 (gentle) to ~5 (brisk);
 * anything faster is clamped to ASTEROID.maxSpeed.
 */
export const WORLD_SPAN = 100;

export const SHIP = {
  turnRate: 3.9, // rad/s
  thrust: 44, // units/s^2
  drag: 0.55, // exponential damping per second (gentle)
  maxSpeed: 44,
  radius: 1.5, // collision radius (forgiving: smaller than the drawn hull)
  visualScale: 1.3, // procedural models are ~5 units long; drawn 30% larger
  invulnSec: 3.2, // after a respawn
  respawnDelay: 1.3,
  agileMult: 1.15,
  stickDeadzone: 0.15,
  /** 'rotate' mode Down/S: exponential damping per second while held (stops in ~0.5s). */
  brakeDrag: 6,
} as const;

/** 'direct' control mode: arrows/WASD push the ship in that screen direction. */
export const DIRECT = {
  accel: 44, // units/s^2 (same as SHIP.thrust)
  maxSpeed: 44,
  drag: 0.55, // while a direction is held
  releaseDrag: 3.2, // when no direction is held: stops fairly quickly
  turnRate: 10, // rad/s, ship turns to face its movement direction
} as const;

export const LASER = {
  speed: 80,
  life: 1.6, // long enough to cross the screen diagonal; lasers vanish at the screen edge
  cooldown: 0.15, // minimum time between tapped shots
  holdRepeat: 0.28, // auto-fire interval while the button is held
  max: 5,
  radius: 0.55,
  /** Lasers are removed once they are this far outside the visible field. */
  cullMargin: 1.5,
} as const;

/** Touch gestures (LevelOptions.touchMode). */
export const TOUCH = {
  /** A touch on a rock is a tap only if it ends within this time and movement. */
  tapMs: 300,
  tapSlopPx: 14,
  /** Extra CSS px around a rock that still counts as touching it (fingers are big). */
  rockPadPx: 36,
  /** Joystick: capture circle = stick radius × this; movement needed before it drives. */
  stickZoneMult: 1.45,
  stickArmPx: 10,
} as const;

/** 'tapdrag' flying: the ship steers toward the finger and arrives without orbiting. */
export const TOUCH_FLY = {
  accel: 70, // max steering acceleration, units/s^2
  maxSpeed: 40,
  /** Desired speed = distance × this (so it slows down as it gets close). */
  arriveGain: 2.6,
  /** Inside this distance the ship just settles (no turning to face tiny moves). */
  settleDist: 1.2,
  releaseDrag: 2.2, // gentle stop when the finger lifts
  turnRate: 10, // rad/s, faces its direction of travel
} as const;

/** Faint dotted line from the nose showing where shots go. */
export const AIM_GUIDE = {
  length: 40, // world units (the screen is 100 wide)
  spacing: 2.4,
  startGap: 1.2, // gap between the muzzle and the first dot
  dotPx: 7, // dot diameter in CSS pixels
  opacity: 0.6, // nearest dots; fades toward the far end
  flow: 3.5, // units/s the dots creep forward (reads as direction, not as a shot)
} as const;

export type AsteroidSize = 1 | 2 | 3;

export const ASTEROID = {
  radius: { 1: 2.7, 2: 4.2, 3: 6.2 } as Record<AsteroidSize, number>,
  /** Split children barely speed up. */
  speedMult: { 1: 1.2, 2: 1.1, 3: 1 } as Record<AsteroidSize, number>,
  /** Hard cap on any asteroid's drift speed, whatever the config says. */
  maxSpeed: 7,
  /** Split children leave at ±this angle (rad) from the parent's heading, plus a small laser push. */
  splitSpread: [0.3, 0.55] as const,
  splitKick: 0.6,
  /** A wrong hit on a small rock nudges it this much. */
  wrongNudge: 1.2,
  /** After ramming the ship the rock bounces off at this fraction of its base speed. */
  bounceSpeed: 0.8,
  /** Number label height in world units, and a minimum on-screen pixel height. */
  labelHeight: { 1: 3.9, 2: 4.7, 3: 5.6 } as Record<AsteroidSize, number>,
  labelMinPx: { 1: 42, 2: 48, 3: 54 } as Record<AsteroidSize, number>,
  /** Laser hit radius factor vs. visual radius (generous: shooting should be easy). */
  laserHitScale: 1.0,
  /** Ship collision radius factor vs. visual radius (forgiving: grazes don't count). */
  shipHitScale: 0.72,
  /** Keep respawn points at least this far from rocks when possible. */
  safeRadius: 16,
  /** Keep labels this many CSS px inside the screen edges (top leaves room for the HUD). */
  labelEdgePx: 6,
  labelTopPx: 96,
  /** Rocks gently keep apart (after flying in) so their numbers never merge. */
  separation: {
    gap: 1.2, // extra world units kept between rock edges
    restitution: 0.5, // how much of the closing speed bounces back (0 = just stop)
    push: 2.5, // residual overlap is resolved at this fraction per second
  },
  /** Gap kept between two labels, and between a label and a touch control / hint pill (CSS px). */
  labelGapPx: 4,
} as const;

/** Level start: the field is empty, then the rocks fly in from off-screen. */
export const ENTRY = {
  firstDelay: 0.6, // after the first question appears
  window: 1.6, // spawn times are staggered across this many seconds
  duration: 1.2, // seconds for a rock to get fully on screen
  decay: 2.6, // entry speed eases down to cruise speed at this rate
  maxAngle: (32 * Math.PI) / 180, // max deviation from the edge normal
  clearance: 12, // entry path must pass at least this far (plus radii) from the ship
  /** Ship stays invulnerable this long after the last rock has fully entered. */
  graceAfter: 1.5,
  /** Safety: a rock that somehow never gets fully inside stops "entering" after this. */
  timeout: 6,
} as const;

/**
 * Hull damage, tracked in segments (thirds of a ship icon). A collision costs a
 * whole ship, a wrong answer one segment; a streak of correct answers repairs one.
 */
export const HULL = {
  segmentsPerShip: 3,
  collisionDamage: 3,
  wrongDamage: 1,
  /** Correct answers in a row that repair one segment. */
  repairStreak: 3,
  /** A held-fire burst into one wrong rock only costs one segment. */
  wrongGraceSec: 0.5,
} as const;

/**
 * Gentle laser magnetism (never only toward the answer). Each bolt locks at fire
 * time onto the rock its aim line passes closest to, and only curves toward that
 * one, so a nearby rock off to the side can't steal a well-aimed shot.
 * Lasers don't wrap, so only direct on-screen positions count.
 */
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

/** On-screen controls hint (LevelOptions.showControlsHint). */
export const HINT = {
  /** Everything fades after this many seconds even if a control was never used. */
  maxSec: 12,
} as const;

export const ATTRACT_ASTEROIDS = 5;
export const MAX_DPR = 2;
