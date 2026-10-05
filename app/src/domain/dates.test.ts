import { describe, expect, it } from 'vitest';
import { addDays, todayISO } from './dates';

describe('dates', () => {
  it('formats local date', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('adds days across month, year and leap day', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-10', 0)).toBe('2026-03-10');
  });
});
