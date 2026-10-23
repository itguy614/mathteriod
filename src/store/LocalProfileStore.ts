import type { Profile } from '../types';
import { CATALOG } from '../catalog';
import { isSkillId } from '../learning/skills';
import { buildNewProfile, defaultSettings, freeItemIds, type ProfileStore } from './ProfileStore';

export const STORAGE_KEY = 'mathteroid:v1';
export const SCHEMA_VERSION = 2;

/** Shape of the blob stored under STORAGE_KEY. */
interface StoredData {
  version: number;
  profiles: Profile[];
}

type Migration = (data: StoredData) => StoredData;

/** Schema migrations keyed by the version they upgrade FROM. */
const MIGRATIONS: Record<number, Migration> = {
  /**
   * v1 → v2: v1 recorded every stray hit as a separate miss and timed the first answer
   * of each level from before the rocks flew in, which kept kids from being promoted
   * (a playtester reached level 74 still on addition). Drop the recent windows that
   * promotion reads so it's judged on fresh answers; lifetime attempts/correct stay.
   */
  1: (d) => ({
    ...d,
    version: 2,
    profiles: d.profiles.map((p) => {
      if (!p?.learning?.factStats) return p;
      const factStats = Object.fromEntries(
        Object.entries(p.learning.factStats).map(([id, st]) => [id, { ...st, recent: [], recentMs: [] }]),
      );
      return { ...p, learning: { ...p.learning, factStats } };
    }),
  }),
};

export function migrate(raw: unknown): StoredData {
  if (!raw || typeof raw !== 'object') return { version: SCHEMA_VERSION, profiles: [] };
  let data = raw as StoredData;
  if (typeof data.version !== 'number' || !Array.isArray(data.profiles)) {
    return { version: SCHEMA_VERSION, profiles: [] };
  }
  while (data.version < SCHEMA_VERSION) {
    const step = MIGRATIONS[data.version];
    if (!step) break;
    data = step(data);
  }
  data.profiles = data.profiles.filter((p) => p && typeof p.id === 'string').map(repairProfile);
  return data;
}

/** Fill in fields that may be missing from older / hand-edited saves. */
export function repairProfile(p: Profile): Profile {
  // The equipped body is always owned (covers the chosen starter ship).
  const owned = new Set([...(Array.isArray(p.owned) ? p.owned : []), ...freeItemIds(), ...(p.loadout?.body ? [p.loadout.body] : [])]);
  const known = new Set(CATALOG.map((i) => i.id));
  return {
    ...p,
    stardust: Number.isFinite(p.stardust) ? p.stardust : 0,
    bestScore: Number.isFinite(p.bestScore) ? p.bestScore : 0,
    owned: [...owned].filter((id) => known.has(id)),
    settings: { ...defaultSettings(), ...(p.settings ?? {}) },
    loadout: { ...p.loadout, perks: Array.isArray(p.loadout?.perks) ? p.loadout.perks : [] },
    // Keep only known skill ids, once each.
    practiceSkills: Array.isArray(p.practiceSkills) ? [...new Set(p.practiceSkills.filter(isSkillId))] : [],
  };
}

function clone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

function defaultStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__mathteroid_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/**
 * Phase 1 store: every profile lives in one JSON blob in localStorage.
 * If storage is unavailable (private mode, quota, disabled) it keeps working
 * in memory for the session.
 */
export class LocalProfileStore implements ProfileStore {
  private storage: Storage | null;
  private memory: StoredData | null = null;

  constructor(storage?: Storage | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
  }

  /** True when saves are only held in memory. */
  get isVolatile(): boolean {
    return this.storage === null;
  }

  async list(): Promise<Profile[]> {
    const data = this.read();
    return clone(data.profiles).sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(id: string): Promise<Profile | undefined> {
    const p = this.read().profiles.find((x) => x.id === id);
    return p ? clone(p) : undefined;
  }

  async create(name: string, starterBody: string): Promise<Profile> {
    const profile = buildNewProfile(name, starterBody);
    const data = this.read();
    data.profiles.push(profile);
    this.write(data);
    return clone(profile);
  }

  async save(profile: Profile): Promise<void> {
    const data = this.read();
    const idx = data.profiles.findIndex((x) => x.id === profile.id);
    const copy = clone(profile);
    if (idx >= 0) data.profiles[idx] = copy;
    else data.profiles.push(copy);
    this.write(data);
  }

  async delete(id: string): Promise<void> {
    const data = this.read();
    data.profiles = data.profiles.filter((x) => x.id !== id);
    this.write(data);
  }

  /**
   * Storage is loaded once; after that the in-memory copy is authoritative
   * (so a failed write never "loses" data for the rest of the session).
   */
  private read(): StoredData {
    if (!this.memory) {
      let data: StoredData = { version: SCHEMA_VERSION, profiles: [] };
      if (this.storage) {
        try {
          const raw = this.storage.getItem(STORAGE_KEY);
          data = migrate(raw ? JSON.parse(raw) : null);
        } catch (err) {
          console.warn('[store] read failed, starting fresh in memory', err);
          try {
            // Keep the unreadable blob around so it can be recovered by hand.
            const raw = this.storage.getItem(STORAGE_KEY);
            if (raw) this.storage.setItem(`${STORAGE_KEY}:corrupt`, raw);
          } catch {
            /* ignore */
          }
        }
      }
      this.memory = data;
    }
    return clone(this.memory);
  }

  private write(data: StoredData): void {
    data.version = SCHEMA_VERSION;
    this.memory = clone(data);
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('[store] write failed, keeping in memory only', err);
    }
  }
}
