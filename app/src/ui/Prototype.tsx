import { useEffect, useRef, useState } from 'preact/hooks';
import { audioStore } from '../data/offline';
import { loadIndex, loadTopic } from '../data/content';
import { buildSequence, sideText } from '../domain/sequence';
import { AudioEngine, type EngineState } from '../player/AudioEngine';
import { DEFAULT_SETTINGS, type Card } from '../types';
import {
  clearLog, instrumentedAudio, instrumentMediaSession, log, subscribeLog, type LogEntry,
} from './debugLog';

// Временный экран для проверки фонового аудио на iPhone. Удаляется в Task 13.
export function Prototype() {
  const [cards, setCards] = useState<Card[]>([]);
  const [state, setState] = useState<EngineState | null>(null);
  const [error, setError] = useState('');
  const cardsRef = useRef<Card[]>(cards);
  cardsRef.current = cards;
  const engineRef = useRef<AudioEngine | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  if (!engineRef.current) {
    instrumentMediaSession();
    engineRef.current = new AudioEngine({
      audio: instrumentedAudio(),
      resolve: url => audioStore.resolve(url),
      describeCard: i => {
        const c = cardsRef.current[i];
        return { title: `${c?.en ?? ''} — ${c?.ru ?? ''}`, artist: 'Карточки слов' };
      },
      onError: setError,
    });
  }
  const engine = engineRef.current;

  const [silentPause, setSilentPause] = useState(() => {
    try { return localStorage.getItem('word-cards:silent-pause') === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('word-cards:silent-pause', silentPause ? '1' : '0'); } catch { /* ignore */ }
    if (!silentPause || !('mediaSession' in navigator)) return;
    // Эксперимент: на паузе с экрана блокировки играем тишину по кругу, чтобы iOS не усыплял приложение.
    const silence = new Audio();
    silence.loop = true;
    audioStore.resolve('audio/silence_1s.mp3').then(u => { silence.src = u; log('silent-pause: ready'); });
    const ms = navigator.mediaSession;
    ms.setActionHandler('pause', () => {
      engine.pause();
      silence.play().then(() => log('silent-pause: silence playing'),
        (e: unknown) => log(`silent-pause: silence REJECTED ${e}`));
      ms.playbackState = 'paused';
    });
    ms.setActionHandler('play', () => {
      silence.pause();
      void engine.play();
    });
    log('silent-pause: ON');
    return () => {
      silence.pause();
      ms.setActionHandler('pause', () => engine.pause());
      ms.setActionHandler('play', () => void engine.play());
      log('silent-pause: OFF');
    };
  }, [silentPause, engine]);

  useEffect(() => {
    loadIndex()
      .then(index => loadTopic(index.topics[0].id))
      .then(topic => setCards(topic.cards))
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    let last = '';
    const off = engine.subscribe(s => {
      setState(s);
      const key = `playing=${s.playing} step=${s.stepIndex} card=${s.cardIndex} finished=${s.finished}`;
      if (key !== last) { last = key; log(`engine: ${key}`); }
    });
    return () => { off(); engine.destroy(); };
  }, [engine]);

  useEffect(() => subscribeLog(setLogEntries), []);

  useEffect(() => {
    engine.load(buildSequence(cards, DEFAULT_SETTINGS), { loop: true, rate: 1 });
  }, [engine, cards]);

  const card = state ? cards[state.cardIndex] : undefined;
  return (
    <main style={{ padding: '24px 0' }}>
      <h1>Прототип плеера</h1>
      {card && state && (
        <div style={{ fontSize: 28, margin: '24px 0' }}>
          <div>{sideText(card, 'front', 'en-ru').main}</div>
          <div style={{ color: 'var(--muted)' }}>{state.side === 'back' ? card.ru : '…'}</div>
        </div>
      )}
      <button onClick={() => (state?.playing ? engine.pause() : engine.play())} style={{ fontSize: 24 }}>
        {state?.playing ? '⏸ Пауза' : '▶ Играть'}
      </button>{' '}
      <button onClick={() => engine.nextCard()} style={{ fontSize: 24 }}>⏭</button>
      <p>Карточек: {cards.length}. Шаг: {state?.stepIndex ?? '-'}</p>
      {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}
      <label style={{ display: 'block', margin: '16px 0', fontSize: 18 }}>
        <input type="checkbox" checked={silentPause}
          onChange={e => setSilentPause((e.target as HTMLInputElement).checked)} />
        {' '}Тихая пауза (эксперимент)
      </label>
      <h2>Журнал (диагностика)</h2>
      <button onClick={clearLog}>Очистить журнал</button>{' '}
      <button onClick={() => navigator.clipboard?.writeText(
        logEntries.map(e => `${e.t} ${e.msg}`).join('\n'))}>Скопировать</button>
      <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {logEntries.slice().reverse().map(e => `${e.t} ${e.msg}`).join('\n')}
      </pre>
    </main>
  );
}
