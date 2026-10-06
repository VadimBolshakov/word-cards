import { cardStartStep, type Side, type Step } from '../domain/sequence';

export interface AudioLike {
  src: string;
  playbackRate: number;
  currentTime: number;
  loop: boolean;
  muted: boolean;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(
    type: 'ended' | 'error' | 'timeupdate' | 'seeked' | 'pause' | 'play',
    listener: () => void,
  ): void;
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
  /** Поток собран (или собирать нечего); до этого ▶ на iOS может потерять жест пользователя. */
  ready: boolean;
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
  /** Через сколько мягкая пауза становится настоящей. */
  softPauseLimitMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export const NO_AUDIO_MESSAGE = 'Нет звука для карточки — скачайте набор для офлайна';

// Все mp3 набора — MPEG-2 Layer III, CBR 48 кбит/с без заголовков ID3/Xing:
// 48000 бит/с = 6000 байт/с, поэтому длительность файла = байты / 6000,
// а склейка байтов файлов — корректный mp3-поток.
const BYTES_PER_SECOND = 6000;

// Safari может вернуть currentTime чуть меньше выставленного; допуск меньше
// одного mp3-кадра (24 мс) с запасом, чтобы не откатываться на предыдущую карточку.
const SEEK_TOLERANCE_S = 0.03;

const SOFT_PAUSE_LIMIT_MS = 10 * 60 * 1000;

// Если 'seeked' после перемотки при продолжении не пришёл — снять muted всё равно.
const UNMUTE_FALLBACK_MS = 300;

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
  private ready = false;
  /** Движок сам поставил элемент на паузу и ждёт его событие 'pause' — это не системная пауза. */
  private selfPause = false;
  /**
   * Позиция «мягкой паузы» или null. На iOS настоящая пауза в фоне гасит аудиосессию,
   * и play с экрана блокировки уже не звучит. Поэтому пауза глушит элемент, а он
   * продолжает играть беззвучно; позиция для пользователя заморожена здесь.
   * Настоящей пауза становится только по лимиту softPauseLimitMs.
   */
  private softPos: number | null = null;
  private softTimer: unknown = null;
  /** Таймер-страховка снятия muted после продолжения; не null, пока ждём 'seeked'. */
  private unmuteTimer: unknown = null;
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
    this.audio.addEventListener('seeked', () => this.unmuteAfterSeek());
    this.audio.addEventListener('pause', () => this.onElementPause());
    this.audio.addEventListener('play', () => this.onElementPlay());
    if (this.session) sessionOwner = this;
    this.session?.setActionHandler('play', () => void this.play());
    // iOS может показывать ⏸, пока элемент беззвучно играет: тогда «пауза» означает продолжить.
    this.session?.setActionHandler('pause', () => {
      if (this.softPos !== null) void this.play();
      else this.pause();
    });
    this.session?.setActionHandler('nexttrack', () => this.nextCard());
    this.session?.setActionHandler('previoustrack', () => this.prevCard());
  }

  load(steps: Step[], opts: { loop: boolean; rate: number }): void {
    this.pauseElement();
    this.clearSoftPause();
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
    this.ready = steps.length === 0;
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
      ready: this.ready,
    };
  }

  async play(): Promise<void> {
    if (this.steps.length === 0) return;
    if (this.softPos !== null) return this.resumeSoftPause();
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
    await this.startElement(attempt);
  }

  pause(): void {
    this.playAttempt++;
    if (this.playing && this.streamUrl && this.softPos === null) {
      this.cancelUnmute();
      this.softPos = this.audio.currentTime;
      this.audio.muted = true;
      this.audio.loop = true;              // конец потока не должен вызвать ended/finish
      this.softTimer = this.setTimer(() => this.hardenPause(), this.opts.softPauseLimitMs ?? SOFT_PAUSE_LIMIT_MS);
    } else if (this.softPos === null) {
      this.pauseElement();
    }
    this.playing = false;
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
    if (this.softPos === null) this.audio.loop = loop;
  }

  destroy(): void {
    this.token++;
    this.playing = false;
    this.pauseElement();
    this.clearSoftPause();
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
    this.ready = true;
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

  /** Перемотка идёт ещё беззвучно; muted снимается по 'seeked' (или по таймеру), без «щелчка». */
  private async resumeSoftPause(): Promise<void> {
    const attempt = ++this.playAttempt;
    this.audio.currentTime = this.softPos!;
    this.endSoftPause();
    this.unmuteTimer = this.setTimer(() => this.unmuteAfterSeek(), UNMUTE_FALLBACK_MS);
    this.playing = true;
    this.emit();
    if (this.audio.paused) await this.startElement(attempt);
  }

  private async startElement(attempt: number): Promise<void> {
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

  /** Мягкая пауза → настоящая: элемент на паузе в запомненной позиции. */
  private hardenPause(): void {
    if (this.softPos === null) return;
    const pos = this.softPos;
    this.pauseElement();
    this.clearSoftPause();
    this.audio.currentTime = pos;
  }

  /** Снять мягкую паузу (и ожидание снятия muted) и включить звук элемента. */
  private clearSoftPause(): void {
    this.cancelUnmute();
    this.endSoftPause();
    this.audio.muted = false;
  }

  /** Выйти из мягкой паузы, не трогая muted. */
  private endSoftPause(): void {
    if (this.softTimer !== null) {
      this.clearTimer(this.softTimer);
      this.softTimer = null;
    }
    if (this.softPos === null) return;
    this.softPos = null;
    this.audio.loop = this.loop;
  }

  private unmuteAfterSeek(): void {
    if (this.unmuteTimer === null) return;
    this.cancelUnmute();
    this.audio.muted = false;
  }

  private cancelUnmute(): void {
    if (this.unmuteTimer === null) return;
    this.clearTimer(this.unmuteTimer);
    this.unmuteTimer = null;
  }

  private setTimer(fn: () => void, ms: number): unknown {
    return (this.opts.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms);
  }

  private clearTimer(id: unknown): void {
    (this.opts.clearTimer ?? (i => clearTimeout(i as ReturnType<typeof setTimeout>)))(id);
  }

  /** Пауза элемента по воле движка: её событие 'pause' не считается системной паузой. */
  private pauseElement(): void {
    if (!this.audio.paused) this.selfPause = true;
    this.audio.pause();
  }

  /**
   * iOS сам ставит элемент на паузу (звонок, Siri, отключение наушников) — движок должен
   * это заметить, иначе UI и экран блокировки показывают «играет». При мягкой паузе
   * playing уже false: элемент перезапустится при продолжении (resumeSoftPause).
   */
  private onElementPause(): void {
    if (this.selfPause) {
      this.selfPause = false;
      return;
    }
    if (!this.playing || this.finished || !this.streamUrl) return;
    // Естественный конец потока: 'pause' приходит перед 'ended', остальное сделает onEnded.
    const end = this.stepStart[this.steps.length] ?? 0;
    if (this.audio.currentTime >= end - SEEK_TOLERANCE_S) return;
    this.playAttempt++;
    this.playing = false;
    this.emit();
  }

  /** Старт элемента не через движок (например, кнопка Bluetooth): состояние следует за элементом. */
  private onElementPlay(): void {
    this.selfPause = false;   // события идут по порядку: ожидаемая 'pause' уже пришла бы раньше
    if (this.playing || this.softPos !== null || !this.streamUrl) return;
    this.playing = true;
    this.finished = false;
    this.index = this.stepAt(this.audio.currentTime + SEEK_TOLERANCE_S);
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
    if (this.softPos !== null) this.softPos = this.stepStart[start];
    else this.audio.currentTime = this.stepStart[start];
    this.index = start;
    this.finished = false;
    this.emit();
  }

  private onTimeUpdate(): void {
    if (!this.streamUrl || this.softPos !== null) return;
    const i = this.stepAt(this.audio.currentTime + SEEK_TOLERANCE_S);
    if (i === this.index) return;
    this.index = i;
    this.emit();
  }

  // При audio.loop элемент сам переходит в начало и ended не приходит; ветка ниже — страховка.
  private onEnded(): void {
    if (this.softPos !== null) {
      // Страховка: беззвучное проигрывание не должно останавливаться.
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
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
    this.hardenPause();
    this.playing = false;
    this.opts.onError?.(NO_AUDIO_MESSAGE);
    this.emit();
  }

  private finish(): void {
    this.playing = false;
    this.finished = true;
    this.pauseElement();
    this.clearSoftPause();
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
