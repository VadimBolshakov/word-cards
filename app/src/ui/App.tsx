import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { loadIndex, loadTopic } from '../data/content';
import { Store } from '../data/db';
import { selectDue, type ProgressMap } from '../domain/selection';
import { todayISO } from '../domain/dates';
import type { Card, ContentIndex, Profile, Progress, Settings } from '../types';
import { CardScreen } from './screens/CardScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { ProfilesScreen } from './screens/ProfilesScreen';
import { SetScreen } from './screens/SetScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TopicsScreen } from './screens/TopicsScreen';

export type Route =
  | { name: 'profiles' }
  | { name: 'topics' }
  | { name: 'set'; topicId: string; setN: number }
  | { name: 'due' }
  | { name: 'card'; title: string; cards: Card[] }
  | { name: 'player'; title: string; cards: Card[]; mode: 'auto' | 'pocket' }
  | { name: 'settings' };

export interface AppCtx {
  store: Store;
  index: ContentIndex;
  cardsByTopic: Map<string, Card[]>;
  profile: Profile;
  settings: Settings;
  progress: ProgressMap;
  go(route: Route): void;
  back(): void;
  home(): void;
  saveSettings(s: Settings): Promise<void>;
  saveProgress(p: Progress): Promise<void>;
  switchProfile(): void;
  reloadProfile(): Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp вне App');
  return ctx;
}

const LAST_PROFILE_KEY = 'word-cards:lastProfile';

function readLastProfile(): string | null {
  try { return localStorage.getItem(LAST_PROFILE_KEY); } catch { return null; }
}
function writeLastProfile(id: string): void {
  try { localStorage.setItem(LAST_PROFILE_KEY, id); } catch { /* приватный режим */ }
}

interface Loaded {
  store: Store;
  index: ContentIndex;
  cardsByTopic: Map<string, Card[]>;
}

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<ProgressMap>(new Map());
  const [stack, setStack] = useState<Route[]>([{ name: 'profiles' }]);

  useEffect(() => {
    (async () => {
      const store = await Store.open();
      const index = await loadIndex();
      const topics = await Promise.all(index.topics.map(t => loadTopic(t.id)));
      const cardsByTopic = new Map(topics.map(t => [t.id, t.cards]));
      setLoaded({ store, index, cardsByTopic });
      const profiles = await store.listProfiles();
      const last = profiles.find(p => p.id === readLastProfile()) ?? (profiles.length === 1 ? profiles[0] : null);
      if (last) await selectProfile(store, last);
    })().catch(e => setLoadError(
      `Не удалось загрузить данные. Откройте приложение с интернетом хотя бы один раз. (${e})`));
  }, []);

  async function selectProfile(store: Store, p: Profile) {
    writeLastProfile(p.id);
    setSettings(await store.getSettings(p.id));
    setProgress(await store.getProgressMap(p.id));
    setProfile(p);
    setStack([{ name: 'topics' }]);
  }

  if (loadError) return <p class="error">{loadError}</p>;
  if (!loaded) return <p class="muted">Загрузка…</p>;

  const route = stack[stack.length - 1];
  if (route.name === 'profiles' || !profile || !settings) {
    return <ProfilesScreen store={loaded.store} onSelect={p => selectProfile(loaded.store, p)} />;
  }

  const ctx: AppCtx = {
    ...loaded, profile, settings, progress,
    go: r => setStack(s => [...s, r]),
    back: () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s)),
    home: () => setStack([{ name: 'topics' }]),
    saveSettings: async s => {
      await loaded.store.saveSettings(profile.id, s);
      setSettings(s);
    },
    saveProgress: async p => {
      await loaded.store.putProgress(p);
      setProgress(prev => new Map(prev).set(p.cardId, p));
    },
    switchProfile: () => setStack([{ name: 'profiles' }]),
    reloadProfile: async () => {
      const fresh = (await loaded.store.listProfiles()).find(p => p.id === profile.id);
      if (fresh) await selectProfile(loaded.store, fresh);
      else setStack([{ name: 'profiles' }]);
    },
  };

  return <Ctx.Provider value={ctx}>{renderRoute(route, ctx)}</Ctx.Provider>;
}

function renderRoute(route: Route, ctx: AppCtx) {
  switch (route.name) {
    case 'topics':
      return <TopicsScreen />;
    case 'set': {
      const topic = ctx.index.topics.find(t => t.id === route.topicId)!;
      const cards = (ctx.cardsByTopic.get(route.topicId) ?? []).filter(c => c.set === route.setN);
      return <SetScreen key={`${route.topicId}-${route.setN}`} title={`${topic.title} · набор ${route.setN}`}
        cards={cards} allowModeChoice />;
    }
    case 'due': {
      const all = [...ctx.cardsByTopic.values()].flat();
      return <SetScreen key="due" title="Повторение на сегодня"
        cards={selectDue(all, ctx.progress, todayISO())} allowModeChoice={false} />;
    }
    case 'card':
      return <CardScreen title={route.title} cards={route.cards} />;
    case 'player':
      return <PlayerScreen title={route.title} cards={route.cards} mode={route.mode} />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return null;
  }
}
