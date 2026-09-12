import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import { calculateCycleCapacity, calculateCycleMetrics, cyclesToIcs, validateCycleConfig } from './cycles';

const token = 'codex-cycle-test-token-0001';
function env(scopes: string[]): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token, scopes } }),
  };
}

describe('cycle metrics and capacity', () => {
  it('matches Linear success weighting for completed and started work', () => {
    expect(calculateCycleMetrics([
      ...Array.from({ length: 5 }, (_, index) => ({ id: `done-${index}`, status: 'done', estimate_points: 1 })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `started-${index}`, status: 'in_progress', estimate_points: 1 })),
      { id: 'untouched', status: 'not_started', estimate_points: 1 },
    ])).toMatchObject({
      issue_count: 10,
      completed_count: 5,
      started_count: 4,
      scope_effort: 10,
      completed_effort: 5,
      started_effort: 4,
      completion_percent: 50,
      success_percent: 60,
    });
  });

  it('uses the previous three completed cycles before the rough principal baseline', () => {
    expect(calculateCycleCapacity([
      { completed_effort_snapshot: 4 }, { completed_effort_snapshot: 8 },
      { completed_effort_snapshot: 10 }, { completed_effort_snapshot: 12 },
    ], 3, 2)).toEqual({ value: 10, source: 'previous_three_cycles', history_count: 3 });
    expect(calculateCycleCapacity([], 3, 2)).toEqual({ value: 30, source: 'principal_baseline', history_count: 0 });
    expect(calculateCycleCapacity([], 3, 2, 18)).toEqual({ value: 18, source: 'override', history_count: 0 });
  });

  it('validates the repeating schedule bounds', () => {
    expect(validateCycleConfig({ duration_weeks: 9, cooldown_days: 3, future_cycles: 16, start_date: '2026-02-30', auto_rollover: 'yes', auto_add_started: false })).toEqual(expect.arrayContaining([
      'duration_weeks must be between 1 and 8', 'cooldown_days must be 0, 7, or 14',
      'future_cycles must be between 1 and 15', 'start_date must be a valid YYYY-MM-DD date',
      'auto_rollover must be boolean',
    ]));
  });

  it('renders standards-compatible all-day calendar events', () => {
    const feed = cyclesToIcs([{ id: 'cycle-1', name: 'Cycle, One', status: 'planned', start_date: '2026-08-20', end_date: '2026-08-31' }]);
    expect(feed).toContain('BEGIN:VCALENDAR\r\n');
    expect(feed).toContain('DTSTART;VALUE=DATE:20260820');
    expect(feed).toContain('DTEND;VALUE=DATE:20260901');
    expect(feed).toContain('SUMMARY:Cycle\\, One');
    expect(feed).toContain('UID:atlas-cycle-cycle-1@atlas.ransomed.app');
  });
});

describe('cycle HTTP boundary', () => {
  it('requires cycles:read for cycle views', async () => {
    const response = await app.request('/api/cycles', { headers: { authorization: `Bearer ${token}` } }, env(['actions:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'cycles:read' } });
  });

  it('allows scoped membership routing but keeps configuration owner-only', async () => {
    const assign = await app.request('/api/cycles/cycle-1/actions/action-1/assign', { method: 'POST', headers: { authorization: `Bearer ${token}` } }, env(['cycles:read']));
    expect(assign.status).toBe(403);
    await expect(assign.json()).resolves.toMatchObject({ details: { required_scope: 'cycles:write' } });

    const configure = await app.request('/api/cycles/configure', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, env(['cycles:read', 'cycles:write']));
    expect(configure.status).toBe(403);
    await expect(configure.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });

  it('keeps completion and rollover owner-only', async () => {
    const response = await app.request('/api/cycles/cycle-1/complete', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, env(['cycles:read', 'cycles:write']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });

  it('keeps start-today owner-only', async () => {
    const response = await app.request('/api/cycles/cycle-1/start-today', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, env(['cycles:read', 'cycles:write']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
});
