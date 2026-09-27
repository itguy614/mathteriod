/**
 * The ordered curriculum: Addition → Subtraction → Multiplication → Division,
 * each ramping from easy to hard facts, with review stages in between.
 *
 * Subtraction stages mirror the addition stages exactly (same base pairs, inverted),
 * and division mirrors multiplication. Later stages may include facts from earlier
 * ones; since per-fact stats are shared, already-mastered facts simply count
 * toward the new stage's coverage (extra early success, not extra grind).
 */
import type { Fact, Operation, StageDef } from '../types';
import { factsFor, factsFromPairs } from './facts';

type Pair = (x: number, y: number) => boolean;

// --- Addition ramp (x, y are the addends) ---------------------------------
const ADD_RAMP: { id: string; pair: Pair }[] = [
  // Both addends 1–5: tiny numbers, lots of wins (sums to 10).
  { id: 'small', pair: (x, y) => x <= 5 && y <= 5 },
  // Every pair that makes 10 or less (includes the make-ten pairs 1+9 … 9+1).
  { id: 'to10', pair: (x, y) => x + y <= 10 },
  // Addends to 10, bridging past ten (doubles 6+6…10+10, 8+5, 9+7, …).
  { id: 'bridge', pair: (x, y) => x <= 10 && y <= 10 && x + y > 10 },
  // Anything with an 11 or a 12.
  { id: 'to12', pair: (x, y) => x > 10 || y > 10 },
];

// --- Multiplication ramp (x, y are the factors) ---------------------------
const EASY_TABLES = new Set([1, 2, 5, 10]);
const MID_TABLES = new Set([3, 4]);
const inRange = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

const MUL_RAMP: { id: string; pair: Pair }[] = [
  // ×1, ×2, ×5, ×10 (other factor up to 10).
  { id: 'easy', pair: (x, y) => x <= 10 && y <= 10 && (EASY_TABLES.has(x) || EASY_TABLES.has(y)) },
  // ×3, ×4 facts not already covered by the easy tables.
  {
    id: 'mid',
    pair: (x, y) =>
      x <= 10 &&
      y <= 10 &&
      !EASY_TABLES.has(x) &&
      !EASY_TABLES.has(y) &&
      (MID_TABLES.has(x) || MID_TABLES.has(y)),
  },
  // ×6–×9: the remaining "hard core" (6×6 … 9×9).
  { id: 'hard', pair: (x, y) => inRange(x, 6, 9) && inRange(y, 6, 9) },
  // ×11, ×12: every fact with an 11 or 12.
  { id: 'big', pair: (x, y) => x > 10 || y > 10 },
];

function stage(id: string, name: string, op: Operation | 'mixed', facts: Fact[]): StageDef {
  return { id, name, op, facts };
}

const ADD_NAMES = [
  'Addition: Launch Pad',
  'Addition: Liftoff',
  'Addition: Into Orbit',
  'Addition: Moon Base',
];
const SUB_NAMES = [
  'Subtraction: Countdown',
  'Subtraction: Retro Rockets',
  'Subtraction: Gravity Well',
  'Subtraction: Comet Tail',
];
const MUL_NAMES = [
  'Multiplication: Star Hopper',
  'Multiplication: Warp Drive',
  'Multiplication: Nebula Run',
  'Multiplication: Galaxy Giants',
];
const DIV_NAMES = [
  'Division: Satellite Split',
  'Division: Ion Storm',
  'Division: Black Hole',
  'Division: Deep Space',
];

function buildStages(): StageDef[] {
  const s: StageDef[] = [];

  ADD_RAMP.forEach((r, i) => s.push(stage(`add-${r.id}`, ADD_NAMES[i], 'add', factsFromPairs('add', r.pair))));
  s.push(stage('add-review', 'Addition Review: Asteroid Belt', 'add', factsFor('add')));

  ADD_RAMP.forEach((r, i) => s.push(stage(`sub-${r.id}`, SUB_NAMES[i], 'sub', factsFromPairs('sub', r.pair))));
  s.push(stage('sub-review', 'Subtraction Review: Meteor Shower', 'sub', factsFor('sub')));
  s.push(stage('addsub-review', 'Mixed Review: Space Station', 'mixed', [...factsFor('add'), ...factsFor('sub')]));

  MUL_RAMP.forEach((r, i) => s.push(stage(`mul-${r.id}`, MUL_NAMES[i], 'mul', factsFromPairs('mul', r.pair))));
  s.push(stage('mul-review', 'Multiplication Review: Supernova', 'mul', factsFor('mul')));

  MUL_RAMP.forEach((r, i) => s.push(stage(`div-${r.id}`, DIV_NAMES[i], 'div', factsFromPairs('div', r.pair))));
  s.push(stage('div-review', 'Division Review: Pulsar Patrol', 'div', factsFor('div')));

  s.push(
    stage('grand-review', 'Grand Review: Galactic Champion', 'mixed', [
      ...factsFor('add'),
      ...factsFor('sub'),
      ...factsFor('mul'),
      ...factsFor('div'),
    ]),
  );
  return s;
}

/** The full ordered curriculum. Index into it with LearningState.stageIndex. */
export const STAGES: readonly StageDef[] = buildStages();

/** Find a stage's index by id (-1 if unknown). */
export function stageIndexById(id: string): number {
  return STAGES.findIndex((st) => st.id === id);
}
