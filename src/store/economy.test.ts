import { describe, expect, it } from 'vitest';
import type { AnswerEvent, LevelResult, LevelSummary, Profile } from '../types';
import { defaultLoadout } from '../catalog';
import {
  CLEAR_BONUS,
  PRACTICE_MULTIPLIER,
  PROMOTION_BONUS,
  equip,
  isEquipped,
  purchase,
  stardustForLevel,
  stardustForPractice,
  starsForAccuracy,
} from './economy';

function answers(correct: number, wrong: number, ms = 5000): AnswerEvent[] {
  const out: AnswerEvent[] = [];
  for (let i = 0; i < correct; i++) out.push({ factId: `add:${i}:1`, correct: true, responseMs: ms, chosenValue: i + 1 });
  for (let i = 0; i < wrong; i++) out.push({ factId: `add:${i}:2`, correct: false, responseMs: ms, chosenValue: 0 });
  return out;
}

function result(outcome: 'cleared' | 'failed', a: AnswerEvent[]): LevelResult {
  return { outcome, answers: a, durationMs: 60000, hitsTaken: outcome === 'failed' ? 3 : 0, score: 1000 };
}

function summary(accuracy: number, promoted = false): LevelSummary {
  return { accuracy, medianCorrectMs: 2000, promoted, stageProgress: 0.5 };
}

function profile(stardust: number): Profile {
  return {
    id: 'p',
    name: 'Test',
    avatar: '🚀',
    createdAt: 0,
    learning: { stageIndex: 0, levelInStage: 0, clearedInStage: 0, levelsCleared: 0, consecutiveFailures: 0, factStats: {} },
    stardust,
    owned: ['arrow', 'saucer', 'stingray', 'cyan', 'pulse', 'ion'],
    loadout: defaultLoadout('arrow'),
    bestScore: 0,
    settings: { musicVolume: 0.5, sfxVolume: 0.8, readAloud: false, controlMode: 'direct', touchMode: 'tapdrag' },
  };
}

describe('stardustForLevel', () => {
  it('pays per correct answer plus clear bonus', () => {
    // 8 correct (slow) = 80, clear 25, accuracy 0.8 -> no accuracy bonus
    expect(stardustForLevel(result('cleared', answers(8, 2)), summary(0.8))).toBe(80 + CLEAR_BONUS);
  });

  it('adds a speed bonus for fast answers', () => {
    const slow = stardustForLevel(result('cleared', answers(5, 0, 5000)), summary(0.8));
    const fast = stardustForLevel(result('cleared', answers(5, 0, 1500)), summary(0.8));
    expect(fast).toBeGreaterThan(slow);
  });

  it('adds a promotion bonus', () => {
    const base = stardustForLevel(result('cleared', answers(10, 0)), summary(1));
    const promoted = stardustForLevel(result('cleared', answers(10, 0)), summary(1, true));
    expect(promoted - base).toBe(PROMOTION_BONUS);
  });

  it('still rewards effort on failed levels, but less', () => {
    const failed = stardustForLevel(result('failed', answers(6, 4)), summary(0.6));
    const cleared = stardustForLevel(result('cleared', answers(6, 4)), summary(0.6));
    expect(failed).toBeGreaterThan(0);
    expect(failed).toBeLessThan(cleared);
  });

  it('pays nothing for a failed level with no correct answers', () => {
    expect(stardustForLevel(result('failed', answers(0, 3)), summary(0))).toBe(0);
  });
});

describe('stardustForPractice', () => {
  it('pays about 75% of the mission rate', () => {
    expect(PRACTICE_MULTIPLIER).toBe(0.75);
    // Mission: 8 slow correct = 80 + clear 25 = 105. Practice: 60 + 19 = 79.
    const r = result('cleared', answers(8, 2));
    expect(stardustForLevel(r, summary(0.8))).toBe(105);
    expect(stardustForPractice(r, summary(0.8))).toBe(79);
    for (const [c, w, ms, outcome] of [
      [10, 0, 1500, 'cleared'],
      [6, 4, 5000, 'cleared'],
      [6, 4, 2000, 'failed'],
    ] as const) {
      const rr = result(outcome, answers(c, w, ms));
      const mission = stardustForLevel(rr, summary(c / (c + w)));
      const practice = stardustForPractice(rr, summary(c / (c + w)));
      expect(practice).toBeLessThan(mission);
      expect(practice / mission).toBeCloseTo(0.75, 1);
    }
  });

  it('still pays a little for effort and nothing for no correct answers', () => {
    expect(stardustForPractice(result('failed', answers(1, 5)), summary(0.17))).toBe(5);
    expect(stardustForPractice(result('failed', answers(0, 3)), summary(0))).toBe(0);
  });
});

describe('starsForAccuracy', () => {
  it('maps accuracy to 1-3 stars', () => {
    expect(starsForAccuracy(1)).toBe(3);
    expect(starsForAccuracy(0.75)).toBe(2);
    expect(starsForAccuracy(0.3)).toBe(1);
    expect(starsForAccuracy(1, false)).toBe(0);
  });
});

describe('purchase', () => {
  it('buys an affordable item without mutating the input', () => {
    const p = profile(150);
    const r = purchase(p, 'magenta');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.stardust).toBe(50);
      expect(r.profile.owned).toContain('magenta');
    }
    expect(p.stardust).toBe(150);
    expect(p.owned).not.toContain('magenta');
  });

  it('refuses when too poor, reporting how much more is needed', () => {
    expect(purchase(profile(40), 'magenta')).toEqual({ ok: false, reason: 'poor', need: 60 });
  });

  it('refuses owned and unknown items', () => {
    expect(purchase(profile(1000), 'cyan')).toMatchObject({ ok: false, reason: 'owned' });
    expect(purchase(profile(1000), 'nope')).toMatchObject({ ok: false, reason: 'unknown' });
  });
});

describe('equip', () => {
  it('equips bodies, trails and laser styles', () => {
    let p = profile(0);
    p = equip(p, 'saucer')!;
    expect(p.loadout.body).toBe('saucer');
    expect(isEquipped(p, 'saucer')).toBe(true);
  });

  it('equips colors into the hull or laser slot', () => {
    let p = { ...profile(0), owned: [...profile(0).owned, 'gold'] };
    p = equip(p, 'gold', 'laser')!;
    expect(p.loadout.laserColor).toBe('gold');
    expect(p.loadout.color).toBe('cyan');
    p = equip(p, 'gold', 'hull')!;
    expect(p.loadout.color).toBe('gold');
    expect(isEquipped(p, 'gold', 'hull')).toBe(true);
  });

  it('toggles perks', () => {
    let p = { ...profile(0), owned: [...profile(0).owned, 'shield'] };
    p = equip(p, 'shield')!;
    expect(p.loadout.perks).toEqual(['shield']);
    p = equip(p, 'shield')!;
    expect(p.loadout.perks).toEqual([]);
  });

  it('refuses items that are not owned', () => {
    expect(equip(profile(0), 'titan')).toBeNull();
  });
});
