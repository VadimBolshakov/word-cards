// Временный журнал для диагностики фонового аудио на iPhone. Удаляется вместе с прототипом.
const KEY = 'word-cards:debug-log';
const MAX = 500;

export interface LogEntry { t: string; msg: string }

let entries: LogEntry[] = load();
const listeners = new Set<(e: LogEntry[]) => void>();

function load(): LogEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function log(msg: string): void {
  const d = new Date();
  const t = `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  entries = [...entries, { t, msg }].slice(-MAX);
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* ignore */ }
  listeners.forEach(fn => fn(entries));
}

export function clearLog(): void {
  entries = [];
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach(fn => fn(entries));
}

export function subscribeLog(fn: (e: LogEntry[]) => void): () => void {
  listeners.add(fn);
  fn(entries);
  return () => listeners.delete(fn);
}

/** Аудиоэлемент, все события и вызовы play() которого пишутся в журнал. */
export function instrumentedAudio(): HTMLAudioElement {
  const audio = new Audio();
  const short = () => audio.src.slice(-8);
  for (const type of ['playing', 'pause', 'ended', 'error', 'stalled']) {
    audio.addEventListener(type, () =>
      log(`audio:${type} src=${short()} t=${audio.currentTime.toFixed(1)} paused=${audio.paused}`));
  }
  const origPlay = audio.play.bind(audio);
  audio.play = () => {
    log(`audio.play() src=${short()}`);
    const p = origPlay();
    p.then(() => log('audio.play() ok'), (e: unknown) =>
      log(`audio.play() REJECTED ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`));
    return p;
  };
  return audio;
}

/** Оборачивает обработчики Media Session, чтобы видеть, какие команды приходят с экрана блокировки. */
export function instrumentMediaSession(): void {
  if (!('mediaSession' in navigator)) {
    log('mediaSession: НЕ поддерживается');
    return;
  }
  const ms = navigator.mediaSession;
  const orig = ms.setActionHandler.bind(ms);
  ms.setActionHandler = (action, handler) => {
    log(`mediaSession.setActionHandler(${action}, ${handler ? 'fn' : 'null'})`);
    orig(action, handler ? details => { log(`MS action: ${action}`); handler(details); } : null);
  };
  for (const type of ['visibilitychange', 'pagehide', 'pageshow', 'freeze', 'resume']) {
    document.addEventListener(type, () => log(`doc:${type} visibility=${document.visibilityState}`));
    window.addEventListener(type, () => log(`win:${type}`));
  }
  log(`start: standalone=${matchMedia('(display-mode: standalone)').matches} ua=${navigator.userAgent.slice(0, 60)}`);
}
