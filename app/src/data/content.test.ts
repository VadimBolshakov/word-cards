import { describe, expect, it } from 'vitest';
import type { Card, ContentIndex } from '../types';
import { audioUrlsFor, contentUrl, loadAllCards, loadIndex } from './content';

const json = (data: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(data), { status }));

describe('content', () => {
  it('builds urls from base', () => {
    expect(contentUrl('index.json')).toBe('/content/index.json');
  });

  it('loads index and throws on http error', async () => {
    const index: ContentIndex = { contentVersion: 'v', topics: [] };
    await expect(loadIndex(() => json(index))).resolves.toEqual(index);
    await expect(loadIndex(() => json({}, 404))).rejects.toThrow('404');
  });

  it('loads cards of all topics', async () => {
    const index = { contentVersion: 'v', topics: [{ id: 'a' }, { id: 'b' }] } as ContentIndex;
    const fetcher = (url: RequestInfo | URL) =>
      json({ id: String(url).includes('/a.json') ? 'a' : 'b', cards: [{ id: String(url).slice(-6, -5) }] });
    const cards = await loadAllCards(index, fetcher as typeof fetch);
    expect(cards.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('collects unique audio urls plus silence', () => {
    const c = (id: string, en: string): Card =>
      ({ id, set: 1, en: id, ru: id, enEx: '', ruEx: '', enAudio: en, ruAudio: `audio/${id}r.mp3` });
    const urls = audioUrlsFor([c('x', 'audio/same.mp3'), c('y', 'audio/same.mp3')]);
    expect(urls).toEqual([
      'audio/same.mp3', 'audio/xr.mp3', 'audio/yr.mp3',
      'audio/silence_1s.mp3', 'audio/silence_3s.mp3', 'audio/silence_5s.mp3',
      'audio/silence_8s.mp3', 'audio/silence_10s.mp3',
    ]);
  });
});
