import { cardStartStep, type Side, type Step } from '../domain/sequence';

export interface AudioLike {
  src: string;
  playbackRate: number;
  currentTime: number;
  loop: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error' | 'timeupdate', listener: () => void): void;
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
  readBytes?: (url: string) => Promise<ArrayBuffer>;
  makeObjectUrl?: (b: Blob) => string;
  revokeObjectUrl?: (u: string) => void;
  audio?: AudioLike;
  mediaSession?: MediaSessionLike | null;
  describeCard?: (cardIndex: number) => { title: string; artist: string };
  onError?: (message: string) => void;
}

export const NO_AUDIO_MESSAGE = 'Нет звука для карточки — скачайте набор для офлайна';

// Все mp3 набора — MPEG-2 Layer III, CBR 48 кбит/с без заголовков ID3/Xing:
// 48000 бит/с = 6000 байт/с, поэтому длительность файла = байты / 6000,
// а склейка байтов файлов — корректный mp3-поток.
const BYTES_PER_SECOND = 6000;

// Safari может вернуть currentTime чуть меньше выставленного; допуск меньше
// одного mp3-кадра (24 мс) с запасом, чтобы не откатываться на предыдущую карточку.
const SEEK_TOLERANCE_S = 0.03;

const defaultReadBytes = async (url: string): Promise<ArrayBuffer> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
};

// Media Session глобальна: handlers принадлежат последнему созданному движку.
let sessionOwner: AudioEngine | null = null;

/**
 * Играет весь сценарий как один mp3-blob, собранный при load() на переднем плане.
 * Дальше — только play/pause/currentTime одного загруженного элемента: в фоне iOS
 * не загружает новые источники, поэтому src меняется лишь при новой сборке.
 */
export class AudioEngine {
  private steps: Step[] = [];
  /** Начало каждого шага в потоке, секунды; последний элемент — длина потока. */
  private stepStart: number[] = [];
  private index = 0;
  private playing = false;
  private finished = false;
  private loop = false;
  private rate = 1;
  private token = 0;
  private playAttempt = 0;
  private streamUrl: string | null = null;
  private assembly: Promise<void> = Promise.resolve();
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
    this.audio.addEventListener('error', () => this.onAudioError());
    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    if (this.session) sessionOwner = this;
    this.session?.setActionHandler('play', () => void this.play());
    this.session?.setActionHandler('pause', () => this.pause());
    this.session?.setActionHandler('nexttrack', () => this.nextCard());
    this.session?.setActionHandler('previoustrack', () => this.prevCard());
  }

  load(steps: Step[], opts: { loop: boolean; rate: number }): void {
    this.audio.pause();
    this.token++;
    this.releaseStream();
    this.steps = steps;
    this.stepStart = [];
    this.loop = opts.loop;
    this.audio.loop = opts.loop;
    this.rate = opts.rate;
    this.index = 0;
    this.playing = false;
    this.finished = false;
    this.lastCard = -1;
    this.emit();
    this.assembly = steps.length > 0 ? this.assemble(this.token) : Promise.resolve();
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
    const token = this.token;
    const attempt = ++this.playAttempt;
    this.playing = true;
    this.emit();
    await this.assembly;
    if (token !== this.token || attempt !== this.playAttempt || !this.playing) return;
    if (!this.streamUrl) {
      this.finish();
      return;
    }
    if (this.finished) {
      this.audio.currentTime = 0;
      this.finished = false;
      this.index = this.stepAt(0);
      this.emit();
    }
    this.audio.playbackRate = this.rate;
    try {
      await this.audio.play();
    } catch {
      // Отказ play() (например, прерывание iOS) — это не отсутствие звука: просто пауза.
      if (attempt !== this.playAttempt) return;
      this.playing = false;
      this.emit();
    }
  }

  pause(): void {
    this.playAttempt++;
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

  // Скорость применяется ко всему потоку, включая паузы-тишину: принятое упрощение.
  setRate(rate: number): void {
    this.rate = rate;
    this.audio.playbackRate = rate;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    this.audio.loop = loop;
  }

  destroy(): void {
    this.token++;
    this.playing = false;
    this.audio.pause();
    this.releaseStream();
    this.listeners.clear();
    if (this.session && sessionOwner === this) {
      sessionOwner = null;
      for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) {
        this.session.setActionHandler(action, null);
      }
      this.session.playbackState = 'none';
    }
  }

  private async assemble(token: number): Promise<void> {
    const readBytes = this.opts.readBytes ?? defaultReadBytes;
    const cache = new Map<string, Promise<ArrayBuffer | null>>();
    const read = (url: string) => {
      let bytes = cache.get(url);
      if (!bytes) {
        bytes = this.opts.resolve(url).then(readBytes).catch(() => null);
        cache.set(url, bytes);
      }
      return bytes;
    };
    const buffers = await Promise.all(this.steps.map(step => read(step.url)));
    if (token !== this.token) return;

    // Шаг без звука получает нулевую длительность: stepStart[i] === stepStart[i + 1].
    const starts = [0];
    let total = 0;
    for (const b of buffers) {
      total += b?.byteLength ?? 0;
      starts.push(total / BYTES_PER_SECOND);
    }
    if (buffers.includes(null) || total === 0) this.opts.onError?.(NO_AUDIO_MESSAGE);
    if (total === 0) {
      this.finish();
      return;
    }
    const parts = buffers.filter((b): b is ArrayBuffer => b !== null);
    this.stepStart = starts;
    this.streamUrl = (this.opts.makeObjectUrl ?? (b => URL.createObjectURL(b)))(
      new Blob(parts, { type: 'audio/mpeg' }));
    this.audio.src = this.streamUrl;
    this.audio.playbackRate = this.rate;
    this.index = this.stepAt(0);
    this.emit();
  }

  private releaseStream(): void {
    if (!this.streamUrl) return;
    (this.opts.revokeObjectUrl ?? (u => URL.revokeObjectURL(u)))(this.streamUrl);
    this.streamUrl = null;
  }

  /** Шаг, звучащий в момент t потока; шаги нулевой длительности пропускаются. */
  private stepAt(t: number): number {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.stepStart[i] <= t && this.stepStart[i + 1] > this.stepStart[i]) return i;
    }
    return 0;
  }

  private goToCard(cardIndex: number): void {
    if (!this.streamUrl) return;
    let start = cardStartStep(this.steps, cardIndex);
    if (start === -1) {
      if (!this.loop) {
        this.finish();
        return;
      }
      start = 0;
    }
    this.audio.currentTime = this.stepStart[start];
    this.index = start;
    this.finished = false;
    this.emit();
  }

  private onTimeUpdate(): void {
    if (!this.streamUrl) return;
    const i = this.stepAt(this.audio.currentTime + SEEK_TOLERANCE_S);
    if (i === this.index) return;
    this.index = i;
    this.emit();
  }

  // При audio.loop элемент сам переходит в начало и ended не приходит; ветка ниже — страховка.
  private onEnded(): void {
    if (!this.loop) {
      this.finish();
      return;
    }
    this.audio.currentTime = 0;
    this.index = this.stepAt(0);
    this.emit();
    if (this.playing) {
      const attempt = this.playAttempt;
      this.audio.play().catch(() => {
        if (attempt !== this.playAttempt) return;
        this.playing = false;
        this.emit();
      });
    }
  }

  private onAudioError(): void {
    if (!this.streamUrl) return;
    this.playing = false;
    this.opts.onError?.(NO_AUDIO_MESSAGE);
    this.emit();
  }

  private finish(): void {
    this.playing = false;
    this.finished = true;
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
