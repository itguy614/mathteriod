/**
 * Mastery thresholds shared by the stage gate (engine.ts) and the per-skill
 * meters (skills.ts), plus the per-fact practice weight. No imports from engine.ts.
 */
import type { FactStat } from '../types';

/**
 * Mastery gate. Response times exclude turning and bolt flight (game/level.ts),
 * but still include spotting the rock among others, so these are looser than
 * flashcard thresholds.
 */
export const MASTERY = {
  /** Pooled accuracy over the recent windows of the stage's facts. */
  accuracy: 0.9,
  /** A correct answer faster than this counts as "fast". */
  fastMs: 4000,
  /** Share of recent correct answers that must be fast. */
  fastShare: 0.75,
  /** A fact counts as individually mastered (skill meters) once attempted this many times. */
  minAttemptsPerFact: 2,
  /** For stage promotion, a fact counts as "covered" once attempted this many times. */
  coverageAttempts: 1,
  /** Fraction of the stage's facts that must be covered... */
  coverage: 0.5,
  /**
   * ...capped at this many facts. A 3-wave level asks ~10-14 questions, so this
   * sets the pace: ~1-2 levels per stage for a kid who knows the facts (~6-8 levels
   * for all of addition). Playtest: the old 80%/40-facts/2-attempts gate took 85+
   * (short) levels.
   */
  maxCoverageFacts: 12,
  /** Minimum levels cleared in the stage (promotion also requires clearing the current one). */
  minLevels: 1,
};

/**
 * True when a single fact is "fast-mastered": attempted at least
 * MASTERY.minAttemptsPerFact times, recent accuracy at least MASTERY.accuracy,
 * and at least MASTERY.fastShare of its recent correct times under MASTERY.fastMs.
 * The per-fact version of the stage gate in evaluateMastery().
 */
export function factMastered(st: FactStat | undefined): boolean {
  if (!st || st.attempts < MASTERY.minAttemptsPerFact || st.recent.length === 0 || st.recentMs.length === 0) return false;
  const acc = st.recent.filter(Boolean).length / st.recent.length;
  const fast = st.recentMs.filter((ms) => ms < MASTERY.fastMs).length / st.recentMs.length;
  return acc >= MASTERY.accuracy && fast >= MASTERY.fastShare;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Spaced review of earlier stages' facts in missions. A fact's review gap grows
 * with its run of first-try correct answers (1 → 3 → 7 → 14 → 30 days); a miss
 * makes it due again at once. Slow facts never get past the first gap.
 */
export const REVIEW = {
  gapsDays: [1, 3, 7, 14, 30],
  /** Target share of a mission level's question weight given to due review facts. */
  share: 0.2,
};

/** Correct first tries in a row, newest last. */
function correctRun(st: FactStat): number {
  let n = 0;
  for (let i = st.recent.length - 1; i >= 0 && st.recent[i]; i--) n++;
  return n;
}

/** When a seen fact is next due for review (epoch ms). Never-seen facts aren't scheduled. */
export function reviewDueAt(st: FactStat): number {
  const run = correctRun(st);
  if (run === 0) return st.lastSeen;
  const slow = !isKnown(st);
  const gaps = REVIEW.gapsDays;
  const days = slow ? gaps[0] : gaps[Math.min(run, gaps.length) - 1];
  return st.lastSeen + days * DAY_MS;
}

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
