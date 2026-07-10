import { describe, expect, it } from 'vitest';
import { atlasTodayIsoDate } from './atlasToday';

describe('atlasTodayIsoDate', () => {
  it('uses the ATLAS Pacific calendar date across the UTC rollover', () => {
    expect(atlasTodayIsoDate(new Date('2026-07-10T06:59:59Z'))).toBe('2026-07-09');
    expect(atlasTodayIsoDate(new Date('2026-07-10T07:00:00Z'))).toBe('2026-07-10');
  });
});
