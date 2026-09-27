/**
 * Practice-mode skills: fact families a player can pick to drill.
 *
 *   mul:N  ×N  every multiplication fact where either factor is N   (23 facts)
 *   div:N  ÷N  every division fact with divisor N                   (12 facts)
 *   add:N  +N  every addition fact where either addend is N         (23 facts)
 *   sub:N  −N  every subtraction fact that subtracts N (b = N)      (12 facts)
 *
 * for N = 1–12. Everything is unlocked from the start (independent of Mission progress).
 */
import type { Fact, FactStat, LearningState, Operation } from '../types';
import { MAX_OPERAND, MIN_OPERAND, OPERATIONS, factById, factsFromPairs } from './facts';
import { factMastered, factWeight } from './mastery';

/** e.g. "mul:7", "div:7", "add:8", "sub:8". */
export type SkillId = `${Operation}:${number}`;

export interface SkillDef {
  id: SkillId;
  op: Operation;
  n: number;
  /** Kid-facing label, e.g. "×7". */
  label: string;
  facts: Fact[];
}

export const SKILL_SYMBOL: Record<Operation, string> = { add: '+', sub: '−', mul: '×', div: '÷' };

function familyFacts(op: Operation, n: number): Fact[] {
  switch (op) {
    case 'mul':
    case 'add':
      return factsFromPairs(op, (x, y) => x === n || y === n);
    case 'sub':
    case 'div':
      // Inverse facts: the pair's y is the subtrahend / divisor.
      return factsFromPairs(op, (_x, y) => y === n);
  }
}

function buildSkills(): SkillDef[] {
  const out: SkillDef[] = [];
  for (const op of OPERATIONS) {
    for (let n = MIN_OPERAND; n <= MAX_OPERAND; n++) {
      out.push({ id: `${op}:${n}`, op, n, label: `${SKILL_SYMBOL[op]}${n}`, facts: familyFacts(op, n) });
    }
  }
  return out;
}

/** Every skill, grouped by operation (add, sub, mul, div), each N = 1–12. */
export const SKILLS: readonly SkillDef[] = buildSkills();

const BY_ID = new Map<string, SkillDef>(SKILLS.map((s) => [s.id, s]));

export function isSkillId(id: unknown): id is SkillId {
  return typeof id === 'string' && BY_ID.has(id);
}

export function skillById(id: string): SkillDef | undefined {
  return BY_ID.get(id);
}

/** Skills of one operation, N ascending. */
export function skillsFor(op: Operation): SkillDef[] {
  return SKILLS.filter((s) => s.op === op);
}

/** Label for a skill id ("×7"); unknown ids come back unchanged. */
export function skillLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** Union of the skills' facts, de-duplicated (×6 and ×7 both contain 6 × 7). Unknown ids are ignored. */
export function factsForSkills(ids: readonly string[]): Fact[] {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const id of ids) {
    for (const f of BY_ID.get(id)?.facts ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mastery meters
// ---------------------------------------------------------------------------

export type SkillLevel = 'new' | 'learning' | 'fast';

export interface SkillMastery {
  level: SkillLevel;
  /** 0..1: share of the family's facts that are fast-mastered. */
  fraction: number;
  /** How many of the family's facts have been answered at least once. */
  seen: number;
}

/** Share of a family's facts that must be fast-mastered for the "fast" meter. */
export const SKILL_FAST_SHARE = 0.8;

const statsOf = (s: LearningState | Record<string, FactStat>): Record<string, FactStat> =>
  'factStats' in s && typeof s.factStats === 'object' ? (s as LearningState).factStats : (s as Record<string, FactStat>);

/**
 * Meter for a skill tile: 'new' until any of its facts has been answered,
 * 'fast' once SKILL_FAST_SHARE of its facts are fast-mastered, else 'learning'.
 */
export function skillMastery(id: string, state: LearningState | Record<string, FactStat>): SkillMastery {
  const skill = BY_ID.get(id);
  if (!skill) return { level: 'new', fraction: 0, seen: 0 };
  const stats = statsOf(state);
  let seen = 0;
  let mastered = 0;
  for (const f of skill.facts) {
    const st = stats[f.id];
    if (st && st.attempts > 0) seen++;
    if (factMastered(st)) mastered++;
  }
  const fraction = mastered / skill.facts.length;
  const level: SkillLevel = seen === 0 ? 'new' : fraction >= SKILL_FAST_SHARE ? 'fast' : 'learning';
  return { level, fraction, seen };
}

// ---------------------------------------------------------------------------
// "Needs practice"
// ---------------------------------------------------------------------------

export const NEEDS_PRACTICE = {
  /** Fewer seen facts than this: the tile is disabled ("Play a few missions first"). */
  minSeen: 4,
  /** How many of the weakest facts a session drills. */
  maxFacts: 10,
};

/**
 * The player's weakest seen facts: highest practice weight first (recent misses,
 * slow answers), older facts breaking ties. Empty when fewer than
 * NEEDS_PRACTICE.minSeen facts have been answered.
 */
export function weakestFacts(state: LearningState | Record<string, FactStat>, max = NEEDS_PRACTICE.maxFacts): Fact[] {
  const stats = statsOf(state);
  const seen: { fact: Fact; w: number; last: number }[] = [];
  for (const [id, st] of Object.entries(stats)) {
    if (!st || st.attempts <= 0) continue;
    const fact = factById(id);
    if (!fact || !Number.isInteger(fact.answer) || fact.answer < 0) continue;
    seen.push({ fact, w: factWeight(st), last: st.lastSeen ?? 0 });
  }
  if (seen.length < NEEDS_PRACTICE.minSeen) return [];
  seen.sort((a, b) => b.w - a.w || a.last - b.last || a.fact.id.localeCompare(b.fact.id));
  return seen.slice(0, Math.max(NEEDS_PRACTICE.minSeen, max)).map((s) => s.fact);
}
