/**
 * Badges: achievements earned in play, checked after every level (missions and
 * practice). Pure: decides what was newly earned; main.ts saves them on the
 * profile and pays BADGE_STARDUST for each.
 */
import type { LearningState, LevelResult, LevelSummary } from '../types';
import { STAGES, skillMastery, stageIndexById } from '../learning/index';

/** Stardust paid once per newly earned badge. */
export const BADGE_STARDUST = 20;

export interface BadgeContext {
  result: LevelResult;
  summary: LevelSummary;
  stageId: string;
  practice: boolean;
  /** Learning state before and after this level was recorded. */
  before: LearningState;
  after: LearningState;
}

export interface BadgeDef {
  id: string;
  icon: string;
  name: string;
  /** How to earn it, kid-facing. */
  description: string;
  /** Shelf group. */
  group: 'play' | 'journey' | 'tables';
  earned(ctx: BadgeContext): boolean;
}

const cleared = (c: BadgeContext) => c.result.outcome === 'cleared';
const correctCount = (c: BadgeContext) => c.result.answers.filter((a) => a.correct).length;
/** Passed every stage up to and including `stageId` (promoted beyond it). */
const finished = (stageId: string) => (c: BadgeContext) => c.after.stageIndex > stageIndexById(stageId);

export const BADGES: BadgeDef[] = [
  { id: 'liftoff', icon: '🚀', name: 'Lift-off', description: 'Clear your first level', group: 'play', earned: cleared },
  {
    id: 'flawless',
    icon: '💎',
    name: 'Flawless',
    description: 'Clear a level without a single wrong answer',
    group: 'play',
    earned: (c) => cleared(c) && correctCount(c) >= 5 && c.result.answers.every((a) => a.correct),
  },
  { id: 'on-fire', icon: '🔥', name: 'On fire', description: '10 right answers in a row', group: 'play', earned: (c) => (c.result.bestStreak ?? 0) >= 10 },
  { id: 'unstoppable', icon: '☄️', name: 'Unstoppable', description: '25 right answers in a row', group: 'play', earned: (c) => (c.result.bestStreak ?? 0) >= 25 },
  {
    id: 'untouchable',
    icon: '🛡️',
    name: 'Untouchable',
    description: 'Clear a 3-wave level without a scratch',
    group: 'play',
    earned: (c) => cleared(c) && (c.result.waves ?? 1) >= 3 && c.result.hullDamage === 0,
  },
  {
    id: 'lightning',
    icon: '⚡',
    name: 'Lightning',
    description: 'Clear a level answering most questions in under 2 seconds',
    group: 'play',
    earned: (c) => cleared(c) && correctCount(c) >= 8 && c.summary.medianCorrectMs !== null && c.summary.medianCorrectMs <= 2000,
  },
  {
    id: 'comeback',
    icon: '💪',
    name: 'Comeback',
    description: 'Clear a mission after two tries that didn’t work out',
    group: 'play',
    earned: (c) => !c.practice && cleared(c) && c.before.consecutiveFailures >= 2,
  },
  { id: 'ufo-hunter', icon: '🛸', name: 'UFO hunter', description: 'Shoot a UFO showing the right answer', group: 'play', earned: (c) => (c.result.ufoHits ?? 0) > 0 },
  { id: 'boss-buster', icon: '👾', name: 'Boss buster', description: 'Beat a boss', group: 'play', earned: (c) => (c.result.bossesBeaten ?? 0) > 0 },
  { id: 'practice', icon: '🎯', name: 'Practice pays', description: 'Clear a practice round', group: 'play', earned: (c) => c.practice && cleared(c) },
  { id: 'add-ace', icon: '➕', name: 'Addition ace', description: 'Finish every addition stage', group: 'journey', earned: finished('add-review') },
  { id: 'sub-ace', icon: '➖', name: 'Subtraction ace', description: 'Finish every subtraction stage', group: 'journey', earned: finished('sub-review') },
  { id: 'mul-ace', icon: '✖️', name: 'Times ace', description: 'Finish every multiplication stage', group: 'journey', earned: finished('mul-review') },
  { id: 'div-ace', icon: '➗', name: 'Division ace', description: 'Finish every division stage', group: 'journey', earned: finished('div-review') },
  {
    id: 'champion',
    icon: '🏆',
    name: 'Galactic champion',
    description: 'Beat the boss of the final stage',
    group: 'journey',
    earned: (c) => c.stageId === STAGES[STAGES.length - 1].id && (c.result.bossesBeaten ?? 0) > 0,
  },
  ...Array.from({ length: 12 }, (_, i): BadgeDef => {
    const n = i + 1;
    return {
      id: `table-${n}`,
      icon: `×${n}`,
      name: `×${n} master`,
      description: `Answer every ×${n} fact fast`,
      group: 'tables',
      earned: (c) => skillMastery(`mul:${n}`, c.after).level === 'fast',
    };
  }),
];

const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

export function badgeById(id: string): BadgeDef | undefined {
  return BY_ID.get(id);
}

/** Badges earned by this level that weren't earned before (`have`: id → earned-at ms). */
export function newBadges(ctx: BadgeContext, have: Record<string, number>): BadgeDef[] {
  return BADGES.filter((b) => !(b.id in have) && b.earned(ctx));
}
