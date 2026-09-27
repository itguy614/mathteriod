import { describe, expect, it } from 'vitest';
import { allFacts, factById, factsFor, makeFact } from './facts';
import { STAGES } from './curriculum';

describe('facts', () => {
  it('generates 144 facts per operation with unique ids', () => {
    for (const op of ['add', 'sub', 'mul', 'div'] as const) {
      const fs = factsFor(op);
      expect(fs).toHaveLength(144);
      expect(new Set(fs.map((f) => f.id)).size).toBe(144);
    }
    expect(allFacts()).toHaveLength(576);
  });

  it('addition: operands 1–12, correct answers, symbol and speech', () => {
    for (const f of factsFor('add')) {
      expect(f.a).toBeGreaterThanOrEqual(1);
      expect(f.a).toBeLessThanOrEqual(12);
      expect(f.b).toBeGreaterThanOrEqual(1);
      expect(f.b).toBeLessThanOrEqual(12);
      expect(f.answer).toBe(f.a + f.b);
      expect(f.text).toBe(`${f.a} + ${f.b}`);
      expect(f.speech).toBe(`${f.a} plus ${f.b}`);
      expect(f.id).toBe(`add:${f.a}:${f.b}`);
    }
    const f = factById('add:7:5')!;
    expect(f.answer).toBe(12);
    expect(f.speech).toBe('7 plus 5');
  });

  it('subtraction: inverse of addition, answers 1–12, minus sign U+2212', () => {
    for (const f of factsFor('sub')) {
      expect(f.answer).toBe(f.a - f.b);
      expect(f.answer).toBeGreaterThanOrEqual(1);
      expect(f.answer).toBeLessThanOrEqual(12);
      expect(f.b).toBeGreaterThanOrEqual(1);
      expect(f.b).toBeLessThanOrEqual(12);
      expect(f.text).toBe(`${f.a} − ${f.b}`);
      expect(f.text).not.toContain('-');
    }
    const f = factById('sub:12:5')!;
    expect(f.answer).toBe(7);
    expect(f.text).toBe('12 − 5');
    expect(f.speech).toBe('12 minus 5');
  });

  it('multiplication: correct answers and × symbol', () => {
    for (const f of factsFor('mul')) {
      expect(f.answer).toBe(f.a * f.b);
      expect(f.text).toBe(`${f.a} × ${f.b}`);
    }
    expect(factById('mul:6:7')!.speech).toBe('6 times 7');
  });

  it('division: inverse of multiplication, integer answers 1–12, ÷ symbol', () => {
    for (const f of factsFor('div')) {
      expect(Number.isInteger(f.answer)).toBe(true);
      expect(f.answer * f.b).toBe(f.a);
      expect(f.answer).toBeGreaterThanOrEqual(1);
      expect(f.answer).toBeLessThanOrEqual(12);
      expect(f.b).toBeGreaterThanOrEqual(1);
      expect(f.b).toBeLessThanOrEqual(12);
      expect(f.text).toBe(`${f.a} ÷ ${f.b}`);
    }
    const f = factById('div:42:6')!;
    expect(f.answer).toBe(7);
    expect(f.speech).toBe('42 divided by 6');
  });

  it('factById parses unknown but well-formed ids and rejects junk', () => {
    expect(factById('sub:13:1')).toEqual(makeFact('sub', 13, 1));
    expect(factById('nope')).toBeUndefined();
    expect(factById('div:5:0')).toBeUndefined();
  });
});

describe('curriculum', () => {
  it('has unique ids, non-empty stages, and facts matching the stage op', () => {
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(STAGES.length);
    for (const s of STAGES) {
      expect(s.facts.length).toBeGreaterThan(0);
      expect(s.name.length).toBeGreaterThan(0);
      if (s.op !== 'mixed') for (const f of s.facts) expect(f.op).toBe(s.op);
    }
  });

  it('follows add → sub → mul → div order and starts easy', () => {
    const ops = STAGES.map((s) => s.op);
    expect(ops[0]).toBe('add');
    expect(ops.indexOf('sub')).toBeGreaterThan(ops.lastIndexOf('add'));
    expect(ops.indexOf('mul')).toBeGreaterThan(ops.lastIndexOf('sub'));
    expect(ops.indexOf('div')).toBeGreaterThan(ops.lastIndexOf('mul'));
    expect(STAGES[STAGES.length - 1].op).toBe('mixed');
    for (const f of STAGES[0].facts) expect(f.answer).toBeLessThanOrEqual(10);
  });

  it('subtraction stages mirror addition stages', () => {
    const addStages = STAGES.filter((s) => s.op === 'add');
    const subStages = STAGES.filter((s) => s.op === 'sub');
    expect(subStages.length).toBe(addStages.length);
    addStages.forEach((a, i) => expect(subStages[i].facts.length).toBe(a.facts.length));
  });
});
