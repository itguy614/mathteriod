/**
 * The learning engine: builds levels (difficulty + adaptive question provider)
 * from a LearningState, records results, and decides promotion via the mastery gate.
 *
 * Pure TypeScript: no DOM, no Three.js. Randomness and the clock are injectable.
 */
import type {
  Fact,
  FactStat,
  LearningState,
  LevelConfig,
  LevelResult,
  LevelSummary,
  Operation,
  Question,
  QuestionProvider,
  StageDef,
} from '../types';
import { allFacts, factById, makeFact } from './facts';
import { STAGES } from './curriculum';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Mastery gate. Response times include flying and aiming at the asteroid,
 * so these are looser than flashcard thresholds.
 */
export const MASTERY = {
  /** Pooled accuracy over the recent windows of the stage's facts. */
  accuracy: 0.9,
  /** A correct answer faster than this counts as "fast". */
  fastMs: 4000,
  /** Share of recent correct answers that must be fast. */
  fastShare: 0.75,
  /** A fact counts as "covered" once attempted this many times. */
  minAttemptsPerFact: 2,
  /** Fraction of the stage's facts that must be covered... */
  coverage: 0.8,
  /** ...capped at this many facts, so big review stages stay reachable. */
  maxCoverageFacts: 40,
  /** Minimum levels played in the stage (promotion also requires clearing the current one). */
  minLevels: 2,
};

/** Level difficulty ramp within a stage. World is ~100 units wide. */
/**
 * Kept deliberately gentle: playtesting showed faster/more rocks turn the game
 * into dodging instead of math (level 5 was unplayable at 7 rocks / 11 u/s).
 */
export const DIFFICULTY = {
  startAsteroids: 3,
  endAsteroids: 5,
  startSpeed: 2,
  endSpeed: 5,
  /** Levels played in a stage until the ramp reaches its end values. */
  rampLevels: 12,
  maxAsteroids: 8,
  easedMaxAsteroids: 6,
  /** Multiplier on count and speed for eased levels. */
  easeFactor: 0.7,
  /** Consecutive failures that trigger an eased level. */
  easeAfterFailures: 2,
};

/** Length cap of FactStat.recent / recentMs. */
export const RECENT_WINDOW = 8;

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

export function initialLearningState(): LearningState {
  return { stageIndex: 0, levelInStage: 0, clearedInStage: 0, levelsCleared: 0, consecutiveFailures: 0, factStats: {} };
}

function cloneStat(s: FactStat): FactStat {
  return { attempts: s.attempts, correct: s.correct, recentMs: [...s.recentMs], recent: [...s.recent], lastSeen: s.lastSeen };
}

function cloneState(s: LearningState): LearningState {
  const factStats: Record<string, FactStat> = {};
  for (const [id, st] of Object.entries(s.factStats ?? {})) factStats[id] = cloneStat(st);
  return {
    stageIndex: s.stageIndex,
    levelInStage: s.levelInStage,
    clearedInStage: s.clearedInStage ?? 0, // absent in saves from before this field existed
    levelsCleared: s.levelsCleared,
    consecutiveFailures: s.consecutiveFailures,
    factStats,
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** True when the kid reliably knows a fact: recent accuracy high and mostly quick. */
function isKnown(st: FactStat | undefined): boolean {
  if (!st || st.recent.length < 2) return false;
  const acc = st.recent.filter(Boolean).length / st.recent.length;
  const med = median(st.recentMs);
  return acc >= 0.8 && med !== null && med <= MASTERY.fastMs * 1.25;
}

/**
 * Practice weight of a fact: higher = more likely to be asked.
 * Normal levels favour unseen, recently missed and slow facts.
 * Eased levels flip the bias toward facts the kid already knows.
 */
export function factWeight(st: FactStat | undefined, eased = false): number {
  if (eased) {
    if (!st) return 0.5;
    return isKnown(st) ? 4 : 1;
  }
  if (!st || st.attempts === 0) return 3;
  let w = 1;
  if (st.recent.length > 0) {
    const misses = st.recent.filter((r) => !r).length;
    w += 4 * (misses / st.recent.length);
    if (!st.recent[st.recent.length - 1]) w += 2; // just missed it
  }
  const med = median(st.recentMs);
  if (med !== null && med > MASTERY.fastMs) {
    w += Math.min(2, (2 * (med - MASTERY.fastMs)) / MASTERY.fastMs);
  }
  if (st.attempts < MASTERY.minAttemptsPerFact) w += 1;
  if (isKnown(st)) w *= 0.6; // still reviewed, just less often
  return w;
}

/** Weighted random choice; returns -1 for an empty / all-zero list. */
function weightedIndex(weights: number[], rng: () => number): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  // Floating point edge: return the last positive weight.
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return -1;
}

function toQuestion(f: Fact): Question {
  return { factId: f.id, prompt: f.text, speech: f.speech, answer: f.answer };
}

/**
 * Build some valid-looking fact with answer n, preferring `op`. Operands stay
 * 1–12 for the forward operations whenever possible. Last-resort fallback only.
 */
export function constructFactForAnswer(n: number, op: Operation | 'mixed'): Fact {
  const pref: Operation = op === 'mixed' ? 'add' : op;
  if (Number.isInteger(n)) {
    if (pref === 'add' && n >= 2 && n <= 24) return makeFact('add', Math.ceil(n / 2), Math.floor(n / 2));
    if (pref === 'mul' && n >= 1) {
      for (let b = 12; b >= 1; b--) if (n % b === 0 && n / b <= 12) return makeFact('mul', n / b, b);
    }
    if (pref === 'div' && n >= 1) return makeFact('div', n, 1);
    if (n >= 2 && n <= 24 && pref !== 'sub') return makeFact('add', Math.ceil(n / 2), Math.floor(n / 2));
    if (n >= 1) return makeFact('sub', n + 1, 1); // e.g. 1 -> "2 − 1"
    return makeFact('sub', 1, 1 - n); // 0 -> "1 − 1"; negatives stay well-formed
  }
  // Non-integers should never appear; keep the contract (answer === n) anyway.
  return { id: `add:${n}:0`, op: 'add', a: n, b: 0, answer: n, text: `${n} + 0`, speech: `${n} plus 0` };
}

// ---------------------------------------------------------------------------
// Question provider
// ---------------------------------------------------------------------------

/** How many recent questions are damped, and by how much. */
const HISTORY_LENGTH = 4;
const RECENT_DAMPING = 0.35;

class AdaptiveQuestionProvider implements QuestionProvider {
  private readonly weights = new Map<string, number>();
  private readonly byAnswer = new Map<number, Fact[]>();
  private readonly answers: number[];
  /** Most recently asked fact ids this level, newest last (spreads practice). */
  private readonly history: string[] = [];
  private lastFactId: string | null = null;

  constructor(
    private readonly stage: StageDef,
    stats: Record<string, FactStat>,
    eased: boolean,
    private readonly rng: () => number,
  ) {
    for (const f of stage.facts) {
      this.weights.set(f.id, factWeight(stats[f.id], eased));
      const list = this.byAnswer.get(f.answer);
      if (list) list.push(f);
      else this.byAnswer.set(f.answer, [f]);
    }
    this.answers = [...this.byAnswer.keys()].sort((a, b) => a - b);
  }

  initialValues(count: number): number[] {
    const facts = this.stage.facts;
    const out: number[] = [];
    const used = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      // Draw a fact by practice weight, but only among values used the fewest
      // times so far: duplicates appear only once every distinct answer is out.
      const minUse = Math.min(...this.answers.map((v) => used.get(v) ?? 0));
      const w = facts.map((f) => ((used.get(f.answer) ?? 0) === minUse ? (this.weights.get(f.id) ?? 1) : 0));
      const idx = weightedIndex(w, this.rng);
      const v = idx >= 0 ? facts[idx].answer : this.answers[Math.floor(this.rng() * this.answers.length)];
      out.push(v);
      used.set(v, (used.get(v) ?? 0) + 1);
    }
    return out;
  }

  pickQuestion(liveValues: number[]): Question {
    const live = new Set(liveValues);
    let candidates: Fact[] = [];
    for (const v of live) candidates.push(...(this.byAnswer.get(v) ?? []));

    if (candidates.length === 0) {
      if (live.size === 0) {
        // Contract violation by the caller; any stage fact is the best we can do.
        candidates = [...this.stage.facts];
      } else {
        return toQuestion(this.fallbackFact(liveValues));
      }
    }

    // Avoid the exact same fact back to back when there is an alternative.
    if (candidates.length > 1 && this.lastFactId !== null) {
      const filtered = candidates.filter((f) => f.id !== this.lastFactId);
      if (filtered.length > 0) candidates = filtered;
    }

    // Facts asked in the last few questions are damped so a level covers more
    // ground; long-run frequencies still follow the practice weights.
    const w = candidates.map((f) => (this.weights.get(f.id) ?? 1) * (this.history.includes(f.id) ? RECENT_DAMPING : 1));
    const idx = weightedIndex(w, this.rng);
    const fact = candidates[idx >= 0 ? idx : Math.floor(this.rng() * candidates.length)];
    this.remember(fact.id);
    return toQuestion(fact);
  }

  private remember(id: string): void {
    this.lastFactId = id;
    this.history.push(id);
    if (this.history.length > HISTORY_LENGTH) this.history.shift();
  }

  /** Defensive: a fact whose answer is live, from all generated facts or constructed. */
  private fallbackFact(liveValues: number[]): Fact {
    const v = liveValues[Math.floor(this.rng() * liveValues.length)];
    const pool = allFacts().filter((f) => f.answer === v);
    const preferred = this.stage.op === 'mixed' ? pool : pool.filter((f) => f.op === this.stage.op);
    const from = preferred.length > 0 ? preferred : pool;
    const fact = from.length > 0 ? from[Math.floor(this.rng() * from.length)] : constructFactForAnswer(v, this.stage.op);
    this.remember(fact.id);
    return fact;
  }

  splitValue(current: Question, liveValues: number[]): number {
    const ans = current.answer;
    const neighbors = neighborAnswers(current.factId);
    const liveCount = new Map<number, number>();
    for (const v of liveValues) liveCount.set(v, (liveCount.get(v) ?? 0) + 1);

    const candidates = this.answers.filter((v) => v !== ans);
    if (candidates.length === 0) return ans + 1; // degenerate stage; never equal the answer

    const weights = candidates.map((v) => {
      const d = Math.abs(v - ans);
      let w = 0;
      if (d <= 2) w += 3 / d; // ±1 strongly, ±2 somewhat
      if (neighbors.has(v)) w += 2; // neighbouring table / off-by-one operand
      if (w > 0 && (liveCount.get(v) ?? 0) >= 2) w *= 0.5; // don't pile up one number
      return w;
    });
    const idx = weightedIndex(weights, this.rng);
    if (idx >= 0) return candidates[idx];

    // Nothing near: take the closest stage answer.
    let best = candidates[0];
    for (const v of candidates) if (Math.abs(v - ans) < Math.abs(best - ans)) best = v;
    return best;
  }
}

/**
 * Answers of "neighbouring" facts: nudge either operand by ±1 (e.g. 6×7 -> 6×6,
 * 6×8, 5×7, 7×7). These are the classic confusions, so they make good distractors.
 */
function neighborAnswers(factId: string): Set<number> {
  const out = new Set<number>();
  const f = factById(factId);
  if (!f) return out;
  for (const [da, db] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const a = f.a + da;
    const b = f.b + db;
    if (a < 1 || b < 1) continue;
    const n = makeFact(f.op, a, b).answer;
    if (Number.isInteger(n) && n !== f.answer) out.add(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mastery evaluation
// ---------------------------------------------------------------------------

export interface MasteryReport {
  /** 0..1: covered facts / required facts. */
  coverage: number;
  /** Pooled recent accuracy (0 when there is no data). */
  accuracy: number;
  /** Share of recent correct answers under MASTERY.fastMs (0 when no data). */
  fastShare: number;
  /** Levels cleared in this stage vs MASTERY.minLevels, 0..1. */
  levels: number;
  /** All gate conditions met (promotion additionally requires a cleared level). */
  met: boolean;
}

export function evaluateMastery(stage: StageDef, state: LearningState): MasteryReport {
  const required = Math.max(1, Math.min(Math.ceil(stage.facts.length * MASTERY.coverage), MASTERY.maxCoverageFacts));
  let covered = 0;
  let outcomes = 0;
  let correct = 0;
  let times = 0;
  let fast = 0;
  for (const f of stage.facts) {
    const st = state.factStats[f.id];
    if (!st) continue;
    if (st.attempts >= MASTERY.minAttemptsPerFact) covered++;
    outcomes += st.recent.length;
    correct += st.recent.filter(Boolean).length;
    times += st.recentMs.length;
    fast += st.recentMs.filter((ms) => ms < MASTERY.fastMs).length;
  }
  const coverage = clamp01(covered / required);
  const accuracy = outcomes > 0 ? correct / outcomes : 0;
  const fastShare = times > 0 ? fast / times : 0;
  const levels = clamp01(state.clearedInStage / MASTERY.minLevels);
  const met =
    covered >= required &&
    accuracy >= MASTERY.accuracy &&
    fastShare >= MASTERY.fastShare &&
    state.clearedInStage >= MASTERY.minLevels;
  return { coverage, accuracy, fastShare, levels, met };
}

/**
 * Progress bar value: weighted blend of how close each gate condition is.
 * Coverage matters most early; accuracy and speed finish the bar. Held below
 * 1 until the gate is actually met so a full bar always means "ready".
 */
export function progressFromReport(r: MasteryReport): number {
  if (r.met) return 1;
  const p =
    0.4 * r.coverage +
    0.3 * clamp01(r.accuracy / MASTERY.accuracy) +
    0.2 * clamp01(r.fastShare / MASTERY.fastShare) +
    0.1 * r.levels;
  return Math.min(0.99, clamp01(p));
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class LearningEngine {
  private state: LearningState;

  /**
   * @param state persisted state; cloned, never mutated.
   * @param rng   random source in [0, 1) (inject for tests).
   * @param now   clock in epoch ms (inject for tests).
   */
  constructor(
    state: LearningState,
    private readonly rng: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {
    this.state = cloneState(state);
    // Defensive: clamp a stale/corrupt stage index into range.
    const idx = Math.floor(Number(this.state.stageIndex) || 0);
    this.state.stageIndex = Math.max(0, Math.min(STAGES.length - 1, idx));
  }

  /** A copy of the current state, safe to persist. */
  getState(): LearningState {
    return cloneState(this.state);
  }

  currentStage(): StageDef {
    return STAGES[this.state.stageIndex];
  }

  /** 0..1 progress toward promotion out of the current stage. */
  stageProgress(): number {
    return progressFromReport(evaluateMastery(this.currentStage(), this.state));
  }

  buildLevel(): LevelConfig {
    const stage = this.currentStage();
    const eased = this.state.consecutiveFailures >= DIFFICULTY.easeAfterFailures;
    const t = clamp01(this.state.levelInStage / DIFFICULTY.rampLevels);
    let count = DIFFICULTY.startAsteroids + (DIFFICULTY.endAsteroids - DIFFICULTY.startAsteroids) * t;
    let speed = DIFFICULTY.startSpeed + (DIFFICULTY.endSpeed - DIFFICULTY.startSpeed) * t;
    if (eased) {
      count *= DIFFICULTY.easeFactor;
      speed *= DIFFICULTY.easeFactor;
    }
    return {
      stageId: stage.id,
      stageName: stage.name,
      levelNumber: this.state.levelsCleared + 1,
      mode: 'classic',
      initialAsteroids: Math.max(2, Math.round(count)),
      asteroidSpeed: Math.round(speed * 10) / 10,
      maxAsteroids: eased ? DIFFICULTY.easedMaxAsteroids : DIFFICULTY.maxAsteroids,
      eased,
      questions: new AdaptiveQuestionProvider(stage, this.state.factStats, eased, this.rng),
    };
  }

  recordLevel(result: LevelResult): LevelSummary {
    const s = this.state;
    const ts = this.now();

    for (const e of result.answers) {
      const st = s.factStats[e.factId] ?? { attempts: 0, correct: 0, recentMs: [], recent: [], lastSeen: 0 };
      st.attempts++;
      st.recent.push(e.correct);
      if (e.correct) {
        st.correct++;
        if (Number.isFinite(e.responseMs) && e.responseMs >= 0) st.recentMs.push(e.responseMs);
      }
      if (st.recent.length > RECENT_WINDOW) st.recent.splice(0, st.recent.length - RECENT_WINDOW);
      if (st.recentMs.length > RECENT_WINDOW) st.recentMs.splice(0, st.recentMs.length - RECENT_WINDOW);
      st.lastSeen = ts;
      s.factStats[e.factId] = st;
    }

    const cleared = result.outcome === 'cleared';
    s.levelInStage++;
    if (cleared) {
      s.levelsCleared++;
      s.clearedInStage++;
      s.consecutiveFailures = 0;
    } else {
      s.consecutiveFailures++;
    }

    const nCorrect = result.answers.filter((a) => a.correct).length;
    const accuracy = result.answers.length > 0 ? nCorrect / result.answers.length : 0;
    const medianCorrectMs = median(result.answers.filter((a) => a.correct).map((a) => a.responseMs));

    const report = evaluateMastery(this.currentStage(), s);
    const canAdvance = s.stageIndex < STAGES.length - 1;
    if (cleared && report.met && canAdvance) {
      s.stageIndex++;
      s.levelInStage = 0;
      s.clearedInStage = 0;
      return {
        accuracy,
        medianCorrectMs,
        promoted: true,
        newStageName: STAGES[s.stageIndex].name,
        // The stage just finished is complete; engine.stageProgress() now reports the new stage.
        stageProgress: 1,
      };
    }

    return { accuracy, medianCorrectMs, promoted: false, stageProgress: progressFromReport(report) };
  }
}
