import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { loadIndex, loadTopic } from '../data/content';
import { Store } from '../data/db';
import { selectDue, type ProgressMap } from '../domain/selection';
import { todayISO } from '../domain/dates';
import type { Card, ContentIndex, Profile, Progress, Settings } from '../types';
import { depthFromState, resyncDelta, truncateTo } from './navigation';
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

class ContentError extends Error {}

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<ProgressMap>(new Map());
  const [stack, setStackState] = useState<Route[]>([{ name: 'profiles' }]);
  // Зеркало стека для синхронного чтения из обработчиков (popstate, go, back, home).
  const stackRef = useRef<Route[]>(stack);
  // Корень, который нужно поставить после возврата истории на глубину 0 (см. resetRoot).
  const pendingRoot = useRef<Route | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function setStack(next: Route[]) {
    stackRef.current = next;
    setStackState(next);
  }

  // Смена корня (профиль, «Темы», «Профили»). Если стек глубже одного экрана, сначала возвращаем историю
  // на глубину 0, а корень ставим в popstate: так в истории не остаётся записей старого профиля.
  function resetRoot(root: Route) {
    const extra = depthFromState(history.state);
    setStack([root]);
    if (extra > 0) {
      pendingRoot.current = root;
      // Страховка: ожидание не должно «проглотить» посторонний свайп назад.
      clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => { pendingRoot.current = null; }, 1000);
      history.go(-extra);
    } else {
      history.replaceState({ depth: 0 }, '');
    }
  }

  // Свайп «назад» и системная кнопка приходят как popstate; стек меняется только здесь.
  useEffect(() => {
    history.replaceState({ depth: 0 }, '');
    const onPop = (e: PopStateEvent) => {
      const depth = depthFromState(e.state);
      const pending = pendingRoot.current;
      if (pending) {
        if (depth !== 0) return;
        pendingRoot.current = null;
        clearTimeout(pendingTimer.current);
        setStack([pending]);
        history.replaceState({ depth: 0 }, '');
        return;
      }
      const delta = resyncDelta(stackRef.current.length, depth);
      if (delta !== 0) {
        // Свайп «вперёд»: возвращаем историю к вершине стека, экран не меняем.
        history.go(delta);
        return;
      }
      setStack([...truncateTo(stackRef.current, depth)]);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    setLoadError('');
    (async () => {
      const store = await Store.open();
      let index: ContentIndex;
      let cardsByTopic: Map<string, Card[]>;
      try {
        index = await loadIndex();
        const topics = await Promise.all(index.topics.map(t => loadTopic(t.id)));
        cardsByTopic = new Map(topics.map(t => [t.id, t.cards]));
      } catch {
        throw new ContentError();
      }
      // Состояние «загружено» ставим только после попытки восстановить профиль,
      // чтобы вернувшийся пользователь не видел мигание экрана выбора профиля.
      const profiles = await store.listProfiles();
      const last = profiles.find(p => p.id === readLastProfile()) ?? (profiles.length === 1 ? profiles[0] : null);
      if (last) await selectProfile(store, last);
      setLoaded({ store, index, cardsByTopic });
    })().catch(e => setLoadError(e instanceof ContentError
      ? 'Не удалось загрузить темы. Проверьте интернет — при первом запуске он нужен.'
      : `Ошибка запуска: ${e}`));
  }, [attempt]);

  // Загружает профиль, настройки и прогресс, не трогая навигацию.
  async function loadProfileData(store: Store, p: Profile) {
    const [s, pr] = await Promise.all([store.getSettings(p.id), store.getProgressMap(p.id)]);
    setSettings(s);
    setProgress(pr);
    setProfile(p);
  }

  async function selectProfile(store: Store, p: Profile) {
    await loadProfileData(store, p);
    writeLastProfile(p.id);
    resetRoot({ name: 'topics' });
  }

  if (loadError) {
    return (
      <main class="stack">
        <p class="error">{loadError}</p>
        <button class="primary" onClick={() => setAttempt(n => n + 1)}>Повторить</button>
      </main>
    );
  }
  if (!loaded) return <p class="muted">Загрузка…</p>;

  const route = stack[stack.length - 1];
  if (route.name === 'profiles' || !profile || !settings) {
    return <ProfilesScreen store={loaded.store} onSelect={p => selectProfile(loaded.store, p)} />;
  }

  const ctx: AppCtx = {
    ...loaded, profile, settings, progress,
    go: r => {
      history.pushState({ depth: stackRef.current.length }, '');
      setStack([...stackRef.current, r]);
    },
    back: () => { if (stackRef.current.length > 1) history.back(); },
    home: () => {
      const extra = depthFromState(history.state);
      if (extra > 0) history.go(-extra);
    },
    // Оптимистично: UI обновляется сразу, запись в БД следом (ошибку получает вызывающий).
    saveSettings: async s => {
      setSettings(s);
      await loaded.store.saveSettings(profile.id, s);
    },
    saveProgress: async p => {
      await loaded.store.putProgress(p);
      setProgress(prev => new Map(prev).set(p.cardId, p));
    },
    // Запомненный профиль не трогаем: после перезапуска пользователь вернётся в последний профиль,
    // а смена профиля делается кнопкой на этом экране.
    switchProfile: () => resetRoot({ name: 'profiles' }),
    reloadProfile: async () => {
      const fresh = (await loaded.store.listProfiles()).find(p => p.id === profile.id);
      if (fresh) await loadProfileData(loaded.store, fresh);
      else resetRoot({ name: 'profiles' });
    },
  };

  return <Ctx.Provider value={ctx}>{renderRoute(route, ctx)}</Ctx.Provider>;
}

function renderRoute(route: Route, ctx: AppCtx) {
  switch (route.name) {
    case 'topics':
      return <TopicsScreen />;
    case 'set': {
      const topic = ctx.index.topics.find(t => t.id === route.topicId);
      if (!topic) {
        return (
          <main class="stack">
            <div class="topbar"><button class="icon" onClick={ctx.back}>←</button><h1>Тема не найдена</h1></div>
          </main>
        );
      }
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
