import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProgressMap } from '../domain/selection';
import { DEFAULT_SETTINGS, type Profile, type Progress, type Settings } from '../types';

interface CardsDB extends DBSchema {
  profiles: { key: string; value: Profile };
  settings: { key: string; value: { profileId: string; settings: Settings } };
  progress: { key: [string, string]; value: Progress; indexes: { byProfile: string } };
}

interface ExportFile {
  app: 'word-cards';
  version: 1;
  profile: Profile;
  settings: Settings;
  progress: Progress[];
}

export class ImportError extends Error {
  constructor() {
    super('Файл повреждён или не является резервной копией карточек');
  }
}

// Строго возрастающие метки времени: два профиля, созданные в одну миллисекунду, сохраняют порядок.
let lastStamp = 0;
function nextStamp(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

function isValidExport(d: unknown): d is ExportFile {
  if (typeof d !== 'object' || d === null) return false;
  const f = d as Partial<ExportFile>;
  const p = f.profile;
  return f.app === 'word-cards' && f.version === 1
    && !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.createdAt === 'string'
    && typeof f.settings === 'object' && f.settings !== null
    && Array.isArray(f.progress)
    && f.progress.every(x => typeof x?.cardId === 'string' && Number.isInteger(x.box) && x.box >= 0 && x.box <= 5);
}

export class Store {
  private constructor(private readonly db: IDBPDatabase<CardsDB>) {}

  static async open(name = 'word-cards'): Promise<Store> {
    const db = await openDB<CardsDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore('profiles', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'profileId' });
        const progress = db.createObjectStore('progress', { keyPath: ['profileId', 'cardId'] });
        progress.createIndex('byProfile', 'profileId');
      },
    });
    return new Store(db);
  }

  async listProfiles(): Promise<Profile[]> {
    const all = await this.db.getAll('profiles');
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addProfile(name: string): Promise<Profile> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Введите имя');
    const profile: Profile = { id: crypto.randomUUID(), name: trimmed, createdAt: nextStamp() };
    await this.db.put('profiles', profile);
    return profile;
  }

  async deleteProfile(id: string): Promise<void> {
    const tx = this.db.transaction(['profiles', 'settings', 'progress'], 'readwrite');
    await tx.objectStore('profiles').delete(id);
    await tx.objectStore('settings').delete(id);
    const keys = await tx.objectStore('progress').index('byProfile').getAllKeys(id);
    await Promise.all(keys.map(k => tx.objectStore('progress').delete(k)));
    await tx.done;
  }

  async getSettings(profileId: string): Promise<Settings> {
    const row = await this.db.get('settings', profileId);
    return { ...DEFAULT_SETTINGS, ...row?.settings };
  }

  async saveSettings(profileId: string, settings: Settings): Promise<void> {
    await this.db.put('settings', { profileId, settings });
  }

  async getProgressMap(profileId: string): Promise<ProgressMap> {
    const rows = await this.db.getAllFromIndex('progress', 'byProfile', profileId);
    return new Map(rows.map(p => [p.cardId, p]));
  }

  async putProgress(p: Progress): Promise<void> {
    await this.db.put('progress', p);
  }

  async exportProfile(profileId: string): Promise<string> {
    const profile = await this.db.get('profiles', profileId);
    if (!profile) throw new Error('Профиль не найден');
    const file: ExportFile = {
      app: 'word-cards', version: 1, profile,
      settings: await this.getSettings(profileId),
      progress: [...(await this.getProgressMap(profileId)).values()],
    };
    return JSON.stringify(file);
  }

  async importProfile(json: string): Promise<Profile> {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new ImportError();
    }
    if (!isValidExport(data)) throw new ImportError();
    const { profile, settings, progress } = data;
    const tx = this.db.transaction(['profiles', 'settings', 'progress'], 'readwrite');
    const progressStore = tx.objectStore('progress');
    const oldKeys = await progressStore.index('byProfile').getAllKeys(profile.id);
    await Promise.all(oldKeys.map(k => progressStore.delete(k)));
    await tx.objectStore('profiles').put(profile);
    await tx.objectStore('settings').put({ profileId: profile.id, settings: { ...DEFAULT_SETTINGS, ...settings } });
    await Promise.all(progress.map(p => progressStore.put({ ...p, profileId: profile.id })));
    await tx.done;
    return profile;
  }
}
