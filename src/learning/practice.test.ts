import { describe, expect, it } from 'vitest';
import type { AnswerEvent, Fact, FactStat, LearningState, LevelResult } from '../types';
import { DIFFICULTY, LearningEngine, PRACTICE, initialLearningState, practiceName } from './engine';
import { factById, makeFact } from './facts';
import { factsForSkills, skillById } from './skills';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const level = (outcome: 'cleared' | 'failed', answers: AnswerEvent[]): LevelResult => ({
  outcome,
  answers,
  durationMs: 60000,
  hitsTaken: 0,
  score: 500,
});

/** Simulate the game's use of a provider: pick questions from the live field, split on misses. */
function drive(facts: Fact[], rounds: number, seed: number, skillIds?: string[]) {
  const engine = new LearningEngine(initialLearningState(), seeded(seed));
  const cfg = engine.buildPracticeLevel(skillIds ?? facts, 0);
  const q = cfg.questions;
  const setIds = new Set(facts.map((f) => f.id));
  const rng = seeded(seed + 99);
  let live = q.initialValues(cfg.initialAsteroids);
  for (let i = 0; i < rounds; i++) {
    const question = q.pickQuestion(live);
    expect(live).toContain(question.answer);
    // Questions stay inside the practice set when the live values allow it.
    expect(setIds.has(question.factId) || !facts.some((f) => live.includes(f.answer))).toBe(true);
    if (rng() < 0.4) {
      const split = q.splitValue(question, live);
      expect(split).not.toBe(question.answer);
      expect(Number.isInteger(split)).toBe(true);
      expect(split).toBeGreaterThanOrEqual(1);
      live.push(split);
      if (live.length > cfg.maxAsteroids) live.shift();
    } else {
      live.splice(live.indexOf(question.answer), 1);
      if (live.length === 0) live = q.initialValues(cfg.initialAsteroids);
    }
  }
}

describe('practice level', () => {
  it('uses only the chosen facts and names the level', () => {
    const engine = new LearningEngine(initialLearningState(), seeded(1));
    const cfg = engine.buildPracticeLevel(['mul:6', 'mul:7', 'mul:8'], 0);
    expect(cfg.stageId).toBe(PRACTICE.stageId);
    expect(cfg.stageName).toBe('Practice: ×6 ×7 ×8');
    expect(cfg.levelNumber).toBe(1);
    expect(cfg.eased).toBe(false);
    const answers = new Set(factsForSkills(['mul:6', 'mul:7', 'mul:8']).map((f) => f.answer));
    for (const v of cfg.questions.initialValues(20)) expect(answers.has(v)).toBe(true);
  });

  it('shortens long names and supports a custom name / level number', () => {
    expect(practiceName(['add:1', 'add:2', 'add:3', 'add:4', 'add:5', 'add:6'])).toBe('Practice: +1 +2 +3 +4 +2');
    const engine = new LearningEngine(initialLearningState());
    const facts = [factById('mul:7:8')!, factById('sub:15:8')!, factById('add:9:4')!, factById('div:42:6')!];
    const cfg = engine.buildPracticeLevel(facts, 2, { name: 'Needs practice', levelNumber: 5 });
    expect(cfg.stageName).toBe('Needs practice');
    expect(cfg.levelNumber).toBe(5);
  });

  it('rejects an empty selection', () => {
    expect(() => new LearningEngine(initialLearningState()).buildPracticeLevel([], 0)).toThrow();
  });

  it('pickQuestion always returns a live answer and splitValue is never the answer', () => {
    for (const ids of [['mul:7'], ['div:1'], ['sub:12'], ['add:1', 'div:12'], ['mul:6', 'mul:7', 'mul:8']]) {
      for (let seed = 1; seed <= 5; seed++) drive(factsForSkills(ids), 150, seed, ids);
    }
  });

  it('handles tiny fact sets, including one where every fact shares an answer', () => {
    // 1 + 5, 2 + 4, 3 + 3: every answer is 6.
    const same = [makeFact('add', 1, 5), makeFact('add', 2, 4), makeFact('add', 3, 3)];
    for (let seed = 1; seed <= 10; seed++) drive(same, 80, seed);
    drive([factById('div:1:1')!], 40, 3);
    const tinyDiv = skillById('div:1')!.facts.slice(0, 2);
    for (let seed = 1; seed <= 5; seed++) drive(tinyDiv, 80, seed);
  });

  it('pace starts gentle and ramps with the streak up to the mission end values', () => {
    const engine = new LearningEngine(initialLearningState());
    const at = (streak: number) => engine.buildPracticeLevel(['mul:7'], streak);
    const s0 = at(0);
    expect(s0.initialAsteroids).toBe(DIFFICULTY.startAsteroids);
    expect(s0.asteroidSpeed).toBe(DIFFICULTY.startSpeed);
    const s3 = at(3);
    expect(s3.asteroidSpeed).toBeGreaterThan(s0.asteroidSpeed);
    expect(s3.asteroidSpeed).toBeLessThan(DIFFICULTY.endSpeed);
    const s6 = at(PRACTICE.rampClears);
    expect(s6.initialAsteroids).toBe(DIFFICULTY.endAsteroids);
    expect(s6.asteroidSpeed).toBe(DIFFICULTY.endSpeed);
    const s20 = at(20);
    expect(s20.asteroidSpeed).toBe(DIFFICULTY.endSpeed);
    let prev = 0;
    for (let s = 0; s <= PRACTICE.rampClears; s++) {
      const v = at(s).asteroidSpeed;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('pace ignores mission progress (a fresh session is gentle even deep into missions)', () => {
    const deep: LearningState = { ...initialLearningState(), stageIndex: 5, levelInStage: 30, levelsCleared: 40 };
    const cfg = new LearningEngine(deep).buildPracticeLevel(['add:3'], 0);
    expect(cfg.asteroidSpeed).toBe(DIFFICULTY.startSpeed);
  });
});

describe('recordPractice', () => {
  const base = (): LearningState => ({
    stageIndex: 2,
    levelInStage: 4,
    clearedInStage: 3,
    levelsCleared: 11,
    consecutiveFailures: 1,
    factStats: {
      'mul:7:8': { attempts: 1, correct: 0, recent: [false], recentMs: [], lastSeen: 5 } satisfies FactStat,
    },
  });

  it('updates per-fact stats like a mission does', () => {
    const answers: AnswerEvent[] = [
      { factId: 'mul:7:8', correct: true, responseMs: 2500, chosenValue: 56 },
      { factId: 'mul:7:9', correct: false, responseMs: 3000, chosenValue: 64 },
    ];
    const practice = new LearningEngine(base(), Math.random, () => 1000);
    const mission = new LearningEngine(base(), Math.random, () => 1000);
    practice.recordPractice(level('cleared', answers));
    mission.recordLevel(level('cleared', answers));
    expect(practice.getState().factStats).toEqual(mission.getState().factStats);
    expect(practice.getState().factStats['mul:7:8']).toEqual({ attempts: 2, correct: 1, recent: [false, true], recentMs: [2500], lastSeen: 1000 });
  });

  it('never changes mission progression or promotes, even when the stage gate is met', () => {
    // Everything in the current stage answered perfectly and fast, many times.
    const engine = new LearningEngine({ ...initialLearningState(), clearedInStage: 5 }, Math.random, () => 1);
    const facts = engine.currentStage().facts;
    const answers: AnswerEvent[] = [];
    for (let r = 0; r < 4; r++) for (const f of facts) answers.push({ factId: f.id, correct: true, responseMs: 1000, chosenValue: f.answer });
    const before = engine.getState();
    const summary = engine.recordPractice(level('cleared', answers));
    const after = engine.getState();
    expect(summary.promoted).toBe(false);
    expect(summary.newStageName).toBeUndefined();
    expect(summary.accuracy).toBe(1);
    expect(summary.stageProgress).toBe(engine.stageProgress());
    for (const k of ['stageIndex', 'levelInStage', 'clearedInStage', 'levelsCleared', 'consecutiveFailures'] as const) {
      expect(after[k]).toBe(before[k]);
    }
  });

  it('a failed practice level leaves consecutiveFailures alone', () => {
    const engine = new LearningEngine(base());
    engine.recordPractice(level('failed', [{ factId: 'add:2:2', correct: false, responseMs: 1, chosenValue: 5 }]));
    const s = engine.getState();
    expect(s.consecutiveFailures).toBe(1);
    expect(s.levelInStage).toBe(4);
    expect(s.factStats['add:2:2'].attempts).toBe(1);
  });
});
