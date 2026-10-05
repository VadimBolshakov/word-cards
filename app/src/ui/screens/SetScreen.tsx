import type { Card } from '../../types';

export function SetScreen(_: { title: string; cards: Card[]; allowModeChoice: boolean }) {
  return <p class="muted">Экран набора — Task 14</p>;
}
