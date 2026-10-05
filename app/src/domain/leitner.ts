import type { Progress } from '../types';
import { addDays } from './dates';

export const INTERVALS: readonly number[] = [0, 1, 3, 7, 14, 30];
export const MAX_BOX = 5;

export type Answer = 'know' | 'again';
export type Bucket = 'new' | 'learning' | 'learned';

export function newProgress(profileId: string, cardId: string): Progress {
  return { profileId, cardId, box: 0, nextDue: null, lastSeen: null, starred: false };
}

export function applyAnswer(p: Progress, answer: Answer, today: string): Progress {
  if (answer === 'again') {
    return { ...p, box: 1, nextDue: addDays(today, INTERVALS[1]), lastSeen: today };
  }
  const box = Math.min(p.box + 1, MAX_BOX);
  return { ...p, box, nextDue: addDays(today, INTERVALS[box]), lastSeen: today, starred: false };
}

export function markStarred(p: Progress, today: string): Progress {
  return { ...applyAnswer(p, 'again', today), starred: true };
}

export function markSeen(p: Progress, today: string): Progress {
  return { ...p, lastSeen: today };
}

export function isDue(p: Progress | undefined, today: string): boolean {
  return !!p && p.box >= 1 && p.nextDue !== null && p.nextDue <= today;
}

export function bucket(p: Progress | undefined): Bucket {
  if (!p || p.box === 0) return 'new';
  return p.box >= MAX_BOX ? 'learned' : 'learning';
}
