import { describe, expect, it } from 'vitest';
import { eligibleFocusProject, focusRemainingMs, formatCountdown, formatFocusTime, parseFocusSettings, sampleFocusState } from './focusTimer.js';

const epoch = Date.parse('2026-10-19T12:00:00Z');
const state = { revision: 4, phase: 'focus', status: 'running', server_now: new Date(epoch).toISOString(), deadline_at: new Date(epoch + 60000).toISOString(), remaining_ms: 60000 };

describe('server Focus clock', () => {
  it('compensates for a device clock five minutes fast and request travel time', () => {
    const sampled = sampleFocusState(state, epoch + 300000 - 100, epoch + 300000 + 100);
    expect(sampled.clock_offset_ms).toBe(-300000);
    expect(focusRemainingMs(sampled, epoch + 300000)).toBe(60000);
    expect(focusRemainingMs(sampled, epoch + 345000)).toBe(15000);
  });
  it('jumps to the actual deadline after a background sleep and never goes negative', () => {
    const sampled = sampleFocusState(state, epoch, epoch);
    expect(focusRemainingMs(sampled, epoch + 10 * 60000)).toBe(0);
  });
  it('reconstructs the same countdown from a fresh server sample after a reload', () => {
    const sampled = sampleFocusState({ ...state, server_now: new Date(epoch + 40000).toISOString() }, epoch + 40000 + 800000, epoch + 40000 + 800000);
    expect(focusRemainingMs(sampled, epoch + 40000 + 800000)).toBe(20000);
  });
  it('keeps paused time fixed and ignores new settings for an existing session', () => {
    const paused = { ...state, status: 'paused', remaining_ms: 12345, settings: { focus_minutes: 90 } };
    expect(focusRemainingMs(paused, epoch + 10000000)).toBe(12345);
  });
  it('rejects a malformed state rather than inventing a browser timer', () => {
    expect(() => sampleFocusState({ ...state, server_now: 'bad' }, epoch, epoch)).toThrow(/invalid Focus state/);
  });
});

describe('Focus inputs and formatting', () => {
  it.each(['completed', 'canceled', 'cancelled', 'archived', 'done', 'closed'])('excludes %s projects', status => {
    expect(eligibleFocusProject({ id: 'actual-id', status })).toBe(false);
  });
  it('requires a real project ID and rejects archived_at even on an active status', () => {
    expect(eligibleFocusProject({ name: 'Free-form name', status: 'in_progress' })).toBe(false);
    expect(eligibleFocusProject({ id: 'id', status: 'in_progress', archived_at: '2026-01-01' })).toBe(false);
    expect(eligibleFocusProject({ id: 'id', status: 'paused' })).toBe(true);
  });
  it('validates whole minute bounds and returns the complete settings object', () => {
    const draft = { focus_minutes: '25', short_break_minutes: '5', long_break_minutes: '15', chime_enabled: false };
    expect(parseFocusSettings(draft)).toEqual({ focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, chime_enabled: false });
    for (const [key, value] of [['focus_minutes', 181], ['short_break_minutes', 61], ['long_break_minutes', 121], ['focus_minutes', 1.5], ['short_break_minutes', '']]) {
      expect(() => parseFocusSettings({ ...draft, [key]: value })).toThrow(/whole number/);
    }
  });
  it('rounds the countdown upward and preserves long sessions and readable totals', () => {
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(-1)).toBe('00:00');
    expect(formatCountdown(180 * 60000)).toBe('180:00');
    expect(formatFocusTime(85 * 60000)).toBe('1h 25m');
    expect(formatFocusTime(5000)).toBe('<1 min');
    expect(formatFocusTime(0)).toBe('0 min');
  });
});
