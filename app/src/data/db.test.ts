import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Progress, type Settings } from '../types';
import { ImportError, Store } from './db';

let n = 0;
const open = () => Store.open(`test-${++n}`);
const prog = (profileId: string, cardId: string, box: number): Progress =>
  ({ profileId, cardId, box, nextDue: '2026-10-06', lastSeen: '2026-10-05', starred: false });

describe('Store', () => {
  it('adds and lists profiles in creation order', async () => {
    const db = await open();
    const a = await db.addProfile('  Вадим ');
    const b = await db.addProfile('Аня');
    expect(a.name).toBe('Вадим');
    expect((await db.listProfiles()).map(p => p.id)).toEqual([a.id, b.id]);
    await expect(db.addProfile('   ')).rejects.toThrow();
  });

  it('settings default and save', async () => {
    const db = await open();
    const p = await db.addProfile('A');
    expect(await db.getSettings(p.id)).toEqual(DEFAULT_SETTINGS);
    const s = { ...DEFAULT_SETTINGS, pauseSec: 8 as const };
    await db.saveSettings(p.id, s);
    expect(await db.getSettings(p.id)).toEqual(s);
  });

  it('progress is per profile', async () => {
    const db = await open();
    const a = await db.addProfile('A');
    const b = await db.addProfile('B');
    await db.putProgress(prog(a.id, 'c1', 2));
    await db.putProgress(prog(b.id, 'c1', 4));
    await db.putProgress(prog(a.id, 'c1', 3));
    const map = await db.getProgressMap(a.id);
    expect(map.size).toBe(1);
    expect(map.get('c1')?.box).toBe(3);
  });

  it('deleteProfile removes settings and progress', async () => {
    const db = await open();
    const a = await db.addProfile('A');
    await db.saveSettings(a.id, { ...DEFAULT_SETTINGS, loop: true });
    await db.putProgress(prog(a.id, 'c1', 2));
    await db.deleteProfile(a.id);
    expect(await db.listProfiles()).toEqual([]);
    expect((await db.getProgressMap(a.id)).size).toBe(0);
    expect(await db.getSettings(a.id)).toEqual(DEFAULT_SETTINGS);
  });

  it('export then import into a fresh database restores everything', async () => {
    const src = await open();
    const a = await src.addProfile('A');
    await src.saveSettings(a.id, { ...DEFAULT_SETTINGS, rate: 1.2 });
    await src.putProgress(prog(a.id, 'c1', 5));
    const json = await src.exportProfile(a.id);

    const dst = await open();
    const imported = await dst.importProfile(json);
    expect(imported).toEqual(a);
    expect((await dst.getSettings(a.id)).rate).toBe(1.2);
    expect((await dst.getProgressMap(a.id)).get('c1')?.box).toBe(5);
  });

  it('import replaces progress of an existing profile', async () => {
    const db = await open();
    const a = await db.addProfile('A');
    await db.putProgress(prog(a.id, 'c1', 1));
    const json = await db.exportProfile(a.id);
    await db.putProgress(prog(a.id, 'c2', 3));
    await db.importProfile(json);
    expect([...(await db.getProgressMap(a.id)).keys()]).toEqual(['c1']);
  });

  it('rejects broken import without changes', async () => {
    const db = await open();
    await expect(db.importProfile('not json')).rejects.toBeInstanceOf(ImportError);
    await expect(db.importProfile('{"app":"other","version":1}')).rejects.toBeInstanceOf(ImportError);
    const bad = JSON.stringify({ app: 'word-cards', version: 1,
      profile: { id: 'x', name: 'X', createdAt: '2026-01-01' }, settings: DEFAULT_SETTINGS,
      progress: [{ profileId: 'x', cardId: 'c', box: 9 }] });
    await expect(db.importProfile(bad)).rejects.toBeInstanceOf(ImportError);
    expect(await db.listProfiles()).toEqual([]);
  });

  describe('import validation', () => {
    const file = (over: Record<string, unknown>) => JSON.stringify({
      app: 'word-cards', version: 1,
      profile: { id: 'x', name: 'X', createdAt: '2026-01-01' },
      settings: DEFAULT_SETTINGS, progress: [], ...over,
    });

    it('bad import over an existing profile leaves its data unchanged', async () => {
      const db = await open();
      const a = await db.addProfile('A');
      const s = { ...DEFAULT_SETTINGS, rate: 1.2 as const };
      await db.saveSettings(a.id, s);
      await db.putProgress(prog(a.id, 'c1', 2));
      const bad = file({ profile: a, settings: { ...DEFAULT_SETTINGS, pauseSec: 99 },
        progress: [prog(a.id, 'c9', 1)] });
      await expect(db.importProfile(bad)).rejects.toBeInstanceOf(ImportError);
      expect(await db.getSettings(a.id)).toEqual(s);
      expect([...(await db.getProgressMap(a.id)).keys()]).toEqual(['c1']);
    });

    it('rejects an invalid settings value', async () => {
      const db = await open();
      await expect(db.importProfile(file({ settings: { ...DEFAULT_SETTINGS, direction: 'xx' } })))
        .rejects.toBeInstanceOf(ImportError);
    });

    it('rejects array settings', async () => {
      const db = await open();
      await expect(db.importProfile(file({ settings: [] }))).rejects.toBeInstanceOf(ImportError);
    });

    it('partial settings are filled with defaults', async () => {
      const db = await open();
      await db.importProfile(file({ settings: { rate: 0.8 } }));
      expect(await db.getSettings('x')).toEqual({ ...DEFAULT_SETTINGS, rate: 0.8 });
    });

    it('rejects a progress row without nextDue', async () => {
      const db = await open();
      const row = { cardId: 'c', box: 1, lastSeen: null, starred: false };
      await expect(db.importProfile(file({ progress: [row] }))).rejects.toBeInstanceOf(ImportError);
    });

    it('rejects bad progress dates and empty profile fields', async () => {
      const db = await open();
      const row = { cardId: 'c', box: 1, nextDue: 'tomorrow', lastSeen: null, starred: false };
      await expect(db.importProfile(file({ progress: [row] }))).rejects.toBeInstanceOf(ImportError);
      await expect(db.importProfile(file({ profile: { id: '', name: 'X', createdAt: 'z' } })))
        .rejects.toBeInstanceOf(ImportError);
      await expect(db.importProfile(file({ profile: { id: 'x', name: '', createdAt: 'z' } })))
        .rejects.toBeInstanceOf(ImportError);
    });
  });

  it('getSettings falls back per field for stored invalid values', async () => {
    const db = await open();
    const a = await db.addProfile('A');
    await db.saveSettings(a.id, { ...DEFAULT_SETTINGS, rate: 1.2, pauseSec: 42 } as unknown as Settings);
    expect(await db.getSettings(a.id)).toEqual({ ...DEFAULT_SETTINGS, rate: 1.2 });
  });
});
