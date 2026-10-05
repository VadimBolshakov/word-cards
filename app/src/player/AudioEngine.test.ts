import { describe, expect, it, vi } from 'vitest';
import type { Step } from '../domain/sequence';
import { AudioEngine, type AudioLike, type MediaSessionLike } from './AudioEngine';

type AudioEvent = 'ended' | 'error' | 'timeupdate' | 'seeked';

class FakeAudio implements AudioLike {
  srcSets: string[] = [];
  private _src = '';
  get src() { return this._src; }
  set src(v: string) { this._src = v; this.srcSets.push(v); }
  playbackRate = 1;
  currentTime = 0;
  loop = false;
  muted = false;
  paused = true;
  played = 0;
  pauses = 0;
  rejectPlay = false;
  private listeners: Record<AudioEvent, (() => void)[]> = { ended: [], error: [], timeupdate: [], seeked: [] };
  async play() {
    this.played++;
    if (this.rejectPlay) throw new Error('AbortError');
    this.paused = false;
  }
  pause() { this.pauses++; this.paused = true; }
  addEventListener(type: AudioEvent, fn: () => void) { this.listeners[type].push(fn); }
  fire(type: AudioEvent) { this.listeners[type].forEach(fn => fn()); }
  at(seconds: number) { this.currentTime = seconds; this.fire('timeupdate'); }
}

class FakeSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState: 'none' | 'paused' | 'playing' = 'none';
  handlers: Record<string, (() => void) | null> = {};
  setActionHandler(action: string, handler: (() => void) | null) { this.handlers[action] = handler; }
}

const flush = () => new Promise(r => setTimeout(r, 0));
const a = (url: string, cardIndex: number, side: 'front' | 'back' = 'front'): Step =>
  ({ kind: 'audio', url, cardIndex, side });
const s = (cardIndex: number): Step => ({ kind: 'silence', url: 'sil', cardIndex, seconds: 1 });
const STEPS: Step[] = [a('a1', 0), s(0), a('a2', 0, 'back'), s(0), a('b1', 1), s(1), a('b2', 1, 'back'), s(1)];
// Длительности в секундах. stepStart: 0, 1, 2, 4, 5, 6, 7, 9, (конец) 10.
const SECONDS: Record<string, number> = { a1: 1, sil: 1, a2: 2, b1: 1, b2: 2 };

class FakeTimers {
  pending = new Map<number, () => void>();
  private next = 0;
  set = (fn: () => void, _ms: number) => { const id = ++this.next; this.pending.set(id, fn); return id; };
  clear = (id: unknown) => { this.pending.delete(id as number); };
  runAll() { const fns = [...this.pending.values()]; this.pending.clear(); fns.forEach(fn => fn()); }
}

function setup(opts: { loop?: boolean; rate?: number; missing?: string[]; session?: FakeSession } = {}) {
  const audio = new FakeAudio();
  const timers = new FakeTimers();
  const setTimer = vi.fn(timers.set);
  const session = opts.session ?? new FakeSession();
  const onError = vi.fn();
  const missing = new Set(opts.missing ?? []);
  const resolve = vi.fn(async (url: string) => {
    if (missing.has(url)) throw new Error('no audio');
    return `blob:${url}`;
  });
  const readBytes = vi.fn(async (u: string) => new Uint8Array(SECONDS[u.slice(5)] * 6000).buffer);
  const blobs: Blob[] = [];
  const makeObjectUrl = vi.fn((b: Blob) => { blobs.push(b); return `blob:stream-${blobs.length}`; });
  const revokeObjectUrl = vi.fn();
  const engine = new AudioEngine({
    audio, mediaSession: session, onError, resolve, readBytes, makeObjectUrl, revokeObjectUrl,
    describeCard: i => ({ title: `card ${i}`, artist: 'topic' }),
    setTimer, clearTimer: timers.clear,
  });
  engine.load(STEPS, { loop: opts.loop ?? false, rate: opts.rate ?? 1 });
  return {
    audio, session, onError, engine, resolve, readBytes, blobs, makeObjectUrl, revokeObjectUrl,
    timers, setTimer,
  };
}

describe('AudioEngine', () => {
  it('assembles one stream, assigns src once and plays it', async () => {
    const { audio, engine, readBytes, blobs } = setup();
    await engine.play();
    expect(audio.srcSets).toEqual(['blob:stream-1']);
    expect(audio.played).toBe(1);
    expect(engine.getState()).toMatchObject({ playing: true, finished: false, stepIndex: 0 });
    expect(readBytes).toHaveBeenCalledTimes(5);              // 'sil' читается один раз
    expect(blobs).toHaveLength(1);
    expect(blobs[0].size).toBe(10 * 6000);
    expect(blobs[0].type).toBe('audio/mpeg');
  });

  it('timeupdate moves step, card and side by stream position', async () => {
    const { audio, engine } = setup();
    await engine.play();
    audio.at(0.5);
    expect(engine.getState()).toMatchObject({ stepIndex: 0, cardIndex: 0, side: 'front' });
    audio.at(1.2);
    expect(engine.getState()).toMatchObject({ stepIndex: 1, cardIndex: 0, side: null });
    audio.at(3.9);
    expect(engine.getState()).toMatchObject({ stepIndex: 2, cardIndex: 0, side: 'back' });
    audio.at(5);
    expect(engine.getState()).toMatchObject({ stepIndex: 4, cardIndex: 1, side: 'front' });
    audio.at(8);
    expect(engine.getState()).toMatchObject({ stepIndex: 6, cardIndex: 1, side: 'back' });
    audio.at(9.5);
    expect(engine.getState()).toMatchObject({ stepIndex: 7, cardIndex: 1, side: null });
  });

  it('pause and resume keep the same src and position', async () => {
    const { audio, engine } = setup();
    await engine.play();
    audio.at(2.5);
    engine.pause();
    expect(engine.getState()).toMatchObject({ playing: false, stepIndex: 2 });
    await engine.play();
    expect(audio.srcSets).toHaveLength(1);
    expect(audio.played).toBe(1);                             // мягкая пауза: элемент не вставал
    expect(audio.currentTime).toBe(2.5);
    expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 2, side: 'back' });
  });

  it('nextCard and prevCard seek to card starts; past the last card finishes', async () => {
    const { audio, engine } = setup();
    await engine.play();
    engine.nextCard();
    expect(audio.currentTime).toBe(5);
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4, playing: true });
    engine.prevCard();
    expect(audio.currentTime).toBe(0);
    expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0 });
    engine.nextCard();
    engine.nextCard();
    expect(engine.getState()).toMatchObject({ finished: true, playing: false });
    expect(audio.srcSets).toHaveLength(1);
  });

  it('nextCard past the last card wraps to the start when looping, also while paused', async () => {
    const { audio, engine } = setup({ loop: true });
    await flush();
    engine.nextCard();
    expect(audio.currentTime).toBe(5);
    engine.nextCard();
    expect(audio.currentTime).toBe(0);
    expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0, playing: false, finished: false });
    expect(audio.played).toBe(0);
  });

  it('ended finishes without loop and restarts with loop', async () => {
    const plain = setup();
    await plain.engine.play();
    plain.audio.at(10);
    plain.audio.fire('ended');
    expect(plain.engine.getState()).toMatchObject({ finished: true, playing: false });
    await plain.engine.play();                                // повтор после окончания — с начала
    expect(plain.audio.currentTime).toBe(0);
    expect(plain.engine.getState()).toMatchObject({ finished: false, playing: true });

    const looped = setup({ loop: true });
    await looped.engine.play();
    looped.audio.at(10);
    looped.audio.fire('ended'); await flush();
    expect(looped.audio.currentTime).toBe(0);
    expect(looped.audio.played).toBe(2);
    expect(looped.engine.getState()).toMatchObject({ playing: true, finished: false, stepIndex: 0 });
  });

  it('a step without audio gets zero length and is reported once', async () => {
    const { audio, engine, onError, blobs } = setup({ missing: ['a2', 'b2'] });
    await engine.play();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(blobs[0].size).toBe(6 * 6000);                     // a1 + 4×sil + b1
    // stepStart: 0, 1, 2, 2, 3, 4, 5, 5, (конец) 6
    audio.at(2.5);
    expect(engine.getState()).toMatchObject({ stepIndex: 3, cardIndex: 0 });
    audio.at(5.5);
    expect(engine.getState()).toMatchObject({ stepIndex: 7, cardIndex: 1 });
  });

  it('when no step has audio the engine finishes and reports once', async () => {
    const { audio, engine, onError } = setup({ missing: ['a1', 'a2', 'b1', 'b2', 'sil'] });
    await engine.play();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(audio.srcSets).toHaveLength(0);
    expect(audio.played).toBe(0);
    expect(engine.getState()).toMatchObject({ finished: true, playing: false });
  });

  it('play before assembly ends waits for it; a new load drops the old assembly', async () => {
    const audio = new FakeAudio();
    const releases: (() => void)[] = [];
    const readBytes = vi.fn((u: string) => new Promise<ArrayBuffer>(r =>
      releases.push(() => r(new Uint8Array(SECONDS[u.slice(5)] * 6000).buffer))));
    let n = 0;
    const engine = new AudioEngine({
      audio, mediaSession: null, readBytes,
      resolve: async url => `blob:${url}`,
      makeObjectUrl: () => `blob:stream-${++n}`,
      revokeObjectUrl: () => {},
    });
    engine.load(STEPS, { loop: false, rate: 1 });
    await flush();
    const oldReleases = releases.splice(0);
    engine.load(STEPS, { loop: false, rate: 1 });
    await flush();
    const p = engine.play();
    expect(engine.getState().playing).toBe(true);
    oldReleases.forEach(r => r()); await flush();
    expect(audio.srcSets).toHaveLength(0);                   // старая сборка отброшена
    expect(audio.played).toBe(0);
    releases.forEach(r => r()); await p;
    expect(audio.srcSets).toEqual(['blob:stream-1']);
    expect(audio.played).toBe(1);
    expect(readBytes).toHaveBeenCalledTimes(10);
  });

  it('pause during assembly prevents playback once assembled', async () => {
    const { audio, engine } = setup();
    const p = engine.play();
    engine.pause();
    await p;
    expect(audio.played).toBe(0);
    expect(engine.getState().playing).toBe(false);
  });

  it('rejected audio.play() leaves the engine paused without an error message', async () => {
    const { audio, engine, onError } = setup();
    audio.rejectPlay = true;
    await engine.play();
    expect(engine.getState().playing).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('element error stops playback and reports', async () => {
    const { audio, engine, onError } = setup();
    await engine.play();
    audio.fire('error');
    expect(engine.getState().playing).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('applies rate to the stream and setRate changes it on the fly', async () => {
    const { audio, engine } = setup({ rate: 1.2 });
    await engine.play();
    expect(audio.playbackRate).toBe(1.2);
    engine.setRate(0.8);
    expect(audio.playbackRate).toBe(0.8);
  });

  it('updates media session and handles remote commands', async () => {
    const { audio, session, engine } = setup();
    session.handlers.play!(); await flush();
    expect(engine.getState().playing).toBe(true);
    expect(session.metadata).toMatchObject({ title: 'card 0', artist: 'topic' });
    expect(session.playbackState).toBe('playing');
    audio.at(5.5);
    expect(session.metadata).toMatchObject({ title: 'card 1' });
    session.handlers.previoustrack!();
    expect(audio.currentTime).toBe(0);
    expect(session.metadata).toMatchObject({ title: 'card 0' });
    session.handlers.nexttrack!();
    expect(engine.getState().cardIndex).toBe(1);
    expect(session.metadata).toMatchObject({ title: 'card 1' });
    session.handlers.pause!();
    expect(session.playbackState).toBe('paused');
    expect(engine.getState().playing).toBe(false);
  });

  it('subscribe emits current and subsequent states', async () => {
    const { engine } = setup();
    const seen: number[] = [];
    const off = engine.subscribe(st => seen.push(st.stepIndex));
    await engine.play();
    off();
    engine.nextCard();
    expect(seen[0]).toBe(0);
    expect(seen).not.toContain(4);
  });

  it('destroying an old engine does not wipe the live engine media session handlers', async () => {
    const session = new FakeSession();
    const engA = setup({ session }).engine;
    const engB = setup({ session }).engine;
    await flush();
    engA.destroy();
    expect(session.handlers.nexttrack).toBeTypeOf('function');
    expect(session.handlers.play).toBeTypeOf('function');
    session.handlers.nexttrack!();
    expect(engB.getState().cardIndex).toBe(1);
    engB.destroy();
    expect(session.handlers.nexttrack).toBeNull();
    expect(session.handlers.play).toBeNull();
    expect(session.playbackState).toBe('none');
  });

  it('destroy and reload release the stream object URL', async () => {
    const { engine, revokeObjectUrl } = setup();
    await engine.play();
    engine.load(STEPS, { loop: false, rate: 1 });
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:stream-1');
    await flush();
    engine.destroy();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:stream-2');
  });

  it('tolerates a seek readback slightly below the target', async () => {
    const { audio, engine } = setup();
    await flush();
    engine.nextCard();
    audio.at(5 - 0.00002);
    expect(engine.getState().cardIndex).toBe(1);
    engine.nextCard();
    expect(engine.getState().finished).toBe(true);
  });

  it('nextCard from a card-1 readback below target reaches the next card', async () => {
    const { audio, engine } = setup();
    await flush();
    engine.nextCard();
    audio.at(5 - 0.00002);
    engine.prevCard();
    expect(engine.getState().cardIndex).toBe(0);
    engine.nextCard();
    audio.at(5 - 0.00002);
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4 });
  });

  it('sets audio.loop from load and setLoop', async () => {
    const { audio, engine } = setup({ loop: true });
    expect(audio.loop).toBe(true);
    engine.setLoop(false);
    expect(audio.loop).toBe(false);
    engine.setLoop(true);
    expect(audio.loop).toBe(true);
  });

  it('with native loop, timeupdate after the wrap maps back to card 0', async () => {
    const { audio, session, engine } = setup({ loop: true });
    await engine.play();
    audio.at(9.9);
    expect(session.metadata).toMatchObject({ title: 'card 1' });
    audio.at(0.1);
    expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0 });
    expect(session.metadata).toMatchObject({ title: 'card 0' });
    expect(audio.played).toBe(1);
  });

  it('nextCard onto a card whose first step has zero length lands on the sounding step', async () => {
    const audio = new FakeAudio();
    const steps: Step[] = [a('a1', 0), a('a2', 1), a('b1', 1, 'back')];
    const engine = new AudioEngine({
      audio, mediaSession: null,
      resolve: async u => `blob:${u}`,
      readBytes: async u => new Uint8Array(u === 'blob:a2' ? 0 : SECONDS[u.slice(5)] * 6000).buffer,
      makeObjectUrl: () => 'blob:s', revokeObjectUrl: () => {},
    });
    engine.load(steps, { loop: false, rate: 1 });
    await flush();
    engine.nextCard();
    expect(audio.currentTime).toBe(1);
    audio.at(1);
    expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 2 });
  });

  it('prevCard from the finished state returns to the previous card', async () => {
    const { audio, engine } = setup();
    await engine.play();
    engine.nextCard();
    engine.nextCard();
    expect(engine.getState().finished).toBe(true);
    engine.prevCard();
    expect(engine.getState()).toMatchObject({ cardIndex: 0, finished: false });
    expect(audio.currentTime).toBe(0);
  });

  describe('soft pause', () => {
    it('pause while playing mutes instead of pausing the element', async () => {
      const { audio, session, engine, setTimer } = setup();
      await engine.play();
      audio.at(2.5);
      engine.pause();
      expect(audio.muted).toBe(true);
      expect(audio.pauses).toBe(1);                         // только из load()
      expect(audio.paused).toBe(false);
      expect(audio.played).toBe(1);
      expect(audio.loop).toBe(true);
      expect(engine.getState().playing).toBe(false);
      expect(session.playbackState).toBe('paused');
      expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
    });

    it('timeupdate during soft pause does not move the position', async () => {
      const { audio, session, engine } = setup();
      await engine.play();
      audio.at(0.5);
      engine.pause();
      audio.at(5.5);
      audio.at(9.5);
      expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0 });
      expect(session.metadata).toMatchObject({ title: 'card 0' });
      expect(session.playbackState).toBe('paused');
    });

    it('play after soft pause returns to the paused position and unmutes', async () => {
      const { audio, engine, timers } = setup();
      await engine.play();
      audio.at(2.5);
      engine.pause();
      audio.at(7);
      await engine.play();
      expect(audio.currentTime).toBe(2.5);
      expect(audio.muted).toBe(true);                       // молчим, пока перемотка не завершилась
      expect(audio.loop).toBe(false);
      expect(audio.played).toBe(1);
      expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 2 });
      audio.fire('seeked');
      expect(audio.muted).toBe(false);
      expect(timers.pending.size).toBe(0);
    });

    it('unmutes after resume even if seeked never arrives', async () => {
      const { audio, engine, timers, setTimer } = setup();
      await engine.play();
      engine.pause();
      await engine.play();
      expect(audio.muted).toBe(true);
      expect(setTimer).toHaveBeenLastCalledWith(expect.any(Function), 300);
      timers.runAll();
      expect(audio.muted).toBe(false);
      expect(engine.getState().playing).toBe(true);
    });

    it('pausing again before the resume unmute keeps the element muted', async () => {
      const { audio, engine, timers } = setup();
      await engine.play();
      audio.at(2.5);
      engine.pause();
      await engine.play();
      engine.pause();
      audio.fire('seeked');
      expect(audio.muted).toBe(true);
      expect(timers.pending.size).toBe(1);                  // только лимит мягкой паузы
      timers.runAll();
      expect(audio.muted).toBe(false);
      expect(audio.paused).toBe(true);
      expect(audio.currentTime).toBe(2.5);
    });

    it('media session pause during soft pause resumes playback', async () => {
      const { audio, session, engine } = setup();
      await engine.play();
      audio.at(2.5);
      session.handlers.pause!();
      expect(engine.getState().playing).toBe(false);
      expect(audio.muted).toBe(true);
      audio.at(6);
      session.handlers.pause!(); await flush();
      expect(engine.getState().playing).toBe(true);
      expect(session.playbackState).toBe('playing');
      expect(audio.currentTime).toBe(2.5);
      audio.fire('seeked');
      expect(audio.muted).toBe(false);
    });

    it('nextCard during soft pause moves the saved position to that card', async () => {
      const { audio, engine } = setup();
      await engine.play();
      audio.at(0.5);
      engine.pause();
      audio.at(1.5);
      engine.nextCard();
      expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4, playing: false });
      expect(audio.muted).toBe(true);
      audio.at(2);
      await engine.play();
      expect(audio.currentTime).toBe(5);
      expect(engine.getState()).toMatchObject({ cardIndex: 1, stepIndex: 4, playing: true });
    });

    it('prevCard during soft pause moves the saved position to the previous card', async () => {
      const { audio, engine } = setup();
      await engine.play();
      audio.at(5.5);
      engine.pause();
      audio.at(8);
      engine.prevCard();
      expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0, playing: false });
      expect(audio.currentTime).toBe(8);                    // элемент не перематывается до play()
      await engine.play();
      expect(audio.currentTime).toBe(0);
      expect(engine.getState()).toMatchObject({ cardIndex: 0, stepIndex: 0, playing: true });
    });

    it('nextCard during soft pause then the limit leaves the element at the new card', async () => {
      const { audio, engine, timers } = setup();
      await engine.play();
      audio.at(0.5);
      engine.pause();
      engine.nextCard();
      audio.at(3);
      timers.runAll();
      expect(audio.paused).toBe(true);
      expect(audio.currentTime).toBe(5);
      expect(audio.muted).toBe(false);
    });

    it('element error during soft pause turns it into a real pause', async () => {
      const { audio, engine, onError, timers } = setup();
      await engine.play();
      audio.at(2.5);
      engine.pause();
      audio.at(4);
      audio.fire('error');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(audio.paused).toBe(true);
      expect(audio.muted).toBe(false);
      expect(audio.currentTime).toBe(2.5);
      expect(timers.pending.size).toBe(0);
      expect(engine.getState().playing).toBe(false);
    });

    it('the time limit turns the soft pause into a real one', async () => {
      const { audio, engine, timers } = setup({ loop: true });
      await engine.play();
      audio.at(2.5);
      engine.pause();
      audio.at(8);
      timers.runAll();
      expect(audio.paused).toBe(true);
      expect(audio.currentTime).toBe(2.5);
      expect(audio.muted).toBe(false);
      expect(audio.loop).toBe(true);
      await engine.play();
      expect(audio.played).toBe(2);
      expect(audio.currentTime).toBe(2.5);
      expect(audio.muted).toBe(false);
      expect(engine.getState()).toMatchObject({ playing: true, stepIndex: 2 });
    });

    it('pause before playback starts is a plain pause', async () => {
      const { audio, engine, setTimer } = setup();
      await flush();
      engine.pause();
      expect(audio.muted).toBe(false);
      expect(audio.pauses).toBe(2);
      expect(setTimer).not.toHaveBeenCalled();
    });

    it('setLoop during soft pause keeps the element looping until resume', async () => {
      const { audio, engine } = setup();
      await engine.play();
      engine.pause();
      engine.setLoop(false);
      expect(audio.loop).toBe(true);
      engine.setLoop(true);
      await engine.play();
      expect(audio.loop).toBe(true);
    });

    it('load while waiting for the resume unmute unmutes and drops the fallback timer', async () => {
      const { audio, engine, timers } = setup();
      await engine.play();
      engine.pause();
      await engine.play();
      expect(audio.muted).toBe(true);
      engine.load(STEPS, { loop: false, rate: 1 });
      expect(audio.muted).toBe(false);
      expect(timers.pending.size).toBe(0);
    });

    it('load and destroy during soft pause unmute and drop the timer', async () => {
      const { audio, engine, timers } = setup({ loop: true });
      await engine.play();
      engine.pause();
      engine.load(STEPS, { loop: false, rate: 1 });
      expect(audio.muted).toBe(false);
      expect(audio.loop).toBe(false);
      expect(timers.pending.size).toBe(0);
      await engine.play();
      engine.pause();
      expect(audio.muted).toBe(true);
      engine.destroy();
      expect(audio.muted).toBe(false);
      expect(audio.paused).toBe(true);
      expect(audio.loop).toBe(false);
      expect(timers.pending.size).toBe(0);
    });
  });
});
