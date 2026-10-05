import { describe, expect, it } from 'vitest';
import { depthFromState, truncateTo } from './navigation';

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
