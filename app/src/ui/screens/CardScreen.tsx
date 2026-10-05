import { useEffect, useRef, useState } from 'preact/hooks';
import { audioStore } from '../../data/offline';
import { todayISO } from '../../domain/dates';
import { applyAnswer, newProgress, type Answer } from '../../domain/leitner';
import { sideText, type Side } from '../../domain/sequence';
import { NO_AUDIO_MESSAGE } from '../../player/AudioEngine';
import type { Card } from '../../types';
import { useApp } from '../App';

let sharedAudio: HTMLAudioElement | null = null;
const audioEl = () => (sharedAudio ??= new Audio());
const SWIPE_PX = 60;

export function CardScreen({ title, cards }: { title: string; cards: Card[] }) {
  const app = useApp();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState<Record<Answer, number>>({ know: 0, again: 0 });
  const [error, setError] = useState('');
  const touchX = useRef<number | null>(null);
  const playReq = useRef(0);
  const card = cards[i];
  const dir = app.settings.direction;

  const audioFor = (c: Card, side: Side) => (sideText(c, side, dir).lang === 'en' ? c.enAudio : c.ruAudio);

  async function play(rel: string) {
    const req = ++playReq.current;
    try {
      const a = audioEl();
      a.pause();
      const src = await audioStore.resolve(rel);
      if (req !== playReq.current) return; // user moved on while resolving
      a.src = src;
      a.playbackRate = app.settings.rate;
      await a.play();
      if (req === playReq.current) setError('');
    } catch (e) {
      if (req !== playReq.current) return;
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return;
      setError(NO_AUDIO_MESSAGE);
    }
  }

  useEffect(() => {
    if (card) void play(audioFor(card, 'front'));
  }, [i]);
  useEffect(() => () => {
    playReq.current++;
    audioEl().pause();
  }, []);

  function next() {
    setFlipped(false);
    setI(n => n + 1);
  }

  function flip() {
    if (flipped) return;
    setFlipped(true);
    void play(audioFor(card, 'back'));
  }

  async function answer(a: Answer) {
    const p = app.progress.get(card.id) ?? newProgress(app.profile.id, card.id);
    await app.saveProgress(applyAnswer(p, a, todayISO()));
    setStats(s => ({ ...s, [a]: s[a] + 1 }));
    next();
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touchX.current;
    touchX.current = null;
    if (start !== null && e.changedTouches[0].clientX - start < -SWIPE_PX) next();
  }

  const topbar = (
    <div class="topbar">
      <button class="icon" onClick={app.back}>←</button>
      <h1>{title}</h1>
      <span class="muted">{Math.min(i + 1, cards.length)}/{cards.length}</span>
    </div>
  );

  if (!card) {
    return (
      <main class="stack">
        {topbar}
        <h2>Набор пройден 🎉</h2>
        <p>Знаю: {stats.know} · Повторить: {stats.again}</p>
        <button class="primary" onClick={() => { setI(0); setStats({ know: 0, again: 0 }); }}>Ещё раз</button>
        <button onClick={app.home}>К темам</button>
      </main>
    );
  }

  const front = sideText(card, 'front', dir);
  const back = sideText(card, 'back', dir);
  return (
    <main class="stack">
      {topbar}
      <div class="card" onClick={flip}
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }} onTouchEnd={onTouchEnd}>
        <div class="main">{front.main}</div>
        {front.example && <div class="example">{front.example}</div>}
        {flipped ? (
          <>
            <div class="divider" />
            <div class="main">{back.main}</div>
            {back.example && <div class="example">{back.example}</div>}
          </>
        ) : (
          <div class="muted">Нажмите, чтобы увидеть перевод</div>
        )}
      </div>
      <div class="row">
        <button onClick={() => play(audioFor(card, flipped ? 'back' : 'front'))}>🔊 Ещё раз</button>
        <button onClick={next}>Пропустить →</button>
      </div>
      {flipped && (
        <div class="row">
          <button class="warn" onClick={() => answer('again')}>Повторить</button>
          <button class="good" onClick={() => answer('know')}>Знаю</button>
        </div>
      )}
      {error && <p class="error">{error}</p>}
    </main>
  );
}
