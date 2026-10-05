import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Progress } from '../types';
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
});
