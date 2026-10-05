import { cardStartStep, type Side, type Step } from '../domain/sequence';

export interface AudioLike {
  src: string;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(
    action: 'play' | 'pause' | 'nexttrack' | 'previoustrack',
    handler: (() => void) | null,
  ): void;
}

export interface EngineState {
  stepIndex: number;
  cardIndex: number;
  side: Side | null;
  playing: boolean;
  finished: boolean;
}

export interface EngineOptions {
  resolve: (url: string) => Promise<string>;
  audio?: AudioLike;
  mediaSession?: MediaSessionLike | null;
  describeCard?: (cardIndex: number) => { title: string; artist: string };
  onError?: (message: string) => void;
}

export const NO_AUDIO_MESSAGE = 'Нет звука для карточки — скачайте набор для офлайна';

export class AudioEngine {
  private steps: Step[] = [];
  private index = 0;
  private loadedIndex = -1;
  private playing = false;
  private finished = false;
  private loop = false;
  private rate = 1;
  private retried = false;
  private token = 0;
  private lastCard = -1;
  private listeners = new Set<(s: EngineState) => void>();
  private readonly audio: AudioLike;
  private readonly session: MediaSessionLike | null;

  constructor(private readonly opts: EngineOptions) {
    this.audio = opts.audio ?? new Audio();
    this.session = opts.mediaSession !== undefined
      ? opts.mediaSession
      : (typeof navigator !== 'undefined' && 'mediaSession' in navigator
        ? (navigator.mediaSession as unknown as MediaSessionLike) : null);
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('error', () => this.onStepError(this.token));
    this.session?.setActionHandler('play', () => void this.play());
    this.session?.setActionHandler('pause', () => this.pause());
    this.session?.setActionHandler('nexttrack', () => this.nextCard());
    this.session?.setActionHandler('previoustrack', () => this.prevCard());
  }

  load(steps: Step[], opts: { loop: boolean; rate: number }): void {
    this.audio.pause();
    this.token++;
    this.steps = steps;
    this.loop = opts.loop;
    this.rate = opts.rate;
    this.index = 0;
    this.loadedIndex = -1;
    this.playing = false;
    this.finished = false;
    this.retried = false;
    this.lastCard = -1;
    this.emit();
  }

  subscribe(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  getState(): EngineState {
    const step = this.steps[this.index];
    return {
      stepIndex: this.index,
      cardIndex: step?.cardIndex ?? 0,
      side: step?.kind === 'audio' ? step.side : null,
      playing: this.playing,
      finished: this.finished,
    };
  }

  async play(): Promise<void> {
    if (this.steps.length === 0) return;
    if (this.finished) {
      this.finished = false;
      this.index = 0;
      this.loadedIndex = -1;
    }
    this.playing = true;
    if (this.loadedIndex === this.index) {
      this.emit();
      try {
        await this.audio.play();
      } catch {
        this.onStepError(this.token);
      }
      return;
    }
    await this.playStep(this.index);
  }

  pause(): void {
    this.playing = false;
    this.audio.pause();
    this.emit();
  }

  nextCard(): void {
    this.goToCard(this.getState().cardIndex + 1);
  }

  prevCard(): void {
    this.goToCard(Math.max(this.getState().cardIndex - 1, 0));
  }

  setRate(rate: number): void {
    this.rate = rate;
    const step = this.steps[this.loadedIndex];
    if (step?.kind === 'audio') this.audio.playbackRate = rate;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  destroy(): void {
    this.token++;
    this.playing = false;
    this.audio.pause();
    this.listeners.clear();
    for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) {
      this.session?.setActionHandler(action, null);
    }
    if (this.session) this.session.playbackState = 'none';
  }

  private goToCard(cardIndex: number): void {
    let start = cardStartStep(this.steps, cardIndex);
    if (start === -1) {
      if (!this.loop) {
        this.finish();
        return;
      }
      start = 0;
    }
    this.retried = false;
    if (this.playing) {
      void this.playStep(start);
    } else {
      this.token++;
      this.index = start;
      this.loadedIndex = -1;
      this.finished = false;
      this.emit();
    }
  }

  private async playStep(i: number): Promise<void> {
    if (i >= this.steps.length) {
      if (!this.loop) {
        this.finish();
        return;
      }
      i = 0;
    }
    const token = ++this.token;
    this.index = i;
    this.emit();
    const step = this.steps[i];
    try {
      const src = await this.opts.resolve(step.url);
      if (token !== this.token) return;
      this.audio.src = src;
      this.audio.playbackRate = step.kind === 'audio' ? this.rate : 1;
      this.loadedIndex = i;
      await this.audio.play();
    } catch {
      this.onStepError(token);
      return;
    }
    const next = this.steps[i + 1];
    if (next) this.opts.resolve(next.url).catch(() => {});
  }

  private onEnded(): void {
    if (!this.playing) return;
    this.retried = false;
    void this.playStep(this.index + 1);
  }

  private onStepError(token: number): void {
    if (token !== this.token || !this.playing) return;
    if (!this.retried) {
      this.retried = true;
      void this.playStep(this.index);
      return;
    }
    this.retried = false;
    this.opts.onError?.(NO_AUDIO_MESSAGE);
    const nextStart = cardStartStep(this.steps, this.getState().cardIndex + 1);
    void this.playStep(nextStart === -1 ? this.steps.length : nextStart);
  }

  private finish(): void {
    this.token++;
    this.playing = false;
    this.finished = true;
    this.loadedIndex = -1;
    this.audio.pause();
    this.emit();
  }

  private emit(): void {
    const state = this.getState();
    if (this.session) {
      this.session.playbackState = state.playing ? 'playing' : 'paused';
      if (state.cardIndex !== this.lastCard && this.opts.describeCard && this.steps.length > 0) {
        this.lastCard = state.cardIndex;
        const info = this.opts.describeCard(state.cardIndex);
        const Meta = (globalThis as { MediaMetadata?: new (i: object) => unknown }).MediaMetadata;
        this.session.metadata = Meta ? new Meta(info) : info;
      }
    }
    this.listeners.forEach(fn => fn(state));
  }
}
