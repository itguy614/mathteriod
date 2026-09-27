import { describe, expect, it, vi } from 'vitest';

vi.mock('../learning/index', () => ({
  initialLearningState: () => ({
    stageIndex: 0,
    levelInStage: 0, clearedInStage: 0,
    levelsCleared: 0,
    consecutiveFailures: 0,
    factStats: {},
  }),
}));

import { LocalProfileStore, STORAGE_KEY } from './LocalProfileStore';
import { MemoryStorage } from './test-helpers';

describe('LocalProfileStore', () => {
  it('creates a profile with defaults and persists it', async () => {
    const storage = new MemoryStorage();
    const store = new LocalProfileStore(storage);
    const p = await store.create('  Zoe  ', '🦊', 'saucer');
    expect(p.name).toBe('Zoe');
    expect(p.stardust).toBe(0);
    expect(p.loadout.body).toBe('saucer');
    expect(p.owned).toEqual(expect.arrayContaining(['arrow', 'saucer', 'stingray', 'cyan', 'pulse', 'ion']));
    expect(p.owned).not.toContain('gold');
    expect(p.settings).toEqual({ musicVolume: 0.5, sfxVolume: 0.8, readAloud: false });

    const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(raw.version).toBe(1);
    expect(raw.profiles).toHaveLength(1);

    const again = new LocalProfileStore(storage);
    expect((await again.list()).map((x) => x.id)).toEqual([p.id]);
  });

  it('saves, gets and deletes', async () => {
    const store = new LocalProfileStore(new MemoryStorage());
    const p = await store.create('Max', '🚀', 'arrow');
    p.stardust = 250;
    await store.save(p);
    expect((await store.get(p.id))?.stardust).toBe(250);
    await store.delete(p.id);
    expect(await store.get(p.id)).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('returns copies, not live references', async () => {
    const store = new LocalProfileStore(new MemoryStorage());
    const p = await store.create('Ada', '🐱', 'arrow');
    p.stardust = 999;
    expect((await store.get(p.id))?.stardust).toBe(0);
  });

  it('survives corrupt data', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const store = new LocalProfileStore(storage);
    expect(await store.list()).toEqual([]);
    await store.create('Kid', '🐸', 'arrow');
    expect(await store.list()).toHaveLength(1);
  });

  it('falls back to memory when storage is unavailable or throws', async () => {
    const volatile = new LocalProfileStore(null);
    expect(volatile.isVolatile).toBe(true);
    await volatile.create('Mem', '🐼', 'arrow');
    expect(await volatile.list()).toHaveLength(1);

    const storage = new MemoryStorage();
    storage.failWrites = true;
    const flaky = new LocalProfileStore(storage);
    const p = await flaky.create('Flaky', '🦖', 'arrow');
    expect(await flaky.get(p.id)).toBeDefined();
  });

  it('repairs missing fields on load', async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        profiles: [{ id: 'x', name: 'Old', avatar: '🐙', createdAt: 1, loadout: { body: 'arrow' }, owned: ['bogus'] }],
      }),
    );
    const p = (await new LocalProfileStore(storage).get('x'))!;
    expect(p.stardust).toBe(0);
    expect(p.settings.sfxVolume).toBe(0.8);
    expect(p.owned).not.toContain('bogus');
    expect(p.owned).toContain('cyan');
    expect(p.loadout.perks).toEqual([]);
  });
});
