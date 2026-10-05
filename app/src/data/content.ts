import { silenceUrl } from '../domain/sequence';
import type { Card, ContentIndex, TopicContent } from '../types';

const SILENCE_SECONDS = [1, 3, 5, 8, 10];

export function contentUrl(rel: string): string {
  return `${import.meta.env.BASE_URL}content/${rel}`;
}

async function getJson<T>(rel: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(contentUrl(rel), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Не удалось загрузить ${rel}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function loadIndex(fetcher: typeof fetch = fetch): Promise<ContentIndex> {
  return getJson<ContentIndex>('index.json', fetcher);
}

export function loadTopic(id: string, fetcher: typeof fetch = fetch): Promise<TopicContent> {
  return getJson<TopicContent>(`topics/${id}.json`, fetcher);
}

export async function loadAllCards(index: ContentIndex, fetcher: typeof fetch = fetch): Promise<Card[]> {
  const topics = await Promise.all(index.topics.map(t => loadTopic(t.id, fetcher)));
  return topics.flatMap(t => t.cards);
}

export function audioUrlsFor(cards: Card[]): string[] {
  const urls = new Set<string>();
  for (const c of cards) {
    urls.add(c.enAudio);
    urls.add(c.ruAudio);
  }
  SILENCE_SECONDS.forEach(s => urls.add(silenceUrl(s)));
  return [...urls];
}
