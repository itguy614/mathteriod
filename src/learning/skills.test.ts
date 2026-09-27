import { describe, expect, it } from 'vitest';
import type { FactStat } from '../types';
import { MASTERY } from './mastery';
import {
  NEEDS_PRACTICE,
  SKILLS,
  factsForSkills,
  isSkillId,
  skillById,
  skillLabel,
  skillMastery,
  weakestFacts,
} from './skills';

const stat = (over: Partial<FactStat> = {}): FactStat => ({
  attempts: 4,
  correct: 4,
  recent: [true, true, true, true],
  recentMs: [1500, 1600, 1700, 1800],
  lastSeen: 1,
  ...over,
});

describe('skills', () => {
  it('has 12 skills per operation with symbol labels', () => {
    expect(SKILLS).toHaveLength(48);
    expect(skillLabel('mul:7')).toBe('×7');
    expect(skillLabel('div:7')).toBe('÷7');
    expect(skillLabel('add:8')).toBe('+8');
    expect(skillLabel('sub:8')).toBe('−8');
    expect(isSkillId('mul:12')).toBe(true);
    expect(isSkillId('mul:13')).toBe(false);
    expect(isSkillId('nope')).toBe(false);
  });

  it('×7 has 23 facts, each with a 7 factor', () => {
    const facts = skillById('mul:7')!.facts;
    expect(facts).toHaveLength(23);
    for (const f of facts) {
      expect(f.a === 7 || f.b === 7).toBe(true);
      expect(f.answer).toBe(f.a * f.b);
    }
    expect(new Set(facts.map((f) => f.id)).size).toBe(23);
  });

  it('÷7 has 12 facts, all dividing by 7', () => {
    const facts = skillById('div:7')!.facts;
    expect(facts).toHaveLength(12);
    for (const f of facts) {
      expect(f.b).toBe(7);
      expect(f.answer * 7).toBe(f.a);
    }
    expect(facts.map((f) => f.answer).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('+8 has 23 facts, each with an 8 addend', () => {
    const facts = skillById('add:8')!.facts;
    expect(facts).toHaveLength(23);
    for (const f of facts) {
      expect(f.a === 8 || f.b === 8).toBe(true);
      expect(f.answer).toBe(f.a + f.b);
    }
  });

  it('−8 has 12 facts, all subtracting 8', () => {
    const facts = skillById('sub:8')!.facts;
    expect(facts).toHaveLength(12);
    for (const f of facts) {
      expect(f.b).toBe(8);
      expect(f.answer).toBe(f.a - 8);
      expect(f.answer).toBeGreaterThanOrEqual(1);
    }
  });

  it('factsForSkills de-duplicates overlapping families and ignores unknown ids', () => {
    const facts = factsForSkills(['mul:6', 'mul:7', 'bogus']);
    const ids = facts.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 23 + 23 minus the shared 6×7 and 7×6.
    expect(facts).toHaveLength(44);
    expect(ids).toContain('mul:6:7');
    expect(ids).toContain('mul:7:6');
    expect(factsForSkills(['mul:7', 'mul:7'])).toHaveLength(23);
    expect(factsForSkills([])).toEqual([]);
  });
});

describe('skillMastery', () => {
  it('is new with no data', () => {
    expect(skillMastery('mul:7', {})).toEqual({ level: 'new', fraction: 0, seen: 0 });
    expect(skillMastery('unknown', {}).level).toBe('new');
  });

  it('is learning once any fact was answered', () => {
    const m = skillMastery('div:7', { 'div:14:7': stat({ recent: [false, true], recentMs: [9000], attempts: 2, correct: 1 }) });
    expect(m.level).toBe('learning');
    expect(m.seen).toBe(1);
    expect(m.fraction).toBe(0);
  });

  it('counts only fast-mastered facts toward the fraction', () => {
    const facts = skillById('div:7')!.facts;
    const stats: Record<string, FactStat> = {};
    facts.slice(0, 6).forEach((f) => (stats[f.id] = stat()));
    // Accurate but slow: not fast-mastered.
    facts.slice(6).forEach((f) => (stats[f.id] = stat({ recentMs: [MASTERY.fastMs + 2000, MASTERY.fastMs + 2000] })));
    const m = skillMastery('div:7', stats);
    expect(m.level).toBe('learning');
    expect(m.fraction).toBeCloseTo(0.5);
  });

  it('is fast when (nearly) every fact is fast-mastered; accepts a LearningState', () => {
    const stats: Record<string, FactStat> = {};
    for (const f of skillById('sub:8')!.facts) stats[f.id] = stat();
    const state = { stageIndex: 0, levelInStage: 0, clearedInStage: 0, levelsCleared: 0, consecutiveFailures: 0, factStats: stats };
    expect(skillMastery('sub:8', state)).toEqual({ level: 'fast', fraction: 1, seen: 12 });
  });

  it('a single attempt is never fast-mastered', () => {
    const stats: Record<string, FactStat> = {};
    for (const f of skillById('sub:8')!.facts) stats[f.id] = stat({ attempts: 1, correct: 1, recent: [true], recentMs: [1000] });
    expect(skillMastery('sub:8', stats).level).toBe('learning');
  });
});

describe('weakestFacts', () => {
  it('is empty until enough facts have been seen', () => {
    expect(weakestFacts({})).toEqual([]);
    const few: Record<string, FactStat> = { 'add:1:1': stat(), 'add:2:1': stat(), 'add:3:1': stat() };
    expect(weakestFacts(few)).toEqual([]);
    expect(Object.keys(few).length).toBeLessThan(NEEDS_PRACTICE.minSeen);
  });

  it('puts missed and slow facts first and caps the count', () => {
    const stats: Record<string, FactStat> = {};
    for (let i = 1; i <= 12; i++) stats[`add:${i}:2`] = stat();
    stats['mul:7:8'] = stat({ recent: [true, false, false], correct: 1, attempts: 3, recentMs: [7000] });
    stats['sub:15:8'] = stat({ recentMs: [9000, 9000, 9000, 9000] });
    const weak = weakestFacts(stats);
    expect(weak.length).toBe(NEEDS_PRACTICE.maxFacts);
    expect(weak[0].id).toBe('mul:7:8');
    expect(weak[1].id).toBe('sub:15:8');
  });
});
