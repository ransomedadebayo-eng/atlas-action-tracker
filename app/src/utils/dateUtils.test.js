import { describe, expect, it } from 'vitest';
import { getISODate } from './dateUtils.js';

describe('getISODate', () => {
  it('uses the ATLAS Pacific calendar date across the UTC rollover', () => {
    expect(getISODate(new Date('2026-07-10T06:59:59Z'))).toBe('2026-07-09');
    expect(getISODate(new Date('2026-07-10T07:00:00Z'))).toBe('2026-07-10');
  });
});
