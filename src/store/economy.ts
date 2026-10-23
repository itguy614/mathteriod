import type { LevelResult, LevelSummary, Profile } from '../types';
import { getItem, type CatalogItem } from '../catalog';

export const STARDUST_PER_CORRECT = 10;
/** Extra stardust for a correct answer given faster than FAST_MS. */
export const SPEED_BONUS = 5;
export const FAST_MS = 3000;
export const CLEAR_BONUS = 25;
export const PROMOTION_BONUS = 100;
/** Extra stardust per bonus UFO shot while it showed the right answer. */
export const UFO_BONUS = 15;
/** Extra stardust per boss beaten. */
export const BOSS_BONUS = 50;
/** Accuracy at or above this on a cleared level earns the accuracy bonus. */
export const ACCURACY_BONUS_THRESHOLD = 0.9;
export const ACCURACY_BONUS = 15;
/** Failed levels still pay for correct answers, at this fraction (effort is rewarded). */
export const FAILED_MULTIPLIER = 0.6;
/** Practice pays this fraction of the mission rate (players pick their own difficulty). */
export const PRACTICE_MULTIPLIER = 0.75;

export interface StardustBreakdown {
  correct: number;
  speed: number;
  clear: number;
  accuracy: number;
  promotion: number;
  /** UFO and boss bonuses. */
  ufo: number;
  total: number;
}

/**
 * Detailed stardust earnings for a finished level. `rate` scales every part
 * (1 for missions, PRACTICE_MULTIPLIER for practice).
 */
export function stardustBreakdown(result: LevelResult, summary: LevelSummary, rate = 1): StardustBreakdown {
  const correctAnswers = result.answers.filter((a) => a.correct);
  const cleared = result.outcome === 'cleared';
  let correct = correctAnswers.length * STARDUST_PER_CORRECT;
  let speed = correctAnswers.filter((a) => a.responseMs > 0 && a.responseMs < FAST_MS).length * SPEED_BONUS;
  if (!cleared) {
    correct = Math.round(correct * FAILED_MULTIPLIER);
    speed = Math.round(speed * FAILED_MULTIPLIER);
  }
  let clear = cleared ? CLEAR_BONUS : 0;
  let accuracy = cleared && summary.accuracy >= ACCURACY_BONUS_THRESHOLD ? ACCURACY_BONUS : 0;
  const promotion = summary.promoted ? PROMOTION_BONUS : 0;
  if (rate !== 1) {
    correct = Math.round(correct * rate);
    speed = Math.round(speed * rate);
    clear = Math.round(clear * rate);
    accuracy = Math.round(accuracy * rate);
  }
  const promo = Math.round(promotion * rate);
  const ufo = Math.round(((result.ufoHits ?? 0) * UFO_BONUS + (result.bossesBeaten ?? 0) * BOSS_BONUS) * rate);
  // A failed level with at least one right answer always earns something.
  const total = Math.max(correct + speed + clear + accuracy + promo + ufo, correctAnswers.length > 0 ? 5 : 0);
  return { correct, speed, clear, accuracy, promotion: promo, ufo, total };
}

export function stardustForLevel(result: LevelResult, summary: LevelSummary): number {
  return stardustBreakdown(result, summary).total;
}

/** Stardust for a practice level: about PRACTICE_MULTIPLIER of the mission rate. */
export function stardustForPractice(result: LevelResult, summary: LevelSummary): number {
  return stardustBreakdown(result, summary, PRACTICE_MULTIPLIER).total;
}

/** 1-3 stars for a cleared level, based on accuracy. 0 when failed. */
export function starsForAccuracy(accuracy: number, cleared = true): number {
  if (!cleared) return 0;
  if (accuracy >= 0.9) return 3;
  if (accuracy >= 0.7) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

export type PurchaseResult =
  | { ok: true; profile: Profile; item: CatalogItem }
  | { ok: false; reason: 'unknown' | 'owned' | 'poor'; need?: number };

export function isOwned(profile: Profile, itemId: string): boolean {
  return profile.owned.includes(itemId);
}

/** Buy an item. Returns a NEW profile on success; the input is not mutated. */
export function purchase(profile: Profile, itemId: string): PurchaseResult {
  const item = getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown' };
  if (isOwned(profile, itemId)) return { ok: false, reason: 'owned' };
  if (profile.stardust < item.price) return { ok: false, reason: 'poor', need: item.price - profile.stardust };
  return {
    ok: true,
    item,
    profile: { ...profile, stardust: profile.stardust - item.price, owned: [...profile.owned, itemId] },
  };
}

/** Where to equip a color item. */
export type ColorSlot = 'hull' | 'laser';

/**
 * Equip an owned item. Colors go to the hull (default) or laser slot; perks
 * toggle in/out of `loadout.perks`. Returns a NEW profile, or null if the
 * item is unknown / not owned.
 */
export function equip(profile: Profile, itemId: string, slot: ColorSlot = 'hull'): Profile | null {
  const item = getItem(itemId);
  if (!item || !isOwned(profile, itemId)) return null;
  const loadout = { ...profile.loadout, perks: [...profile.loadout.perks] };
  switch (item.kind) {
    case 'body':
      loadout.body = itemId;
      break;
    case 'color':
      if (slot === 'laser') loadout.laserColor = itemId;
      else loadout.color = itemId;
      break;
    case 'laser':
      loadout.laser = itemId;
      break;
    case 'trail':
      loadout.trail = itemId;
      break;
    case 'perk':
      loadout.perks = loadout.perks.includes(itemId)
        ? loadout.perks.filter((p) => p !== itemId)
        : [...loadout.perks, itemId];
      break;
  }
  return { ...profile, loadout };
}

/** Is this item currently equipped (in any slot)? */
export function isEquipped(profile: Profile, itemId: string, slot?: ColorSlot): boolean {
  const l = profile.loadout;
  const item = getItem(itemId);
  if (!item) return false;
  switch (item.kind) {
    case 'body':
      return l.body === itemId;
    case 'color':
      if (slot === 'hull') return l.color === itemId;
      if (slot === 'laser') return l.laserColor === itemId;
      return l.color === itemId || l.laserColor === itemId;
    case 'laser':
      return l.laser === itemId;
    case 'trail':
      return l.trail === itemId;
    case 'perk':
      return l.perks.includes(itemId);
  }
}
