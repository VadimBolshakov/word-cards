import { describe, expect, it } from 'vitest';
import { applyAnswer, bucket, isDue, markSeen, markStarred, newProgress } from './leitner';

const T = '2026-10-05';

describe('leitner', () => {
  it('creates new progress in box 0', () => {
    expect(newProgress('p', 'c')).toEqual({
      profileId: 'p', cardId: 'c', box: 0, nextDue: null, lastSeen: null, starred: false,
    });
  });

  it('know moves up a box with matching interval', () => {
    let p = newProgress('p', 'c');
    const expected = [[1, '2026-10-06'], [2, '2026-10-08'], [3, '2026-10-12'],
      [4, '2026-10-19'], [5, '2026-11-04'], [5, '2026-11-04']] as const;
    for (const [box, due] of expected) {
      p = applyAnswer(p, 'know', T);
      expect([p.box, p.nextDue, p.lastSeen]).toEqual([box, due, T]);
    }
  });

  it('again resets to box 1 due tomorrow', () => {
    const p = applyAnswer({ ...newProgress('p', 'c'), box: 4 }, 'again', T);
    expect([p.box, p.nextDue]).toEqual([1, '2026-10-06']);
  });

  it('star behaves like again and sets starred; know clears it', () => {
    const s = markStarred({ ...newProgress('p', 'c'), box: 3 }, T);
    expect([s.box, s.nextDue, s.starred]).toEqual([1, '2026-10-06', true]);
    expect(applyAnswer(s, 'know', T).starred).toBe(false);
  });

  it('markSeen only updates lastSeen', () => {
    const p = { ...newProgress('p', 'c'), box: 2, nextDue: '2026-10-07' };
    expect(markSeen(p, T)).toEqual({ ...p, lastSeen: T });
  });

  it('does not mutate input', () => {
    const p = newProgress('p', 'c');
    applyAnswer(p, 'know', T);
    expect(p.box).toBe(0);
  });

  it('isDue only for boxes 1-5 with nextDue <= today', () => {
    expect(isDue(undefined, T)).toBe(false);
    expect(isDue(newProgress('p', 'c'), T)).toBe(false);
    expect(isDue({ ...newProgress('p', 'c'), box: 1, nextDue: T }, T)).toBe(true);
    expect(isDue({ ...newProgress('p', 'c'), box: 2, nextDue: '2026-10-04' }, T)).toBe(true);
    expect(isDue({ ...newProgress('p', 'c'), box: 2, nextDue: '2026-10-06' }, T)).toBe(false);
  });

  it('bucket', () => {
    expect(bucket(undefined)).toBe('new');
    expect(bucket({ ...newProgress('p', 'c'), box: 0 })).toBe('new');
    expect(bucket({ ...newProgress('p', 'c'), box: 1 })).toBe('learning');
    expect(bucket({ ...newProgress('p', 'c'), box: 4 })).toBe('learning');
    expect(bucket({ ...newProgress('p', 'c'), box: 5 })).toBe('learned');
  });
});
