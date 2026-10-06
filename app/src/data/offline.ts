import { contentUrl } from './content';

export const AUDIO_CACHE = 'audio-v1';
const MAX_BLOB_URLS = 30;

export class OfflineError extends Error {
  constructor(public readonly reason: 'quota' | 'network') {
    super(reason === 'quota'
      ? 'Не хватает места на телефоне для скачивания набора'
      : 'Не удалось скачать набор — проверьте интернет');
  }
}

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

export class AudioStore {
  private blobUrls = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();

  constructor(
    private readonly openCache: () => Promise<CacheLike>,
    private readonly fetcher: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args),
    private readonly makeUrl: (b: Blob) => string = b => URL.createObjectURL(b),
    private readonly revoke: (u: string) => void = u => URL.revokeObjectURL(u),
  ) {}

  resolve(rel: string): Promise<string> {
    const known = this.blobUrls.get(rel);
    if (known) {
      // refresh recency: Map iterates in insertion order, so re-insert as most recent
      this.blobUrls.delete(rel);
      this.blobUrls.set(rel, known);
      return Promise.resolve(known);
    }
    const inFlight = this.pending.get(rel);
    if (inFlight) return inFlight;
    const p = this.load(rel).finally(() => this.pending.delete(rel));
    this.pending.set(rel, p);
    return p;
  }

  /** Raw bytes without creating a blob URL (safe for big sets: nothing to revoke). */
  async readBytes(rel: string): Promise<ArrayBuffer> {
    const abs = contentUrl(rel);
    const cache = await this.openCache();
    let res = await cache.match(abs);
    if (!res) {
      res = await this.fetcher(abs);
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${rel}`);
    }
    return res.arrayBuffer();
  }

  private async load(rel: string): Promise<string> {
    const abs = contentUrl(rel);
    const cache = await this.openCache();
    let res = await cache.match(abs);
    if (!res) {
      res = await this.fetcher(abs);
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${rel}`);
    }
    const url = this.makeUrl(await res.blob());
    this.blobUrls.set(rel, url);
    if (this.blobUrls.size > MAX_BLOB_URLS) {
      const [oldestKey, oldestUrl] = this.blobUrls.entries().next().value!;
      this.blobUrls.delete(oldestKey);
      this.revoke(oldestUrl);
    }
    return url;
  }

  async download(rels: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const cache = await this.openCache();
    const added: string[] = [];
    let done = 0;
    try {
      for (const rel of rels) {
        const abs = contentUrl(rel);
        if (!(await cache.match(abs))) {
          let res: Response;
          try {
            res = await this.fetcher(abs);
          } catch {
            throw new OfflineError('network');
          }
          if (!res.ok) throw new OfflineError('network');
          await cache.put(abs, res);
          added.push(abs);
        }
        onProgress?.(++done, rels.length);
      }
    } catch (e) {
      await Promise.all(added.map(a => cache.delete(a)));
      if (e instanceof DOMException && e.name === 'QuotaExceededError') throw new OfflineError('quota');
      throw e;
    }
  }

  async isDownloaded(rels: string[]): Promise<boolean> {
    const cache = await this.openCache();
    for (const rel of rels) {
      if (!(await cache.match(contentUrl(rel)))) return false;
    }
    return true;
  }
}

export const audioStore = new AudioStore(() => caches.open(AUDIO_CACHE));
