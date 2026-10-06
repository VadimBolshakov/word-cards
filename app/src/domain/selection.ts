import type { Card, CardOrder, Progress } from '../types';
import { isDue } from './leitner';

export type SetMode = 'all' | 'newAndHard';
export type ProgressMap = Map<string, Progress>;

export function selectForSet(cards: Card[], setN: number, mode: SetMode, progress: ProgressMap): Card[] {
  const inSet = cards.filter(c => c.set === setN);
  if (mode === 'all') return inSet;
  return inSet.filter(c => (progress.get(c.id)?.box ?? 0) <= 2);
}

export function selectDue(cards: Card[], progress: ProgressMap, today: string): Card[] {
  return cards.filter(c => isDue(progress.get(c.id), today));
}

export const DUE_SESSION_LIMIT = 50;

/** Due cards, most overdue first (stable for ties; no progress = oldest), capped at `limit`. */
export function selectDueSession(cards: Card[], progress: ProgressMap, today: string, limit = DUE_SESSION_LIMIT): Card[] {
  const key = (c: Card) => progress.get(c.id)?.nextDue ?? '';
  return selectDue(cards, progress, today)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (key(a.c) < key(b.c) ? -1 : key(a.c) > key(b.c) ? 1 : a.i - b.i))
    .slice(0, limit)
    .map(x => x.c);
}

export function orderCards(cards: Card[], order: CardOrder, random: () => number = Math.random): Card[] {
  const result = [...cards];
  if (order === 'seq') return result;
  // Fisher–Yates
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
