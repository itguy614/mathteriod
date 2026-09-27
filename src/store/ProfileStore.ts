import type { Profile, Settings } from '../types';
import { CATALOG, defaultLoadout } from '../catalog';
import { initialLearningState } from '../learning/index';

/**
 * Persistence contract for pilot profiles. Async on purpose so the Phase 2
 * HTTP-backed store can be a drop-in replacement for the localStorage one.
 */
export interface ProfileStore {
  list(): Promise<Profile[]>;
  get(id: string): Promise<Profile | undefined>;
  create(name: string, avatar: string, starterBody: string): Promise<Profile>;
  save(profile: Profile): Promise<void>;
  delete(id: string): Promise<void>;
}

export function defaultSettings(): Settings {
  return { musicVolume: 0.5, sfxVolume: 0.8, readAloud: false };
}

/** Every catalog item that costs nothing is owned from the start. */
export function freeItemIds(): string[] {
  return CATALOG.filter((i) => i.price === 0).map((i) => i.id);
}

export function newProfileId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Build a brand-new profile (not yet persisted). */
export function buildNewProfile(name: string, avatar: string, starterBody: string): Profile {
  return {
    id: newProfileId(),
    name: name.trim().slice(0, 16) || 'Pilot',
    avatar,
    createdAt: Date.now(),
    learning: initialLearningState(),
    stardust: 0,
    owned: freeItemIds(),
    loadout: defaultLoadout(starterBody),
    bestScore: 0,
    settings: defaultSettings(),
  };
}

/**
 * "Start over": fresh learning state, stardust, items and best score.
 * Keeps identity (id, name, avatar, createdAt), settings and the base ship.
 */
export function resetProfileProgress(profile: Profile): Profile {
  const starterBody = CATALOG.find((i) => i.id === profile.loadout.body && i.starter) ? profile.loadout.body : 'arrow';
  const fresh = buildNewProfile(profile.name, profile.avatar, starterBody);
  return { ...fresh, id: profile.id, name: profile.name, createdAt: profile.createdAt, settings: { ...profile.settings } };
}
