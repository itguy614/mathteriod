import { describe, expect, it } from 'vitest';
import type { AnswerEvent, FactStat, LearningState, LevelResult } from '../types';
import { DIFFICULTY, LearningEngine, MASTERY, groupByQuestion, initialLearningState, reviewDueAt } from './engine';
import { stageIndexById } from './curriculum';
import { STAGES } from './curriculum';
import { factById } from './facts';

/** Deterministic PRNG (mulberry32). */
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

function stateAt(stageIndex: number, extra: Partial<LearningState> = {}): LearningState {
  return { ...initialLearningState(), stageIndex, ...extra };
}

function level(outcome: 'cleared' | 'failed', answers: AnswerEvent[]): LevelResult {
  return { outcome, answers, durationMs: 60000, hitsTaken: outcome === 'failed' ? 3 : 0, score: 100 };
}

/** One correct answer per stage fact, all at the given response time. */
function answerAll(stageIndex: number, responseMs: number, correct = true): AnswerEvent[] {
  return STAGES[stageIndex].facts.map((f) => ({ factId: f.id, correct, responseMs, chosenValue: f.answer }));
}

const goodStat = (): FactStat => ({
  attempts: 6,
  correct: 6,
  recentMs: [1500, 1500, 1500, 1500, 1500, 1500],
  recent: [true, true, true, true, true, true],
  lastSeen: 1,
});

describe('LearningEngine basics', () => {
  it('initial state starts at stage 0 with nothing recorded', () => {
    expect(initialLearningState()).toEqual({
      stageIndex: 0,
      levelInStage: 0,
      clearedInStage: 0,
      levelsCleared: 0,
      consecutiveFailures: 0,
      factStats: {},
    });
  });

  it('never mutates the caller state', () => {
    const input = stateAt(0, { factStats: { 'add:1:1': goodStat() } });
    const snapshot = JSON.parse(JSON.stringify(input));
    const engine = new LearningEngine(input, seeded(1));
    engine.recordLevel(level('cleared', answerAll(0, 1000)));
    engine.recordLevel(level('failed', answerAll(0, 1000, false)));
    expect(input).toEqual(snapshot);

    // getState returns a copy too.
    const s = engine.getState();
    s.factStats['add:1:1'].recent.push(false);
    s.levelInStage = 99;
    expect(engine.getState().levelInStage).not.toBe(99);
  });

  it('builds a classic level with an easy start and ramps difficulty', () => {
    const first = new LearningEngine(stateAt(0)).buildLevel();
    expect(first.waves).toEqual(['classic', 'classic', 'classic']);
    expect(first.stageId).toBe(STAGES[0].id);
    expect(first.levelNumber).toBe(1);
    expect(first.initialAsteroids).toBe(3);
    expect(first.asteroidSpeed).toBe(DIFFICULTY.startSpeed);
    expect(first.maxAsteroids).toBe(DIFFICULTY.maxAsteroids);
    expect(first.eased).toBe(false);

    const later = new LearningEngine(stateAt(0, { levelInStage: 20, levelsCleared: 20 })).buildLevel();
    expect(later.initialAsteroids).toBe(DIFFICULTY.endAsteroids);
    expect(later.asteroidSpeed).toBeGreaterThan(first.asteroidSpeed);
    // Playtesting: the ramp must stay kid-friendly even deep into a stage.
    expect(later.asteroidSpeed).toBeLessThanOrEqual(5);
    expect(later.initialAsteroids).toBeLessThanOrEqual(5);
    expect(later.levelNumber).toBe(21);
  });

  it('eases after 2 consecutive failures, and clears the flag on a clear', () => {
    const engine = new LearningEngine(stateAt(0, { levelInStage: 6 }), seeded(2));
    const normal = engine.buildLevel();
    engine.recordLevel(level('failed', []));
    expect(engine.buildLevel().eased).toBe(false);
    engine.recordLevel(level('failed', []));
    const eased = engine.buildLevel();
    expect(eased.eased).toBe(true);
    expect(eased.initialAsteroids).toBeLessThan(normal.initialAsteroids + 1);
    expect(eased.asteroidSpeed).toBeLessThan(normal.asteroidSpeed + 1);
    // The ramp advanced two levels, so compare against a same-level normal build.
    const sameLevelNormal = new LearningEngine({ ...engine.getState(), consecutiveFailures: 0 }).buildLevel();
    expect(eased.asteroidSpeed).toBeLessThan(sameLevelNormal.asteroidSpeed);
    expect(eased.initialAsteroids).toBeLessThan(sameLevelNormal.initialAsteroids);

    engine.recordLevel(level('cleared', []));
    expect(engine.getState().consecutiveFailures).toBe(0);
    expect(engine.buildLevel().eased).toBe(false);
  });

  it('eased levels bias questions toward known facts', () => {
    const stage = STAGES[1];
    const known = stage.facts.filter((f) => f.answer === 10).map((f) => f.id);
    const factStats: Record<string, FactStat> = {};
    for (const id of known) factStats[id] = goodStat();
    const engine = new LearningEngine(stateAt(1, { consecutiveFailures: 3, factStats }), seeded(3));
    const q = engine.buildLevel().questions;
    const all = [...new Set(stage.facts.map((f) => f.answer))];
    let hits = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (known.includes(q.pickQuestion(all).factId)) hits++;
    // Known facts are ~20% of the stage; eased weighting should push them well above that.
    expect(hits / N).toBeGreaterThan(known.length / stage.facts.length + 0.15);
  });

  it('records stats with capped recent windows', () => {
    const engine = new LearningEngine(stateAt(0), seeded(4), () => 12345);
    const answers: AnswerEvent[] = [];
    for (let i = 0; i < 20; i++) answers.push({ factId: 'add:2:3', correct: i % 4 !== 0, responseMs: 1000 + i, chosenValue: 5 });
    const sum = engine.recordLevel(level('cleared', answers));
    const st = engine.getState().factStats['add:2:3'];
    // W C C C W C C C ...: 15 questions (a wrong hit and its follow-up correct are one
    // question), 10 of them right on the first hit.
    expect(st.attempts).toBe(15);
    expect(st.correct).toBe(10);
    expect(st.recent.length).toBeLessThanOrEqual(8);
    expect(st.recentMs.length).toBeLessThanOrEqual(8);
    expect(st.recentMs[st.recentMs.length - 1]).toBe(1019);
    expect(st.lastSeen).toBe(12345);
    expect(sum.accuracy).toBeCloseTo(10 / 15);
    expect(sum.medianCorrectMs).not.toBeNull();
    expect(engine.getState().levelsCleared).toBe(1);
    expect(engine.getState().levelInStage).toBe(1);
  });

  it('scores each question on its first hit only (stray shots count as one miss)', () => {
    const engine = new LearningEngine(stateAt(0), seeded(5));
    const hit = (factId: string, correct: boolean, ms = 1500): AnswerEvent => ({ factId, correct, responseMs: ms, chosenValue: 0 });
    const sum = engine.recordLevel(
      level('cleared', [hit('add:2:3', true), hit('add:1:4', false), hit('add:1:4', false), hit('add:1:4', true, 5000), hit('add:3:3', true)]),
    );
    const stats = engine.getState().factStats;
    expect(stats['add:1:4']).toMatchObject({ attempts: 1, correct: 0, recent: [false], recentMs: [] });
    expect(stats['add:2:3']).toMatchObject({ attempts: 1, correct: 1, recent: [true], recentMs: [1500] });
    expect(sum.accuracy).toBeCloseTo(2 / 3);
  });

  it('groups hits into questions, including a trailing unanswered one', () => {
    const e = (factId: string, correct: boolean): AnswerEvent => ({ factId, correct, responseMs: 1, chosenValue: 0 });
    const groups = groupByQuestion([e('a', false), e('a', true), e('b', true), e('c', false)]);
    expect(groups.map((g) => g.length)).toEqual([2, 1, 1]);
  });
});

describe('QuestionProvider contract', () => {
  it('pickQuestion always returns an answer from liveValues (fuzz, every stage)', () => {
    const rng = seeded(42);
    STAGES.forEach((stage, idx) => {
      const provider = new LearningEngine(stateAt(idx), rng).buildLevel().questions;
      const answers = [...new Set(stage.facts.map((f) => f.answer))];
      for (let trial = 0; trial < 200; trial++) {
        const n = 1 + Math.floor(rng() * 8);
        const live = Array.from({ length: n }, () => answers[Math.floor(rng() * answers.length)]);
        const q = provider.pickQuestion(live);
        expect(live).toContain(q.answer);
        const f = factById(q.factId)!;
        expect(f.answer).toBe(q.answer);
        expect(q.prompt).toBe(f.text);
      }
    });
  });

  it('pickQuestion falls back for values outside the stage', () => {
    const provider = new LearningEngine(stateAt(0), seeded(5)).buildLevel().questions;
    for (const v of [1, 24, 50, 144, 13, 0, 23]) {
      const q = provider.pickQuestion([v]);
      expect(q.answer).toBe(v);
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it('avoids repeating the same fact back to back when alternatives exist', () => {
    const provider = new LearningEngine(stateAt(0), seeded(6)).buildLevel().questions;
    let prev = '';
    for (let i = 0; i < 300; i++) {
      const q = provider.pickQuestion([5, 6]);
      expect(q.factId).not.toBe(prev);
      prev = q.factId;
    }
  });

  it('initialValues returns stage answers with minimal duplicates', () => {
    STAGES.forEach((stage, idx) => {
      const provider = new LearningEngine(stateAt(idx), seeded(idx + 7)).buildLevel().questions;
      const answers = new Set(stage.facts.map((f) => f.answer));
      const vals = provider.initialValues(7);
      expect(vals).toHaveLength(7);
      for (const v of vals) expect(answers.has(v)).toBe(true);
      if (answers.size >= 7) expect(new Set(vals).size).toBeGreaterThanOrEqual(6);
    });
  });

  it('splitValue is never the answer, is a stage answer, and is usually near', () => {
    const rng = seeded(8);
    STAGES.forEach((stage, idx) => {
      const provider = new LearningEngine(stateAt(idx), rng).buildLevel().questions;
      const answers = new Set(stage.facts.map((f) => f.answer));
      for (let i = 0; i < 100; i++) {
        const q = provider.pickQuestion([...answers]);
        const v = provider.splitValue(q, [q.answer]);
        expect(v).not.toBe(q.answer);
        expect(answers.has(v)).toBe(true);
      }
    });
    const add = new LearningEngine(stateAt(2), seeded(9)).buildLevel().questions;
    const q = { factId: 'add:7:5', prompt: '7 + 5', speech: '7 plus 5', answer: 12 };
    for (let i = 0; i < 50; i++) expect(Math.abs(add.splitValue(q, [12]) - 12)).toBeLessThanOrEqual(2);
  });
});

describe('adaptive weighting', () => {
  it('favours recently missed facts', () => {
    const stage = STAGES[1];
    const factStats: Record<string, FactStat> = {};
    for (const f of stage.facts) factStats[f.id] = goodStat();
    const missed = 'add:3:4';
    factStats[missed] = { attempts: 4, correct: 1, recentMs: [5000], recent: [true, false, false, false], lastSeen: 1 };
    const provider = new LearningEngine(stateAt(1, { factStats }), seeded(10)).buildLevel().questions;
    const live = [...new Set(stage.facts.map((f) => f.answer))];
    const counts = new Map<string, number>();
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const id = provider.pickQuestion(live).factId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const uniform = N / stage.facts.length;
    expect(counts.get(missed) ?? 0).toBeGreaterThan(uniform * 2);
  });

  it('favours missed facts in a fresh level (no in-level spreading)', () => {
    const stage = STAGES[0];
    const factStats: Record<string, FactStat> = {};
    for (const f of stage.facts) factStats[f.id] = goodStat();
    const missed = 'add:2:2'; // answer 4; other answer-4 facts: 1+3, 3+1
    factStats[missed] = { attempts: 3, correct: 0, recentMs: [], recent: [false, false, false], lastSeen: 1 };
    let hits = 0;
    const N = 3000;
    const rng = seeded(11);
    for (let i = 0; i < N; i++) {
      const provider = new LearningEngine(stateAt(0, { factStats }), rng).buildLevel().questions;
      if (provider.pickQuestion([4]).factId === missed) hits++;
    }
    expect(hits / N).toBeGreaterThan(0.6); // uniform would be 1/3
  });
});

describe('promotion', () => {
  it('promotes after simulated mastery, not before', () => {
    const engine = new LearningEngine(stateAt(0), seeded(12));
    const all = answerAll(0, 2000);
    const required = Math.min(Math.ceil(all.length * MASTERY.coverage), MASTERY.maxCoverageFacts);
    // Level 1: correct and fast, but too few different facts seen.
    let s = engine.recordLevel(level('cleared', all.slice(0, required - 1)));
    expect(s.promoted).toBe(false);
    expect(s.stageProgress).toBeGreaterThan(0);
    expect(s.stageProgress).toBeLessThan(1);
    const p1 = s.stageProgress;
    // Level 2: coverage reached → gate met on a cleared level.
    s = engine.recordLevel(level('cleared', all.slice(required - 1)));
    expect(s.promoted).toBe(true);
    expect(s.newStageName).toBe(STAGES[1].name);
    expect(s.stageProgress).toBe(1);
    expect(p1).toBeLessThan(1);
    const st = engine.getState();
    expect(st.stageIndex).toBe(1);
    expect(st.levelInStage).toBe(0);
    expect(engine.currentStage().id).toBe(STAGES[1].id);
  });

  it('does not promote when answers are slow', () => {
    const engine = new LearningEngine(stateAt(0), seeded(13));
    for (let i = 0; i < 4; i++) {
      const s = engine.recordLevel(level('cleared', answerAll(0, MASTERY.fastMs + 2000)));
      expect(s.promoted).toBe(false);
    }
    expect(engine.getState().stageIndex).toBe(0);
  });

  it('does not promote when accuracy is low', () => {
    const engine = new LearningEngine(stateAt(0), seeded(14));
    for (let i = 0; i < 4; i++) {
      const answers = answerAll(0, 1500).map((a, j) => ({ ...a, correct: j % 3 !== 0 }));
      expect(engine.recordLevel(level('cleared', answers)).promoted).toBe(false);
    }
  });

  it('only promotes after enough cleared levels (failed ones do not count)', () => {
    const engine = new LearningEngine(stateAt(0), seeded(15));
    const failed = engine.recordLevel(level('failed', answerAll(0, 1500)));
    expect(failed.promoted).toBe(false);
    expect(engine.getState().clearedInStage).toBe(0);
    expect(engine.stageProgress()).toBeLessThan(1); // facts mastered, a clear still needed
    const cleared = engine.recordLevel(level('cleared', []));
    expect(cleared.promoted).toBe(true);
  });

  it('big stages need only partial coverage', () => {
    const idx = STAGES.findIndex((s) => s.id === 'add-review');
    const engine = new LearningEngine(stateAt(idx), seeded(16));
    const some = STAGES[idx].facts.slice(0, MASTERY.maxCoverageFacts);
    const answers = some.map((f) => ({ factId: f.id, correct: true, responseMs: 1500, chosenValue: f.answer }));
    expect(engine.recordLevel(level('cleared', answers)).promoted).toBe(true);
  });

  it('stays on the last stage', () => {
    const last = STAGES.length - 1;
    const factStats: Record<string, FactStat> = {};
    for (const f of STAGES[last].facts) factStats[f.id] = goodStat();
    const engine = new LearningEngine(stateAt(last, { levelInStage: 5, factStats }), seeded(17));
    const s = engine.recordLevel(level('cleared', []));
    expect(s.promoted).toBe(false);
    expect(engine.getState().stageIndex).toBe(last);
  });

  it('stageProgress grows with practice', () => {
    const engine = new LearningEngine(stateAt(2), seeded(18));
    const p0 = engine.stageProgress();
    engine.recordLevel(level('cleared', answerAll(2, 2500).slice(0, 5)));
    const p1 = engine.stageProgress();
    expect(p0).toBeGreaterThanOrEqual(0);
    expect(p1).toBeGreaterThan(p0);
    expect(p1).toBeLessThanOrEqual(1);
  });
});

describe('pace (playtest: level 74 and still on addition)', () => {
  /** Play every wave of one level as a kid who answers every question right, first try, in `ms`. */
  function playPerfectLevel(engine: LearningEngine, ms: number): void {
    const config = engine.buildLevel();
    const answers: AnswerEvent[] = [];
    for (const wave of config.waves) {
      if (wave === 'reverse') {
        const live = config.reverse!.initialFacts(config.initialAsteroids);
        while (live.length > 0) {
          const target = config.reverse!.pickTarget(live);
          for (const f of live.filter((x) => x.answer === target)) {
            live.splice(live.indexOf(f), 1);
            answers.push({ factId: f.id, correct: true, responseMs: ms, chosenValue: target });
          }
        }
        continue;
      }
      const live = config.questions.initialValues(config.initialAsteroids);
      while (live.length > 0) {
        const q = config.questions.pickQuestion(live);
        live.splice(live.indexOf(q.answer), 1);
        answers.push({ factId: q.factId, correct: true, responseMs: ms, chosenValue: q.answer });
      }
    }
    engine.recordLevel(level('cleared', answers));
  }

  it('a kid who knows addition reaches subtraction in about 6-8 three-wave levels', () => {
    const firstSub = STAGES.findIndex((s) => s.op === 'sub');
    for (const seed of [1, 2, 3, 4, 5]) {
      const engine = new LearningEngine(initialLearningState(), seeded(seed));
      let levels = 0;
      while (engine.getState().stageIndex < firstSub && levels < 100) {
        playPerfectLevel(engine, 2000);
        levels++;
      }
      expect(levels).toBeGreaterThanOrEqual(5);
      expect(levels).toBeLessThanOrEqual(10);
    }
  });

  it('slow answers keep a kid in the stage', () => {
    const engine = new LearningEngine(initialLearningState(), seeded(9));
    for (let i = 0; i < 15; i++) playPerfectLevel(engine, MASTERY.fastMs + 2000);
    expect(engine.getState().stageIndex).toBe(0);
  });
});

describe('spaced review', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 100 * DAY;
  const stat = (recent: boolean[], lastSeen: number, ms = 1500): FactStat => ({
    attempts: recent.length,
    correct: recent.filter(Boolean).length,
    recentMs: recent.filter(Boolean).map(() => ms),
    recent,
    lastSeen,
  });

  it('review gaps grow with the run of correct first tries', () => {
    expect(reviewDueAt(stat([false, true], 0))).toBe(1 * DAY); // run 1
    expect(reviewDueAt(stat([true, true, true], 0))).toBe(7 * DAY); // run 3
    expect(reviewDueAt(stat([true, true, true, true, true, true, true], 0))).toBe(30 * DAY); // capped
    expect(reviewDueAt(stat([true, true, false], 5 * DAY))).toBe(5 * DAY); // just missed: due now
  });

  it('slow facts stay on the shortest gap', () => {
    expect(reviewDueAt(stat([true, true, true, true], 0, 9000))).toBe(1 * DAY);
  });

  const mulStage = stageIndexById('mul-easy');
  const add85 = 'add:8:5'; // answer 13: never a product of 1–12 operands

  it('only overdue facts from earlier stages are due', () => {
    const state = stateAt(mulStage, {
      factStats: {
        [add85]: stat([true, true, true], NOW - 8 * DAY), // 7-day gap, overdue
        'add:2:3': stat([true, true, true], NOW - 2 * DAY), // not due yet
        'mul:2:5': stat([false], 0), // current stage: never "review"
      },
    });
    const ids = new LearningEngine(state, seeded(1), () => NOW).dueReviewFacts().map((f) => f.id);
    expect(ids).toEqual([add85]);
  });

  it('due review facts are mixed into mission levels', () => {
    const due = stateAt(mulStage, { factStats: { [add85]: stat([true, true, true], NOW - 8 * DAY) } });
    const cfg = new LearningEngine(due, seeded(2), () => NOW).buildLevel();
    const vals = cfg.questions.initialValues(400);
    const share = vals.filter((v) => v === 13).length / vals.length;
    expect(share).toBeGreaterThan(0.02);
    expect(cfg.questions.pickQuestion([13]).factId).toBe(add85);

    const notDue = stateAt(mulStage, { factStats: { [add85]: stat([true, true, true], NOW - 1 * DAY) } });
    const plain = new LearningEngine(notDue, seeded(2), () => NOW).buildLevel();
    expect(plain.questions.initialValues(400)).not.toContain(13);
  });

  it('practice levels never mix in review', () => {
    const due = stateAt(mulStage, { factStats: { [add85]: stat([true, true, true], NOW - 8 * DAY) } });
    const cfg = new LearningEngine(due, seeded(3), () => NOW).buildPracticeLevel(['mul:7'], 0);
    expect(cfg.questions.initialValues(200)).not.toContain(13);
  });
});

describe('reverse mode', () => {
  const mulStage = stageIndexById('mul-easy');

  it('every 2nd mission level has a Reverse middle wave; eased levels and practice never do', () => {
    const middle = [0, 1, 2, 3].map((levelInStage) => new LearningEngine(stateAt(mulStage, { levelInStage }), seeded(1)).buildLevel().waves);
    expect(middle).toEqual([
      ['classic', 'classic', 'classic'],
      ['classic', 'reverse', 'classic'],
      ['classic', 'classic', 'classic'],
      ['classic', 'reverse', 'classic'],
    ]);
    const withRev = new LearningEngine(stateAt(mulStage, { levelInStage: 1 }), seeded(1)).buildLevel();
    expect(withRev.reverse).toBeDefined();
    const eased = new LearningEngine(stateAt(mulStage, { levelInStage: 1, consecutiveFailures: DIFFICULTY.easeAfterFailures }), seeded(1)).buildLevel();
    expect(eased.waves).toEqual(['classic', 'classic']);
    expect(new LearningEngine(stateAt(mulStage, { levelInStage: 1 }), seeded(1)).buildPracticeLevel(['mul:7'], 3).waves).toEqual(['classic']);
  });

  it('opening field pairs equations that share an answer', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const cfg = new LearningEngine(stateAt(mulStage, { levelInStage: 1 }), seeded(seed)).buildLevel();
      const facts = cfg.reverse!.initialFacts(5);
      expect(facts).toHaveLength(5);
      expect(new Set(facts.map((f) => f.id)).size).toBe(5);
      const counts = new Map<number, number>();
      for (const f of facts) counts.set(f.answer, (counts.get(f.answer) ?? 0) + 1);
      expect([...counts.values()].filter((c) => c >= 2).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('targets are always a live answer; split equations are distractors', () => {
    const cfg = new LearningEngine(stateAt(stageIndexById('add-small'), { levelInStage: 1 }), seeded(7)).buildLevel();
    const rev = cfg.reverse!;
    for (let i = 0; i < 50; i++) {
      const live = rev.initialFacts(4);
      const target = rev.pickTarget(live);
      expect(live.map((f) => f.answer)).toContain(target);
      const split = rev.splitFact(target, live);
      expect(split.answer).not.toBe(target);
      expect(live.map((f) => f.id)).not.toContain(split.id);
    }
  });
});
