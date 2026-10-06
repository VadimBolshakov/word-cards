import { describe, expect, it } from 'vitest';
import type { Card, Progress } from '../types';
import { orderCards, selectDue, selectDueSession, selectForSet, type ProgressMap } from './selection';

const card = (id: string, set = 1): Card =>
  ({ id, set, en: id, ru: id, enEx: '', ruEx: '', enAudio: `audio/${id}e.mp3`, ruAudio: `audio/${id}r.mp3` });
const prog = (cardId: string, box: number, nextDue: string | null = null): Progress =>
  ({ profileId: 'p', cardId, box, nextDue, lastSeen: null, starred: false });

const cards = [card('a'), card('b'), card('c'), card('d'), card('e', 2)];
const progress: ProgressMap = new Map([
  ['b', prog('b', 2, '2026-10-01')],
  ['c', prog('c', 3, '2026-10-05')],
  ['d', prog('d', 5, '2026-11-01')],
]);

describe('selection', () => {
  it('all cards of a set in original order', () => {
    expect(selectForSet(cards, 1, 'all', progress).map(c => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('new and hard = boxes 0-2', () => {
    expect(selectForSet(cards, 1, 'newAndHard', progress).map(c => c.id)).toEqual(['a', 'b']);
  });

  it('due across all cards', () => {
    expect(selectDue(cards, progress, '2026-10-05').map(c => c.id)).toEqual(['b', 'c']);
  });

  it('seq keeps order, shuffle permutes deterministically with injected random', () => {
    expect(orderCards(cards, 'seq')).toEqual(cards);
    expect(orderCards(cards, 'seq')).not.toBe(cards);
    const shuffled = orderCards(cards, 'shuffle', () => 0);
    expect(shuffled.map(c => c.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shuffled.map(c => c.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(cards.map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('selectDueSession: most overdue first, ties keep order, capped', () => {
    const cs = [card('a'), card('b'), card('c'), card('d')];
    const pr: ProgressMap = new Map([
      ['a', prog('a', 1, '2026-10-04')],
      ['b', prog('b', 1, '2026-10-01')],
      ['c', prog('c', 1, '2026-10-04')],
      ['d', prog('d', 1, '2026-12-01')],
    ]);
    expect(selectDueSession(cs, pr, '2026-10-05').map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(selectDueSession(cs, pr, '2026-10-05', 2).map(c => c.id)).toEqual(['b', 'a']);
  });
});
