/**
 * Arithmetic fact generation.
 *
 * Every operand of the "forward" operations (+, ×) is 1–12. Subtraction and
 * division are generated as inverses of those, so their answers are always 1–12:
 *
 *   add:x:y  ->  x + y                 (answer 2–24)
 *   sub:s:y  ->  s − y  with s = x + y (answer x, 1–12)
 *   mul:x:y  ->  x × y                 (answer 1–144)
 *   div:p:y  ->  p ÷ y  with p = x · y (answer x, 1–12)
 */
import type { Fact, Operation } from '../types';

export const MIN_OPERAND = 1;
export const MAX_OPERAND = 12;

export const OPERATIONS: readonly Operation[] = ['add', 'sub', 'mul', 'div'];

const SYMBOL: Record<Operation, string> = { add: '+', sub: '−', mul: '×', div: '÷' };
const SPOKEN: Record<Operation, string> = {
  add: 'plus',
  sub: 'minus',
  mul: 'times',
  div: 'divided by',
};

function compute(op: Operation, a: number, b: number): number {
  switch (op) {
    case 'add':
      return a + b;
    case 'sub':
      return a - b;
    case 'mul':
      return a * b;
    case 'div':
      return a / b;
  }
}

/** Build a fact from its raw operands (no range validation; see generators below). */
export function makeFact(op: Operation, a: number, b: number): Fact {
  return {
    id: `${op}:${a}:${b}`,
    op,
    a,
    b,
    answer: compute(op, a, b),
    text: `${a} ${SYMBOL[op]} ${b}`,
    speech: `${a} ${SPOKEN[op]} ${b}`,
  };
}

/** The forward fact x (op) y and its inverse, for x, y in 1–12. */
export function additionFact(x: number, y: number): Fact {
  return makeFact('add', x, y);
}
/** Inverse of x + y: (x + y) − y = x. */
export function subtractionFact(x: number, y: number): Fact {
  return makeFact('sub', x + y, y);
}
export function multiplicationFact(x: number, y: number): Fact {
  return makeFact('mul', x, y);
}
/** Inverse of x × y: (x · y) ÷ y = x. */
export function divisionFact(x: number, y: number): Fact {
  return makeFact('div', x * y, y);
}

const BUILDERS: Record<Operation, (x: number, y: number) => Fact> = {
  add: additionFact,
  sub: subtractionFact,
  mul: multiplicationFact,
  div: divisionFact,
};

/**
 * Generate facts of one operation from (x, y) "base pairs" (both 1–12).
 * For sub/div the pair describes the underlying addition/multiplication fact,
 * and x is the answer.
 */
export function factsFromPairs(
  op: Operation,
  include: (x: number, y: number) => boolean = () => true,
): Fact[] {
  const out: Fact[] = [];
  for (let x = MIN_OPERAND; x <= MAX_OPERAND; x++) {
    for (let y = MIN_OPERAND; y <= MAX_OPERAND; y++) {
      if (include(x, y)) out.push(BUILDERS[op](x, y));
    }
  }
  return out;
}

/** All 144 facts of an operation. */
export function factsFor(op: Operation): Fact[] {
  return factsFromPairs(op);
}

let allCache: Fact[] | null = null;
let byIdCache: Map<string, Fact> | null = null;

/** All 576 generated facts (144 per operation). Treat the result as read-only. */
export function allFacts(): Fact[] {
  if (!allCache) allCache = OPERATIONS.flatMap((op) => factsFor(op));
  return allCache;
}

/** Look up a generated fact by id, or parse a well-formed id ("op:a:b") into a fact. */
export function factById(id: string): Fact | undefined {
  if (!byIdCache) byIdCache = new Map(allFacts().map((f) => [f.id, f]));
  const known = byIdCache.get(id);
  if (known) return known;
  const m = /^(add|sub|mul|div):(-?\d+):(-?\d+)$/.exec(id);
  if (!m) return undefined;
  const op = m[1] as Operation;
  const a = Number(m[2]);
  const b = Number(m[3]);
  if (op === 'div' && b === 0) return undefined;
  return makeFact(op, a, b);
}
