import { describe, expect, it } from 'vitest';
import {
  OFFICE_DIGEST_VIEW_FILTERS,
  applyActionQueryFilters,
  hasNonEmptyBlockedBy,
  isOpenDigestAction,
  matchesActionFilters,
  parseCompletedWithin,
  resolveSavedViewFilters,
} from './actionFilters';

const now = new Date('2026-09-12T22:00:00.000Z');

describe('office digest filter helpers', () => {
  it('parses a completed_within hour window', () => {
    expect(parseCompletedWithin('48h', now)?.toISOString()).toBe('2026-09-10T22:00:00.000Z');
    expect(parseCompletedWithin('bad', now)).toBeNull();
  });

  it('treats only non-empty jsonb-like blocked_by as blocked', () => {
    expect(hasNonEmptyBlockedBy(['a1'])).toBe(true);
    expect(hasNonEmptyBlockedBy('["a1"]')).toBe(true);
    expect(hasNonEmptyBlockedBy([])).toBe(false);
    expect(hasNonEmptyBlockedBy('[]')).toBe(false);
    expect(hasNonEmptyBlockedBy(null)).toBe(false);
  });

  it('treats archived and terminal statuses as closed for the open predicate', () => {
    expect(isOpenDigestAction({ status: 'waiting', archived_at: null })).toBe(true);
    expect(isOpenDigestAction({ status: 'todo', archived_at: null })).toBe(true);
    expect(isOpenDigestAction({ status: 'done', archived_at: null })).toBe(false);
    expect(isOpenDigestAction({ status: 'canceled', archived_at: null })).toBe(false);
    expect(isOpenDigestAction({ status: 'in_progress', archived_at: '2026-09-01T00:00:00Z' })).toBe(false);
  });

  it('matches the three office-digest saved views to atlas_office_digest_v1 buckets', () => {
    const recentDone = {
      status: 'done',
      completed_at: '2026-09-12T12:00:00.000Z',
      archived_at: null,
      approval_state: 'not_required',
      blocked_by: [],
    };
    const oldDone = { ...recentDone, completed_at: '2026-09-09T12:00:00.000Z' };
    const waiting = {
      status: 'in_progress',
      archived_at: null,
      approval_state: 'needs_review',
      blocked_by: ['blocker'],
      completed_at: null,
    };
    const blocked = {
      status: 'waiting',
      archived_at: null,
      approval_state: 'not_required',
      blocked_by: ['blocker'],
      completed_at: null,
    };
    const openUnblocked = {
      status: 'not_started',
      archived_at: null,
      approval_state: 'not_required',
      blocked_by: [],
      completed_at: null,
    };

    expect(matchesActionFilters(recentDone, OFFICE_DIGEST_VIEW_FILTERS['office-digest-done'], now)).toBe(true);
    expect(matchesActionFilters(oldDone, OFFICE_DIGEST_VIEW_FILTERS['office-digest-done'], now)).toBe(false);
    expect(matchesActionFilters(waiting, OFFICE_DIGEST_VIEW_FILTERS['office-digest-waiting-on-owner'], now)).toBe(true);
    expect(matchesActionFilters(blocked, OFFICE_DIGEST_VIEW_FILTERS['office-digest-waiting-on-owner'], now)).toBe(false);
    expect(matchesActionFilters(blocked, OFFICE_DIGEST_VIEW_FILTERS['office-digest-blocked-by-office'], now)).toBe(true);
    expect(matchesActionFilters(waiting, OFFICE_DIGEST_VIEW_FILTERS['office-digest-blocked-by-office'], now)).toBe(false);
    expect(matchesActionFilters(openUnblocked, OFFICE_DIGEST_VIEW_FILTERS['office-digest-blocked-by-office'], now)).toBe(false);
  });

  it('overlays canonical office-digest filters even when stored filters are approximate', () => {
    expect(resolveSavedViewFilters({
      id: 'office-digest-done',
      filters: { status: 'done' },
    })).toEqual(OFFICE_DIGEST_VIEW_FILTERS['office-digest-done']);
    expect(resolveSavedViewFilters({
      id: 'office-digest-blocked-by-office',
      filters: { status: ['not_started', 'in_progress'], show_blocked: 'true' },
    })).toEqual(OFFICE_DIGEST_VIEW_FILTERS['office-digest-blocked-by-office']);
  });

  it('applies completed_within and non-empty blocked_by onto a query builder', () => {
    const calls: string[] = [];
    const query = {
      in(field: string, values: string[]) {
        calls.push(`in:${field}:${values.join(',')}`);
        return this;
      },
      neq(field: string, value: string) {
        calls.push(`neq:${field}:${value}`);
        return this;
      },
      gte(field: string, value: string) {
        calls.push(`gte:${field}:${value}`);
        return this;
      },
      not(field: string, op: string, value?: string) {
        calls.push(`not:${field}:${op}:${value || ''}`);
        return this;
      },
      is(field: string, value: unknown) {
        calls.push(`is:${field}:${String(value)}`);
        return this;
      },
    };

    applyActionQueryFilters(query, OFFICE_DIGEST_VIEW_FILTERS['office-digest-done'], now);
    applyActionQueryFilters(query, OFFICE_DIGEST_VIEW_FILTERS['office-digest-blocked-by-office'], now);

    expect(calls).toEqual(expect.arrayContaining([
      'gte:completed_at:2026-09-10T22:00:00.000Z',
      'not:completed_at:is:',
      'is:archived_at:null',
      'not:blocked_by:is:',
      'neq:blocked_by:[]',
      'neq:approval_state:needs_review',
    ]));
  });
});
