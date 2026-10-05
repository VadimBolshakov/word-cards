import { bucket } from '../../domain/leitner';
import type { ProgressMap } from '../../domain/selection';
import type { Card } from '../../types';

export function countBuckets(cards: Card[], progress: ProgressMap) {
  const counts = { new: 0, learning: 0, learned: 0 };
  for (const c of cards) counts[bucket(progress.get(c.id))]++;
  return counts;
}

export function ProgressBar({ cards, progress }: { cards: Card[]; progress: ProgressMap }) {
  const total = Math.max(cards.length, 1);
  const c = countBuckets(cards, progress);
  return (
    <div class="progress" title={`выучено ${c.learned}, учу ${c.learning}, новых ${c.new}`}>
      <div class="learned" style={{ width: `${(c.learned / total) * 100}%` }} />
      <div class="learning" style={{ width: `${(c.learning / total) * 100}%` }} />
    </div>
  );
}
