import { describe, expect, it } from 'vitest';
import { depthFromState, resyncDelta, truncateTo } from './navigation';

describe('truncateTo', () => {
  it('обрезает стек до depth + 1', () => {
    expect(truncateTo(['a', 'b', 'c', 'd'], 1)).toEqual(['a', 'b']);
  });
  it('depth 0 оставляет только корень', () => {
    expect(truncateTo(['a', 'b', 'c'], 0)).toEqual(['a']);
  });
  it('depth вне диапазона не меняет стек и не опускается ниже 1', () => {
    const s = ['a', 'b'];
    expect(truncateTo(s, 5)).toBe(s);
    expect(truncateTo(s, -3)).toEqual(['a']);
    expect(truncateTo(s, NaN)).toEqual(['a']);
  });
});

describe('depthFromState', () => {
  it('читает depth', () => expect(depthFromState({ depth: 2 })).toBe(2));
  it('нет state — 0', () => {
    expect(depthFromState(null)).toBe(0);
    expect(depthFromState(undefined)).toBe(0);
    expect(depthFromState({})).toBe(0);
  });
  it('некорректный depth — 0', () => {
    expect(depthFromState({ depth: -1 })).toBe(0);
    expect(depthFromState({ depth: 1.5 })).toBe(0);
    expect(depthFromState({ depth: '2' })).toBe(0);
  });
});

describe('resyncDelta', () => {
  it('история не глубже стека — 0', () => {
    expect(resyncDelta(3, 2)).toBe(0);
    expect(resyncDelta(3, 0)).toBe(0);
  });
  it('свайп вперёд: возвращает к вершине стека', () => {
    expect(resyncDelta(2, 2)).toBe(-1);
    expect(resyncDelta(1, 3)).toBe(-3);
  });
});
