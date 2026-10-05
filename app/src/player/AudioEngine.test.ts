import { describe, expect, it, vi } from 'vitest';
import type { Step } from '../domain/sequence';
import { AudioEngine, type AudioLike, type MediaSessionLike } from './AudioEngine';

class FakeAudio implements AudioLike {
  src = '';
  playbackRate = 1;
  played: { src: string; rate: number }[] = [];
  failing = new Set<string>();
  private listeners: Record<string, (() => void)[]> = { ended: [], error: [] };
  async play() {
    this.played.push({ src: this.src, rate: this.playbackRate });
    if (this.failing.has(this.src)) queueMicrotask(() => this.fire('error'));
  }
  pause() {}
  addEventListener(type: 'ended' | 'error', fn: () => void) { this.listeners[type].push(fn); }
  fire(type: 'ended' | 'error') { this.listeners[type].forEach(fn => fn()); }
}

class FakeSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState: 'none' | 'paused' | 'playing' = 'none';
  handlers: Record<string, (() => void) | null> = {};
  setActionHandler(action: string, handler: (() => void) | null) { this.handlers[action] = handler; }
}

class RejectingAudio extends FakeAudio {
  async play() {
    this.played.push({ src: this.src, rate: this.playbackRate });
    if (this.failing.has(this.src)) {
      // error приходит после того, как отказ play() уже обработан
      void Promise.resolve().then(() => {}).then(() => {}).then(() => {}).then(() => this.fire('error'));
      throw new Error('load failed');
    }
  }
}

const flush = () => new Promise(r => setTimeout(r, 0));
const a = (url: string, cardIndex: number, side: 'front' | 'back' = 'front'): Step =>
  ({ kind: 'audio', url, cardIndex, side });
const s = (cardIndex: number): Step => ({ kind: 'silence', url: 'sil', cardIndex, seconds: 1 });
const STEPS: Step[] = [a('a1', 0), s(0), a('a2', 0, 'back'), s(0), a('b1', 1), s(1), a('b2', 1, 'back'), s(1)];

function setup(opts: { loop?: boolean; rate?: number; audio?: FakeAudio } = {}) {
  const audio = opts.audio ?? new FakeAudio();
  const session = new FakeSession();
  const onError = vi.fn();
  const resolve = vi.fn(async (url: string) => `blob:${url}`);
  const engine = new AudioEngine({
    audio, mediaSession: session, onError,
    resolve,
    describeCard: i => ({ title: `card ${i}`, artist: 'topic' }),
  });
  engine.load(STEPS, { loop: opts.loop ?? false, rate: opts.rate ?? 1 });
  return { audio, session, onError, engine, resolve };
}

async function playThrough(audio: FakeAudio, count: number) {
  for (let i = 0; i < count; i++) { audio.fire('ended'); await flush(); }
}

describe('AudioEngine', () => {
  it('plays all steps in order and finishes', async () => {
    const { audio, engine } = setup();
    await engine.play(); await flush();
    await playThrough(audio, STEPS.length);
    expect(audio.played.map(p => p.src)).toEqual(STEPS.map(st => `blob:${st.url}`));
    expect(engine.getState()).toMatchObject({ playing: false, finished: true });
  });

  it('loops to the start when loop is on', async () => {
    const { audio, engine } = setup({ loop: true });
    await engine.play(); await flush();
    await playThrough(audio, STEPS.length);
    expect(audio.played.at(-1)?.src).toBe('blob:a1');
    expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 0 });
  });

  it('pause and resume continue the same step', async () => {
    const { audio, engine, resolve } = setup();
    await engine.play(); await flush();
    await playThrough(audio, 2);
    engine.pause();
    expect(engine.getState().playing).toBe(false);
    audio.fire('ended'); await flush();               // ended после паузы игнорируется
    expect(engine.getState().stepIndex).toBe(2);
    const resolvesBefore = resolve.mock.calls.length;
    await engine.play(); await flush();
    expect(resolve.mock.calls.length).toBe(resolvesBefore);   // src не перезагружался
    expect(audio.played.at(-1)?.src).toBe('blob:a2');
    expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 2, side: 'back' });
  });

  it('applies rate to speech and 1 to silence', async () => {
    const { audio, engine } = setup({ rate: 1.2 });
    await engine.play(); await flush();
    await playThrough(audio, 1);
    expect(audio.played.map(p => p.rate)).toEqual([1.2, 1]);
  });

  it('nextCard and prevCard jump to card starts', async () => {
    const { audio, engine } = setup();
    await engine.play(); await flush();
    engine.nextCard(); await flush();
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4 });
    expect(audio.played.at(-1)?.src).toBe('blob:b1');
    engine.prevCard(); await flush();
    expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0 });
  });

  it('retries a failing step once, then skips to next card and reports', async () => {
    const { audio, engine, onError } = setup();
    audio.failing.add('blob:a2');
    await engine.play(); await flush();
    await playThrough(audio, 2); await flush(); await flush();
    expect(audio.played.filter(p => p.src === 'blob:a2')).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4, playing: true });
  });

  it('updates media session and handles remote commands', async () => {
    const { session, engine } = setup();
    await engine.play(); await flush();
    expect(session.metadata).toMatchObject({ title: 'card 0', artist: 'topic' });
    expect(session.playbackState).toBe('playing');
    session.handlers.nexttrack!(); await flush();
    expect(session.metadata).toMatchObject({ title: 'card 1' });
    session.handlers.pause!();
    expect(session.playbackState).toBe('paused');
  });

  it('subscribe emits current and subsequent states', async () => {
    const { engine } = setup();
    const seen: number[] = [];
    const off = engine.subscribe(st => seen.push(st.stepIndex));
    await engine.play(); await flush();
    off();
    engine.nextCard(); await flush();
    expect(seen[0]).toBe(0);
    expect(seen).not.toContain(4);
  });

  it('pause during a pending resolve does not start playback', async () => {
    const audio = new FakeAudio();
    let release!: (src: string) => void;
    const engine = new AudioEngine({
      audio, mediaSession: null,
      resolve: () => new Promise<string>(r => { release = r; }),
    });
    engine.load(STEPS, { loop: false, rate: 1 });
    const p = engine.play();
    engine.pause();
    release('blob:a1'); await p; await flush();
    expect(audio.played).toHaveLength(0);
    expect(engine.getState().playing).toBe(false);
    const p2 = engine.play();
    release('blob:a1'); await p2; await flush();
    expect(audio.played.map(x => x.src)).toEqual(['blob:a1']);
    expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 0 });
  });

  it('counts one load failure once even if play rejects and error fires', async () => {
    const { audio, engine, onError } = setup({ audio: new RejectingAudio() });
    audio.failing.add('blob:a2');
    await engine.play(); await flush();
    await playThrough(audio, 2); await flush(); await flush();
    expect(audio.played.filter(p => p.src === 'blob:a2')).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4, playing: true });
  });

  it('stops after a full lap of failures when looping', async () => {
    const { audio, engine, onError } = setup({ loop: true });
    for (const st of STEPS) audio.failing.add(`blob:${st.url}`);
    await engine.play();
    for (let i = 0; i < 10; i++) await flush();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(engine.getState()).toMatchObject({ playing: false, finished: true });
  });

  it('pause during a retry resolve then resume does not get stuck', async () => {
    const audio = new FakeAudio();
    audio.failing.add('blob:a1');
    const onError = vi.fn();
    let a1Calls = 0;
    let release!: (src: string) => void;
    const engine = new AudioEngine({
      audio, mediaSession: null, onError,
      resolve: url => {
        if (url === 'a1' && ++a1Calls === 2) return new Promise<string>(r => { release = r; });
        return Promise.resolve(`blob:${url}`);
      },
    });
    engine.load(STEPS, { loop: false, rate: 1 });
    await engine.play(); await flush();               // первая попытка упала, retry ждёт resolve
    engine.pause();
    release('blob:a1'); await flush();
    await engine.play();
    for (let i = 0; i < 6; i++) await flush();
    expect(audio.played.filter(p => p.src === 'blob:a1').length).toBeGreaterThanOrEqual(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4, playing: true });
  });

  it('media session play and previoustrack handlers work', async () => {
    const { session, engine, audio } = setup();
    session.handlers.play!(); await flush();
    expect(engine.getState().playing).toBe(true);
    expect(audio.played.at(-1)?.src).toBe('blob:a1');
    session.handlers.nexttrack!(); await flush();
    session.handlers.previoustrack!(); await flush();
    expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0, playing: true });
    expect(session.metadata).toMatchObject({ title: 'card 0' });
  });
});
