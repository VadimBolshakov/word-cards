/** Глубина записи истории из `history.state`; нет или некорректно — 0 (корень). */
export function depthFromState(state: unknown): number {
  const d = (state as { depth?: unknown } | null | undefined)?.depth;
  return typeof d === 'number' && Number.isInteger(d) && d >= 0 ? d : 0;
}

/** Обрезает стек до `depth + 1` элементов (не меньше 1); если стек короче — возвращает его же. */
export function truncateTo<T>(stack: readonly T[], depth: number): readonly T[] {
  const keep = Math.max(1, Math.floor(Number.isFinite(depth) ? depth : 0) + 1);
  return keep >= stack.length ? stack : stack.slice(0, keep);
}

/**
 * Сколько шагов истории нужно сделать (go), чтобы вернуть историю к вершине стека.
 * Ненулевое значение (отрицательное) бывает при свайпе «вперёд»: depth оказывается глубже стека.
 */
export function resyncDelta(stackLength: number, depth: number): number {
  return depth >= stackLength ? stackLength - 1 - depth : 0;
}
