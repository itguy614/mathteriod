import { describe, expect, it } from 'vitest';
import type { AnswerEvent, FactStat, LearningState, LevelResult } from '../types';
import { initialLearningState, stageIndexById, STAGES } from '../learning/index';
import { BADGES, newBadges, type BadgeContext } from './badges';

function answers(correct: number, wrong = 0, ms = 1500): AnswerEvent[] {
  const out: AnswerEvent[] = [];
  for (let i = 0; i < correct; i++) out.push({ factId: `add:${i + 1}:1`, correct: true, responseMs: ms, chosenValue: i + 2 });
  for (let i = 0; i < wrong; i++) out.push({ factId: `add:${i + 1}:2`, correct: false, responseMs: ms, chosenValue: 0 });
  return out;
}

function ctx(over: Partial<LevelResult> = {}, extra: Partial<BadgeContext> = {}): BadgeContext {
  const result: LevelResult = { outcome: 'cleared', answers: answers(10), durationMs: 60000, hitsTaken: 0, score: 1000, ...over };
  const s = initialLearningState();
  return {
    result,
    summary: { accuracy: 1, medianCorrectMs: 1500, promoted: false, stageProgress: 0.5 },
    stageId: STAGES[0].id,
    practice: false,
    before: s,
    after: s,
    ...extra,
  };
}

const ids = (c: BadgeContext, have: Record<string, number> = {}) => newBadges(c, have).map((b) => b.id);

describe('badges', () => {
  it('ids are unique', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });

  it('a clean, fast, 3-wave clear earns the play badges it qualifies for', () => {
    const got = ids(ctx({ bestStreak: 10, hullDamage: 0, waves: 3 }));
    expect(got).toEqual(expect.arrayContaining(['liftoff', 'flawless', 'on-fire', 'untouchable', 'lightning']));
    expect(got).not.toContain('unstoppable');
    expect(got).not.toContain('comeback');
  });

  it('never re-awards a badge already earned', () => {
    expect(ids(ctx(), { liftoff: 1 })).not.toContain('liftoff');
  });

  it('failed levels earn no clear badges, but streaks still count', () => {
    const got = ids(ctx({ outcome: 'failed', bestStreak: 12, hullDamage: 9, waves: 3 }));
    expect(got).toEqual(['on-fire']);
  });

  it('wrong answers, damage or slow answers block flawless, untouchable and lightning', () => {
    const got = ids(
      ctx({ answers: answers(10, 1), hullDamage: 1, waves: 3 }, { summary: { accuracy: 0.9, medianCorrectMs: 3500, promoted: false, stageProgress: 0.5 } }),
    );
    expect(got).not.toContain('flawless');
    expect(got).not.toContain('untouchable');
    expect(got).not.toContain('lightning');
  });

  it('comeback needs two failures before a mission clear', () => {
    const before: LearningState = { ...initialLearningState(), consecutiveFailures: 2 };
    expect(ids(ctx({}, { before }))).toContain('comeback');
    expect(ids(ctx({}, { before, practice: true }))).not.toContain('comeback');
  });

  it('UFO, boss and practice badges', () => {
    expect(ids(ctx({ ufoHits: 1 }))).toContain('ufo-hunter');
    expect(ids(ctx({ bossesBeaten: 1 }))).toContain('boss-buster');
    expect(ids(ctx({}, { practice: true, stageId: 'practice' }))).toContain('practice');
  });

  it('journey badges come from passing an operation’s review stage', () => {
    const after: LearningState = { ...initialLearningState(), stageIndex: stageIndexById('add-review') + 1 };
    expect(ids(ctx({}, { after }))).toContain('add-ace');
    expect(ids(ctx())).not.toContain('add-ace');
    const last = STAGES[STAGES.length - 1].id;
    expect(ids(ctx({ bossesBeaten: 1 }, { stageId: last }))).toContain('champion');
  });

  it('times-table badges need every fact in the family fast', () => {
    const fast: FactStat = { attempts: 4, correct: 4, recentMs: [1500, 1500, 1500, 1500], recent: [true, true, true, true], lastSeen: 1 };
    const factStats: Record<string, FactStat> = {};
    for (let n = 1; n <= 12; n++) {
      factStats[`mul:7:${n}`] = fast;
      factStats[`mul:${n}:7`] = fast;
    }
    const after: LearningState = { ...initialLearningState(), factStats };
    expect(ids(ctx({}, { after }))).toContain('table-7');
    expect(ids(ctx({}, { after }))).not.toContain('table-6');
  });
});
