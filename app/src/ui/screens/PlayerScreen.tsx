import { useEffect, useRef, useState } from 'preact/hooks';
import { audioStore } from '../../data/offline';
import { todayISO } from '../../domain/dates';
import { markSeen, markStarred, newProgress } from '../../domain/leitner';
import { buildSequence, sideText } from '../../domain/sequence';
import { AudioEngine, type EngineState } from '../../player/AudioEngine';
import type { Card } from '../../types';
import { useApp } from '../App';

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (lock && !lock.released) return Promise.resolve();
      return navigator.wakeLock.request('screen')
      .then(l => { if (cancelled) void l.release(); else lock = l; })
      .catch(() => { /* не поддерживается или отказано — просто без блокировки */ });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

export function PlayerScreen({ title, cards, mode }: { title: string; cards: Card[]; mode: 'auto' | 'pocket' }) {
  const app = useApp();
  const [settings] = useState(app.settings);
  const [state, setState] = useState<EngineState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [toast, setToast] = useState('');

  // Актуальные значения для describeCard: движок создаётся один раз на экран.
  const infoRef = useRef({ cards, title });
  infoRef.current = { cards, title };
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AudioEngine({
      resolve: url => Promise.resolve(url),
      readBytes: url => audioStore.readBytes(url),
      describeCard: i => {
        const { cards: cs, title: t } = infoRef.current;
        return { title: `${cs[i].en} — ${cs[i].ru}`, artist: t };
      },
      onError: setToast,
    });
  }
  const engine = engineRef.current;

  useEffect(() => {
    // Сборка потока заканчивается до нажатия ▶ (iOS требует play() рядом с жестом).
    engine.load(buildSequence(cards, settings), { loop: settings.loop, rate: settings.rate });
    const off = engine.subscribe(setState);
    return () => { off(); engine.destroy(); };
  }, []);

  const cardIndex = state?.cardIndex ?? 0;
  const playing = state?.playing ?? false;
  // До сборки потока ▶ ждал бы её, и iOS мог бы отклонить play() без жеста — кнопки ждут готовности.
  const ready = state?.ready ?? false;
  const card = cards[cardIndex];

  // Перевод виден, пока звучит обратная сторона (и пауза после неё); тишина оставляет прежнее значение.
  useEffect(() => {
    if (state?.side === 'front') setRevealed(false);
    else if (state?.side === 'back') setRevealed(true);
  }, [state?.side, state?.stepIndex]);

  useEffect(() => {
    if (!playing || !card) return;
    const today = todayISO();
    const p = app.progress.get(card.id) ?? newProgress(app.profile.id, card.id);
    if (p.lastSeen !== today) {
      app.saveProgress(markSeen(p, today)).catch(() => setToast('Не удалось сохранить прогресс'));
    }
  }, [cardIndex, playing]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useWakeLock(mode === 'auto' && playing);

  if (!card) return <p class="muted">Нет карточек</p>;

  const starred = app.progress.get(card.id)?.starred ?? false;
  const star = () => {
    const p = app.progress.get(card.id) ?? newProgress(app.profile.id, card.id);
    app.saveProgress(markStarred(p, todayISO())).catch(() => setToast('Не удалось сохранить прогресс'));
  };
  const front = sideText(card, 'front', settings.direction);
  const back = sideText(card, 'back', settings.direction);

  return (
    <main class="stack">
      <div class="topbar">
        <button class="icon" onClick={app.back}>←</button>
        <h1>{title}</h1>
        <span class="muted">{cardIndex + 1}/{cards.length}</span>
      </div>

      {mode === 'auto' ? (
        <div class="card">
          <div class="main">{front.main}</div>
          {front.example && <div class="example">{front.example}</div>}
          <div class="divider" />
          {revealed ? (
            <>
              <div class="main">{back.main}</div>
              {back.example && <div class="example">{back.example}</div>}
            </>
          ) : <div class="muted">…</div>}
        </div>
      ) : (
        <div class="card" style={{ minHeight: '30vh' }}>
          <div style={{ fontSize: 48 }}>🎧</div>
          <p>Нажмите ▶ и заблокируйте экран — занятие продолжится.<br />
            Управление — на экране блокировки и кнопками наушников.</p>
          <div class="muted">{card.en} — {card.ru}</div>
        </div>
      )}

      {state?.finished ? (
        <div class="stack">
          <p>Набор закончился.</p>
          <button class="primary" onClick={() => void engine.play()}>Сначала</button>
          <button onClick={app.home}>К темам</button>
        </div>
      ) : (
        <div class="stack">
          <div class="row">
            <button onClick={() => engine.prevCard()} disabled={!ready}>⏮</button>
            <button class="primary" disabled={!ready}
              onClick={() => (playing ? engine.pause() : void engine.play())}>
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => engine.nextCard()} disabled={!ready}>⏭</button>
          </div>
          {!ready && <p class="muted">Готовлю звук…</p>}
        </div>
      )}

      <button onClick={star} disabled={starred}>{starred ? '★ Отмечена как трудная' : '☆ Трудная'}</button>
      <p class="muted">
        Пауза {settings.pauseSec} с · {settings.direction === 'en-ru' ? 'EN → RU' : 'RU → EN'} · {settings.rate}×
        {settings.loop ? ' · по кругу' : ''}
      </p>
      {toast && <div class="toast">{toast}</div>}
    </main>
  );
}
