import { useEffect, useRef, useState } from 'preact/hooks';
import { audioStore } from '../data/offline';
import { loadIndex, loadTopic } from '../data/content';
import { buildSequence, sideText } from '../domain/sequence';
import { AudioEngine, type EngineState } from '../player/AudioEngine';
import { DEFAULT_SETTINGS, type Card } from '../types';

// Временный экран для проверки фонового аудио на iPhone. Удаляется в Task 13.
export function Prototype() {
  const [cards, setCards] = useState<Card[]>([]);
  const [state, setState] = useState<EngineState | null>(null);
  const [error, setError] = useState('');
  const cardsRef = useRef<Card[]>(cards);
  cardsRef.current = cards;
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AudioEngine({
      resolve: url => audioStore.resolve(url),
      describeCard: i => {
        const c = cardsRef.current[i];
        return { title: `${c?.en ?? ''} — ${c?.ru ?? ''}`, artist: 'Карточки слов' };
      },
      onError: setError,
    });
  }
  const engine = engineRef.current;

  useEffect(() => {
    loadIndex()
      .then(index => loadTopic(index.topics[0].id))
      .then(topic => setCards(topic.cards))
      .catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    const off = engine.subscribe(setState);
    return () => { off(); engine.destroy(); };
  }, [engine]);

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
    </main>
  );
}
