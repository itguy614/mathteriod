/**
 * Shared contracts between the Mathteroid modules.
 *
 *   learning/  – curriculum, adaptive fact selection, mastery   (pure TS, no DOM)
 *   game/      – Three.js arcade: flight, asteroids, lasers, HUD
 *   store/     – profiles + persistence (localStorage in Phase 1)
 *   audio/     – SFX, music, text-to-speech
 *   ui/        – screens: profiles, hangar/shop, level intro/results
 *   main.ts    – wires everything together
 *
 * Change this file only by agreement: every module codes against it.
 */

// ---------------------------------------------------------------------------
// Math facts & curriculum
// ---------------------------------------------------------------------------

export type Operation = 'add' | 'sub' | 'mul' | 'div';

export interface Fact {
  /** Stable id, e.g. "add:7:5", "sub:12:5", "mul:6:7", "div:42:6". */
  id: string;
  op: Operation;
  a: number;
  b: number;
  answer: number;
  /** Display form using proper symbols, e.g. "7 + 5", "12 − 5", "6 × 7", "42 ÷ 6". */
  text: string;
  /** Text-to-speech form, e.g. "7 plus 5", "42 divided by 6". */
  speech: string;
}

export interface StageDef {
  id: string;
  /** Kid-facing name, e.g. "Addition: Launch Pad". */
  name: string;
  op: Operation | 'mixed';
  facts: Fact[];
}

export interface FactStat {
  attempts: number;
  correct: number;
  /** Most recent response times (ms) for correct answers, newest last, capped length. */
  recentMs: number[];
  /** Most recent outcomes, newest last, capped length. */
  recent: boolean[];
  lastSeen: number; // epoch ms
}

/** Serializable per-profile learning state (persisted by store/). */
export interface LearningState {
  stageIndex: number;
  /** Levels played in the current stage (cleared or failed). Drives the difficulty ramp. */
  levelInStage: number;
  /** Levels cleared in the current stage. Promotion requires MASTERY.minLevels of these. */
  clearedInStage: number;
  /** Total levels cleared, all time. Used as the kid-facing "Level N". */
  levelsCleared: number;
  consecutiveFailures: number;
  factStats: Record<string, FactStat>;
}

// ---------------------------------------------------------------------------
// Level setup (learning -> game)
// ---------------------------------------------------------------------------

export type LevelMode = 'classic' | 'swarm' | 'reverse'; // Phase 1 implements 'classic'

export interface Question {
  factId: string;
  /** Shown on/near the ship, e.g. "7 + 5". */
  prompt: string;
  /** Read aloud when TTS is enabled. */
  speech: string;
  answer: number;
}

/**
 * Classic mode contract. Every asteroid carries a number. The current question's
 * answer is ALWAYS present on at least one live asteroid; any asteroid carrying
 * that number counts as correct. When the field has asteroids left but questions
 * are needed, the game asks for a question whose answer is one of the live values,
 * so every asteroid is eventually answerable and the level can be cleared.
 */
export interface QuestionProvider {
  /** Numbers to paint on the initial asteroids (length === count). */
  initialValues(count: number): number[];
  /** Pick the next question (adaptive). Its answer MUST be one of `liveValues`. */
  pickQuestion(liveValues: number[]): Question;
  /**
   * A number for a new asteroid spawned by a wrong-answer split. Should be a
   * plausible distractor for `current` and a valid answer of some fact in the stage.
   */
  splitValue(current: Question, liveValues: number[]): number;
}

export interface LevelConfig {
  stageId: string;
  stageName: string;
  /** Kid-facing level number (levelsCleared + 1). */
  levelNumber: number;
  mode: LevelMode;
  /** Large asteroids at start. */
  initialAsteroids: number;
  /** Base drift speed of large asteroids, world units per second (see game/ for scale). */
  asteroidSpeed: number;
  /** Hard cap on live asteroids; splits beyond this don't spawn extra rocks. */
  maxAsteroids: number;
  /** True when difficulty was eased after repeated failures. */
  eased: boolean;
  questions: QuestionProvider;
}

// ---------------------------------------------------------------------------
// Level results (game -> learning / store)
// ---------------------------------------------------------------------------

export interface AnswerEvent {
  factId: string;
  correct: boolean;
  /** Time from the question appearing to a laser hitting a numbered asteroid. */
  responseMs: number;
  chosenValue: number;
}

export interface LevelResult {
  outcome: 'cleared' | 'failed';
  answers: AnswerEvent[];
  durationMs: number;
  hitsTaken: number;
  score: number;
}

/** Returned by the learning engine after recording a level. */
export interface LevelSummary {
  accuracy: number; // 0..1 for this level
  medianCorrectMs: number | null;
  promoted: boolean;
  /** Present when promoted: the new stage's kid-facing name. */
  newStageName?: string;
  /** 0..1 progress toward promotion out of the current stage. */
  stageProgress: number;
}

// ---------------------------------------------------------------------------
// Ship customization
// ---------------------------------------------------------------------------

export type ItemKind = 'body' | 'color' | 'laser' | 'trail' | 'perk';

export interface ShipLoadout {
  body: string;      // catalog id, kind 'body'
  color: string;     // catalog id, kind 'color' (hull glow)
  laser: string;     // catalog id, kind 'laser' (style)
  laserColor: string; // catalog id, kind 'color'
  trail: string;     // catalog id, kind 'trail'
  perks: string[];   // catalog ids, kind 'perk' (equipped)
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type SfxName =
  | 'laser'
  | 'explode'
  | 'correct'
  | 'wrong'
  | 'split'
  | 'shipHit'
  | 'shieldHit'
  | 'levelClear'
  | 'levelFail'
  | 'purchase'
  | 'click'
  | 'promote';

export interface AudioBus {
  play(name: SfxName): void;
  /** Continuous engine sound while thrusting. */
  setThrust(on: boolean): void;
  startMusic(): void;
  stopMusic(): void;
  /** Speak text if TTS is enabled in settings; no-op otherwise. Cancels prior speech. */
  speak(text: string): void;
}

// ---------------------------------------------------------------------------
// Settings & profiles
// ---------------------------------------------------------------------------

/**
 * 'rotate': classic Asteroids (Left/Right turn, Up thrusts forward, Down brakes).
 * 'direct': arrows/WASD move the ship in that screen direction; the ship turns to
 *           face where it's moving and Space fires the way it faces.
 */
export type ControlMode = 'rotate' | 'direct';

/**
 * Touch devices only.
 * 'tapdrag':  no joystick. Quick tap on a rock = turn + fire at it; hold/drag on empty
 *             space = fly toward the finger; small FIRE button shoots straight ahead.
 * 'joystick': small fixed, always-visible joystick in the bottom-left corner + FIRE;
 *             touches that start on a rock are still tap-to-target.
 */
export type TouchMode = 'tapdrag' | 'joystick';

export interface Settings {
  musicVolume: number; // 0..1
  sfxVolume: number;   // 0..1
  readAloud: boolean;
  controlMode: ControlMode;
  touchMode: TouchMode;
}

export interface Profile {
  id: string;
  name: string;
  /** Legacy: emoji picked at creation by older versions. No longer set or shown. */
  avatar?: string;
  createdAt: number;
  learning: LearningState;
  stardust: number;
  owned: string[]; // catalog ids
  loadout: ShipLoadout;
  bestScore: number;
  settings: Settings;
  /** Practice mode: the skill ids last picked (e.g. ["mul:7"]). Optional for older saves. */
  practiceSkills?: string[];
}

// ---------------------------------------------------------------------------
// Game engine surface (game -> main)
// ---------------------------------------------------------------------------

export interface GameCallbacks {
  onQuestion?(q: Question): void;
  onAnswer?(e: AnswerEvent): void;
  onShipHit?(hitsTaken: number, hitsAllowed: number): void;
  /**
   * The player asked to pause (P/Escape or the HUD pause button). The game has
   * already paused itself; main shows the pause menu and later calls resume() or stop().
   */
  onPause?(): void;
  onLevelEnd(result: LevelResult): void;
}

export interface LevelOptions {
  controlMode: ControlMode;
  touchMode: TouchMode;
  /** Show the fading on-screen controls hint (new pilots' first levels). */
  showControlsHint: boolean;
}

export interface GameEngine {
  /** Start a level. Renders into the container passed at construction. */
  startLevel(config: LevelConfig, loadout: ShipLoadout, callbacks: GameCallbacks, options: LevelOptions): void;
  pause(): void;
  resume(): void;
  /** Abort the current level without calling onLevelEnd, and return to attract mode. */
  stop(): void;
  /** Idle background behind menus: starfield with a few drifting asteroids, no HUD. */
  showAttract(): void;
  /**
   * Hangar preview: render the ship large and slowly rotating. `center` is where to
   * frame the ship in viewport fractions (0..1, default {x:0.5,y:0.5}) so UI panels
   * don't cover it. Calling again updates loadout/framing live.
   */
  showHangar(loadout: ShipLoadout, center?: { x: number; y: number }): void;
  dispose(): void;
}
