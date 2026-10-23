/**
 * The learning engine: builds levels (difficulty + adaptive question provider)
 * from a LearningState, records results, and decides promotion via the mastery gate.
 *
 * Pure TypeScript: no DOM, no Three.js. Randomness and the clock are injectable.
 */
import type {
  AnswerEvent,
  Fact,
  FactStat,
  LearningState,
  LevelConfig,
  LevelResult,
  LevelSummary,
  Operation,
  Question,
  QuestionProvider,
  ReverseProvider,
  StageDef,
  WaveKind,
} from '../types';
import { allFacts, factById, makeFact } from './facts';
import { STAGES } from './curriculum';
import { MASTERY, REVIEW, factMastered, factWeight, median, reviewDueAt } from './mastery';
import { factsForSkills, skillLabel } from './skills';

export { MASTERY, REVIEW, factMastered, factWeight, reviewDueAt };

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

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
  rampLevels: 4,
  /** Waves per mission level (eased levels have fewer). Practice rounds are one wave. */
  waves: 3,
  easedWaves: 2,
  maxAsteroids: 8,
  easedMaxAsteroids: 6,
  /** Multiplier on count and speed for eased levels. */
  easeFactor: 0.7,
  /** Consecutive failures that trigger an eased level. */
  easeAfterFailures: 2,
  /** Every Nth mission level in a stage has a Reverse middle wave (never an eased one). */
  reverseEvery: 2,
  /**
   * Reverse waves: at most this many rocks (a pair sharing the target plus one),
   * at this fraction of the level's speed. Playtest: full-size Reverse waves were too hard.
   */
  reverseAsteroids: 3,
  reverseSpeedFactor: 0.75,
};

/**
 * Practice sessions (pick-a-skill). Each session starts at DIFFICULTY's start
 * values and ramps a little per consecutive clear, reaching the mission end
 * values after `rampClears` clears in a row.
 */
export const PRACTICE = {
  rampClears: 6,
  /** stageId of every practice level. */
  stageId: 'practice',
  /** Skill labels shown in the level name before it is shortened ("+2"). */
  maxLabelsInName: 4,
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

/**
 * Split a level's hit log into questions. The game reports every hit; a question
 * ends with its correct hit (a failed level may leave a trailing unanswered one).
 */
export function groupByQuestion(answers: AnswerEvent[]): AnswerEvent[][] {
  const out: AnswerEvent[][] = [];
  let cur: AnswerEvent[] = [];
  for (const e of answers) {
    if (cur.length > 0 && e.factId !== cur[0].factId) {
      out.push(cur); // defensive: fact changed without a correct hit
      cur = [];
    }
    cur.push(e);
    if (e.correct) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

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

  /** Stage facts plus any mixed-in review facts. */
  private readonly facts: Fact[];

  /**
   * @param review due facts from earlier stages, mixed in at REVIEW.share of the
   *               total question weight (they don't count toward this stage's gate).
   */
  constructor(
    private readonly stage: StageDef,
    stats: Record<string, FactStat>,
    eased: boolean,
    private readonly rng: () => number,
    review: readonly Fact[] = [],
  ) {
    let stageTotal = 0;
    for (const f of stage.facts) {
      const w = factWeight(stats[f.id], eased);
      this.weights.set(f.id, w);
      stageTotal += w;
    }
    const extra = review.filter((f) => !this.weights.has(f.id));
    if (extra.length > 0 && stageTotal > 0) {
      const raw = extra.map((f) => factWeight(stats[f.id]));
      const rawTotal = raw.reduce((a, b) => a + b, 0) || 1;
      const target = (stageTotal * REVIEW.share) / (1 - REVIEW.share);
      extra.forEach((f, i) => this.weights.set(f.id, (raw[i] / rawTotal) * target));
    }
    this.facts = [...stage.facts, ...(stageTotal > 0 ? extra : [])];
    for (const f of this.facts) {
      const list = this.byAnswer.get(f.answer);
      if (list) list.push(f);
      else this.byAnswer.set(f.answer, [f]);
    }
    this.answers = [...this.byAnswer.keys()].sort((a, b) => a - b);
  }

  initialValues(count: number): number[] {
    const facts = this.facts;
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
    if (candidates.length === 0) return fallbackDistractor(ans, neighbors, this.stage.op, this.rng);

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
 * Distractor for a fact set whose facts all share one answer (tiny practice
 * sets): a neighbouring-fact answer or ±1/±2, kept >= 1 so it is the answer of
 * some real fact of the preferred operation when possible. Never equals `ans`.
 */
function fallbackDistractor(ans: number, neighbors: Set<number>, op: Operation | 'mixed', rng: () => number): number {
  const ok = (v: number) => Number.isInteger(v) && v >= 1 && v !== ans;
  const pool = [...neighbors].filter(ok);
  const inOp = pool.filter((v) => allFacts().some((f) => f.answer === v && (op === 'mixed' || f.op === op)));
  const from = inOp.length > 0 ? inOp : pool;
  if (from.length > 0) return from[Math.floor(rng() * from.length)];
  for (const v of [ans + 1, ans - 1, ans + 2, ans - 2]) if (ok(v)) return v;
  return ans + 1;
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
// Reverse mode provider
// ---------------------------------------------------------------------------

/**
 * Reverse levels: rocks carry equations, the ship a target number. The opening
 * field pairs up equations that share an answer (24 = 3×8 = 4×6) so most targets
 * have several correct rocks; weaker facts are drawn more often.
 */
class ReverseFactProvider implements ReverseProvider {
  private readonly weights = new Map<string, number>();
  private readonly byAnswer = new Map<number, Fact[]>();

  constructor(
    private readonly stage: StageDef,
    stats: Record<string, FactStat>,
    private readonly rng: () => number,
  ) {
    for (const f of stage.facts) {
      this.weights.set(f.id, factWeight(stats[f.id]));
      const list = this.byAnswer.get(f.answer);
      if (list) list.push(f);
      else this.byAnswer.set(f.answer, [f]);
    }
  }

  private w(f: Fact): number {
    return this.weights.get(f.id) ?? 1;
  }

  /** Weighted pick from `pool`, skipping ids in `used`; null when nothing is left. */
  private draw(pool: readonly Fact[], used: Set<string>): Fact | null {
    const free = pool.filter((f) => !used.has(f.id));
    const idx = weightedIndex(free.map((f) => this.w(f)), this.rng);
    return idx >= 0 ? free[idx] : null;
  }

  initialFacts(count: number): Fact[] {
    const out: Fact[] = [];
    const used = new Set<string>();
    const targets = new Set<number>();
    const shared = [...this.byAnswer.entries()].filter(([, fs]) => fs.length >= 2);
    while (out.length + 2 <= count) {
      const open = shared.filter(([v]) => !targets.has(v));
      const idx = weightedIndex(open.map(([, fs]) => fs.reduce((t, f) => t + this.w(f), 0)), this.rng);
      if (idx < 0) break;
      const [v, fs] = open[idx];
      targets.add(v);
      for (let k = 0; k < 2; k++) {
        const f = this.draw(fs, used);
        if (f) {
          out.push(f);
          used.add(f.id);
        }
      }
    }
    while (out.length < count) {
      const f = this.draw(this.stage.facts, used) ?? this.stage.facts[Math.floor(this.rng() * this.stage.facts.length)];
      out.push(f);
      used.add(f.id);
    }
    // shuffle so pairs don't fly in side by side
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  pickTarget(liveFacts: Fact[]): number {
    const groups = new Map<number, Fact[]>();
    for (const f of liveFacts) {
      const g = groups.get(f.answer);
      if (g) g.push(f);
      else groups.set(f.answer, [f]);
    }
    const entries = [...groups.entries()];
    if (entries.length === 0) throw new Error('pickTarget needs at least one live rock');
    // targets with more matching rocks first, then weaker facts
    const idx = weightedIndex(entries.map(([, fs]) => fs.length * fs.length * fs.reduce((t, f) => t + this.w(f), 0)), this.rng);
    return entries[idx >= 0 ? idx : 0][0];
  }

  splitFact(target: number, liveFacts: Fact[]): Fact {
    const live = new Set(liveFacts.map((f) => f.id));
    const pool = this.stage.facts.filter((f) => f.answer !== target && !live.has(f.id));
    // near misses make the best distractors: 25 or 27 next to 24
    const near = (f: Fact) => {
      const d = Math.abs(f.answer - target);
      return d <= 3 ? 4 / d : 0.3;
    };
    const idx = weightedIndex(pool.map((f) => near(f) * this.w(f)), this.rng);
    if (idx >= 0) return pool[idx];
    const any = this.stage.facts.filter((f) => f.answer !== target);
    if (any.length > 0) return any[Math.floor(this.rng() * any.length)];
    return constructFactForAnswer(target + 1, this.stage.op);
  }
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
    if (st.attempts >= MASTERY.coverageAttempts) covered++;
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

/** Interpolate DIFFICULTY's start→end values; t in 0..1. */
function paceAt(t: number, eased: boolean): { count: number; speed: number } {
  let count = DIFFICULTY.startAsteroids + (DIFFICULTY.endAsteroids - DIFFICULTY.startAsteroids) * t;
  let speed = DIFFICULTY.startSpeed + (DIFFICULTY.endSpeed - DIFFICULTY.startSpeed) * t;
  if (eased) {
    count *= DIFFICULTY.easeFactor;
    speed *= DIFFICULTY.easeFactor;
  }
  return { count: Math.max(2, Math.round(count)), speed: Math.round(speed * 10) / 10 };
}

/**
 * Kid-facing name of a practice level: "Practice: ×6 ×7 ×8", shortened to
 * "Practice: ×1 ×2 ×3 ×4 +5" when many skills are picked.
 */
export function practiceName(skillIds: readonly string[]): string {
  if (skillIds.length === 0) return 'Practice';
  const labels = skillIds.map(skillLabel);
  const shown = labels.slice(0, PRACTICE.maxLabelsInName).join(' ');
  const more = labels.length - PRACTICE.maxLabelsInName;
  return `Practice: ${shown}${more > 0 ? ` +${more}` : ''}`;
}

export interface PracticeLevelOptions {
  /** Kid-facing level number: the session's level count (default streak + 1). */
  levelNumber?: number;
  /** Override the level name (e.g. "Needs practice"). */
  name?: string;
}

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

  /** The same adaptive provider for Missions and Practice. */
  private provider(stage: StageDef, eased: boolean, review: readonly Fact[] = []): QuestionProvider {
    return new AdaptiveQuestionProvider(stage, this.state.factStats, eased, this.rng, review);
  }

  /** Facts from earlier stages (not in the current one) that are due for spaced review. */
  dueReviewFacts(): Fact[] {
    const current = new Set(this.currentStage().facts.map((f) => f.id));
    const now = this.now();
    const out = new Map<string, Fact>();
    for (let i = 0; i < this.state.stageIndex; i++) {
      for (const f of STAGES[i].facts) {
        if (current.has(f.id) || out.has(f.id)) continue;
        const st = this.state.factStats[f.id];
        if (st && st.attempts > 0 && reviewDueAt(st) <= now) out.set(f.id, f);
      }
    }
    return [...out.values()];
  }

  buildLevel(): LevelConfig {
    const stage = this.currentStage();
    const eased = this.state.consecutiveFailures >= DIFFICULTY.easeAfterFailures;
    const pace = paceAt(clamp01(this.state.levelInStage / DIFFICULTY.rampLevels), eased);
    const reverse = !eased && this.state.levelInStage % DIFFICULTY.reverseEvery === DIFFICULTY.reverseEvery - 1;
    const waves: WaveKind[] = Array.from({ length: eased ? DIFFICULTY.easedWaves : DIFFICULTY.waves }, () => 'classic');
    if (reverse) waves[waves.length >> 1] = 'reverse';
    return {
      stageId: stage.id,
      stageName: stage.name,
      levelNumber: this.state.levelsCleared + 1,
      waves,
      reverse: reverse ? new ReverseFactProvider(stage, this.state.factStats, this.rng) : undefined,
      reversePace: reverse
        ? {
            asteroids: Math.min(pace.count, DIFFICULTY.reverseAsteroids),
            speed: Math.round(pace.speed * DIFFICULTY.reverseSpeedFactor * 10) / 10,
          }
        : undefined,
      initialAsteroids: pace.count,
      asteroidSpeed: pace.speed,
      maxAsteroids: eased ? DIFFICULTY.easedMaxAsteroids : DIFFICULTY.maxAsteroids,
      eased,
      questions: this.provider(stage, eased, this.dueReviewFacts()),
    };
  }

  /**
   * A practice level over an arbitrary fact set: skill ids ("mul:7") or facts.
   * Pace starts at DIFFICULTY's start values and ramps with `streak` (consecutive
   * clears this session), reaching the mission end values after PRACTICE.rampClears.
   * Questions use the same adaptive weighting as missions.
   */
  buildPracticeLevel(selection: readonly string[] | readonly Fact[], streak: number, opts: PracticeLevelOptions = {}): LevelConfig {
    const isIds = selection.every((x) => typeof x === 'string');
    const ids = isIds ? (selection as readonly string[]) : [];
    const facts = isIds ? factsForSkills(ids) : dedupeFacts(selection as readonly Fact[]);
    if (facts.length === 0) throw new Error('Practice needs at least one fact');
    const ops = new Set(facts.map((f) => f.op));
    const name = opts.name ?? (isIds ? practiceName(ids) : 'Practice');
    const stage: StageDef = {
      id: PRACTICE.stageId,
      name,
      op: ops.size === 1 ? facts[0].op : 'mixed',
      facts,
    };
    const s = Math.max(0, Math.floor(Number(streak) || 0));
    const pace = paceAt(clamp01(s / PRACTICE.rampClears), false);
    return {
      stageId: stage.id,
      stageName: name,
      levelNumber: Math.max(1, Math.floor(opts.levelNumber ?? s + 1)),
      waves: ['classic'],
      initialAsteroids: pace.count,
      asteroidSpeed: pace.speed,
      maxAsteroids: DIFFICULTY.maxAsteroids,
      eased: false,
      questions: this.provider(stage, false),
    };
  }

  /**
   * Fold a level's answers into the per-fact stats (shared by missions and practice).
   * Scored per question on the FIRST hit: the game reports every hit, and stray
   * shots at other rocks shouldn't count as several misses on a fact the kid knows.
   */
  private recordAnswers(result: LevelResult): { accuracy: number; medianCorrectMs: number | null } {
    const s = this.state;
    const ts = this.now();
    const questions = groupByQuestion(result.answers);
    for (const q of questions) {
      const first = q[0];
      const st = s.factStats[first.factId] ?? { attempts: 0, correct: 0, recentMs: [], recent: [], lastSeen: 0 };
      st.attempts++;
      st.recent.push(first.correct);
      if (first.correct) {
        st.correct++;
        if (Number.isFinite(first.responseMs) && first.responseMs >= 0) st.recentMs.push(first.responseMs);
      }
      if (st.recent.length > RECENT_WINDOW) st.recent.splice(0, st.recent.length - RECENT_WINDOW);
      if (st.recentMs.length > RECENT_WINDOW) st.recentMs.splice(0, st.recentMs.length - RECENT_WINDOW);
      st.lastSeen = ts;
      s.factStats[first.factId] = st;
    }
    const firstTry = questions.filter((q) => q[0].correct);
    const accuracy = questions.length > 0 ? firstTry.length / questions.length : 0;
    const medianCorrectMs = median(firstTry.map((q) => q[0].responseMs));
    return { accuracy, medianCorrectMs };
  }

  recordLevel(result: LevelResult): LevelSummary {
    const s = this.state;
    const { accuracy, medianCorrectMs } = this.recordAnswers(result);

    const cleared = result.outcome === 'cleared';
    s.levelInStage++;
    if (cleared) {
      s.levelsCleared++;
      s.clearedInStage++;
      s.consecutiveFailures = 0;
    } else {
      s.consecutiveFailures++;
    }

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

  /**
   * Record a practice level: per-fact stats update exactly as in missions, but
   * mission progression (stage, level counters, failures) is untouched and
   * practice never promotes. stageProgress is the current mission stage's.
   */
  recordPractice(result: LevelResult): LevelSummary {
    const { accuracy, medianCorrectMs } = this.recordAnswers(result);
    return { accuracy, medianCorrectMs, promoted: false, stageProgress: this.stageProgress() };
  }
}

function dedupeFacts(facts: readonly Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}
