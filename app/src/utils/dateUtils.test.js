import { describe, expect, it } from 'vitest';
import { getISODate, getPacificWeekDates, getPacificWeekStart } from './dateUtils.js';

describe('getISODate', () => {
  it('uses the ATLAS Pacific calendar date across the UTC rollover', () => {
    expect(getISODate(new Date('2026-07-10T06:59:59Z'))).toBe('2026-07-09');
    expect(getISODate(new Date('2026-07-10T07:00:00Z'))).toBe('2026-07-10');
  });
});

describe('Pacific week helpers', () => {
  it('resolves Monday through Sunday across DST and year boundaries', () => {
    expect(getPacificWeekStart(new Date('2026-01-01T12:00:00Z'))).toBe('2025-12-29');
    expect(getPacificWeekDates('2026-03-09')).toEqual([
      '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15',
    ]);
  });
});
