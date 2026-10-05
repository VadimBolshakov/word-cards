import { describe, expect, it, vi } from 'vitest';
import { AudioStore, OfflineError, type CacheLike } from './offline';

class MapCache implements CacheLike {
  store = new Map<string, Response>();
  failPutAfter = Infinity;
  async match(url: string) { return this.store.get(url)?.clone(); }
  async put(url: string, res: Response) {
    if (this.store.size >= this.failPutAfter) throw new DOMException('full', 'QuotaExceededError');
    this.store.set(url, res);
  }
  async delete(url: string) { return this.store.delete(url); }
}

function setup(failNetwork = false) {
  const cache = new MapCache();
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    failNetwork ? new Response('', { status: 503 }) : new Response(`data:${url}`));
  let n = 0;
  const store = new AudioStore(async () => cache, fetcher as typeof fetch, () => `blob:${++n}`, () => {});
  return { cache, fetcher, store };
}

describe('AudioStore', () => {
  it('resolve fetches from network and memoizes blob url', async () => {
    const { store, fetcher } = setup();
    const u1 = await store.resolve('audio/a.mp3');
    const u2 = await store.resolve('audio/a.mp3');
    expect(u1).toBe('blob:1');
    expect(u2).toBe(u1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/content/audio/a.mp3');
  });

  it('resolve prefers cache', async () => {
    const { store, cache, fetcher } = setup();
    await cache.put('/content/audio/a.mp3', new Response('cached'));
    await store.resolve('audio/a.mp3');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('resolve throws when network fails and not cached', async () => {
    const { store } = setup(true);
    await expect(store.resolve('audio/a.mp3')).rejects.toThrow();
  });

  it('download caches all and reports progress; isDownloaded', async () => {
    const { store } = setup();
    const progress: number[] = [];
    expect(await store.isDownloaded(['audio/a.mp3', 'audio/b.mp3'])).toBe(false);
    await store.download(['audio/a.mp3', 'audio/b.mp3'], done => progress.push(done));
    expect(progress).toEqual([1, 2]);
    expect(await store.isDownloaded(['audio/a.mp3', 'audio/b.mp3'])).toBe(true);
  });

  it('download on quota error removes what it added and throws quota', async () => {
    const { store, cache } = setup();
    await cache.put('/content/audio/old.mp3', new Response('x'));
    cache.failPutAfter = 2;
    const err = await store.download(['audio/a.mp3', 'audio/b.mp3']).catch(e => e);
    expect(err).toBeInstanceOf(OfflineError);
    expect(err.reason).toBe('quota');
    expect([...cache.store.keys()]).toEqual(['/content/audio/old.mp3']);
  });

  it('download on network error throws network', async () => {
    const { store } = setup(true);
    const err = await store.download(['audio/a.mp3']).catch(e => e);
    expect(err.reason).toBe('network');
  });

  it('resolve is a true LRU: a hit refreshes the entry so a hot url is not revoked', async () => {
    const cache = new MapCache();
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(`data:${url}`));
    const revoked: string[] = [];
    const urls = new Map<string, string>();
    let n = 0;
    const store = new AudioStore(async () => cache, fetcher as typeof fetch, () => `blob:${++n}`, u => revoked.push(u));
    const hot = await store.resolve('audio/hot.mp3');
    for (let i = 0; i < 29; i++) urls.set(`audio/o${i}.mp3`, await store.resolve(`audio/o${i}.mp3`));
    expect(await store.resolve('audio/hot.mp3')).toBe(hot);
    await store.resolve('audio/extra.mp3');
    expect(revoked).not.toContain(hot);
    expect(revoked).toEqual([urls.get('audio/o0.mp3')]);
  });

  it('download removes entries it added on a network failure midway', async () => {
    const cache = new MapCache();
    await cache.put('/content/audio/old.mp3', new Response('x'));
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('b.mp3') ? new Response('', { status: 503 }) : new Response(`data:${url}`));
    const store = new AudioStore(async () => cache, fetcher as typeof fetch, () => 'blob:x', () => {});
    const err = await store.download(['audio/a.mp3', 'audio/b.mp3']).catch(e => e);
    expect(err).toBeInstanceOf(OfflineError);
    expect(err.reason).toBe('network');
    expect([...cache.store.keys()]).toEqual(['/content/audio/old.mp3']);
  });

  it('concurrent resolve of the same rel shares one fetch and one url', async () => {
    const { store, fetcher } = setup();
    const [u1, u2] = await Promise.all([store.resolve('audio/a.mp3'), store.resolve('audio/a.mp3')]);
    expect(u2).toBe(u1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a rejected resolve does not poison later calls', async () => {
    const cache = new MapCache();
    let fail = true;
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      fail ? new Response('', { status: 503 }) : new Response(`data:${url}`));
    const store = new AudioStore(async () => cache, fetcher as typeof fetch, () => 'blob:ok', () => {});
    await expect(store.resolve('audio/a.mp3')).rejects.toThrow();
    fail = false;
    expect(await store.resolve('audio/a.mp3')).toBe('blob:ok');
  });
});
