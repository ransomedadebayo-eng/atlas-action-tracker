import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import {
  calculateProjectProgress,
  includeProjectByCompletedWindow,
  isProjectDependencyViolated,
  sortProjectsForView,
  validateMilestoneBody,
  validateProjectBody,
} from './projects';

const codexToken = 'codex-project-test-token-0001';

function env(scopes = ['projects:read', 'projects:write']): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token: codexToken, scopes } }),
  };
}

describe('project validation and progress', () => {
  it('uses one effort point for unestimated actions and explicit points when present', () => {
    expect(calculateProjectProgress([
      { status: 'done', estimate_points: 5 },
      { status: 'in_progress', estimate_points: 3 },
      { status: 'done', estimate_points: null },
      { status: 'blocked', estimate_points: 1 },
    ])).toEqual({
      total_issues: 4,
      completed_issues: 2,
      blocked_issues: 1,
      active_issues: 2,
      total_effort: 10,
      completed_effort: 6,
      progress_percent: 60,
    });
  });

  it('returns zero progress for an empty project', () => {
    expect(calculateProjectProgress([]).progress_percent).toBe(0);
  });

  it('uses the configured unestimated effort value', () => {
    expect(calculateProjectProgress([{ status: 'done', estimate_points: null }, { status: 'in_progress', estimate_points: null }], 3)).toMatchObject({
      total_effort: 6,
      completed_effort: 3,
      progress_percent: 50,
    });
  });

  it('rejects invalid project dates and enum values', () => {
    expect(validateProjectBody({ name: 'Launch', status: 'unknown' })).toContain('status is invalid');
    expect(validateProjectBody({ name: 'Launch', start_date: '2026-09-02', target_date: '2026-09-01' })).toContain('start_date must not be after target_date');
    expect(validateProjectBody({})).toContain('name is required');
  });

  it('validates milestone status and dates', () => {
    expect(validateMilestoneBody({ name: 'Beta', status: 'started' })).toContain('status is invalid');
    expect(validateMilestoneBody({ name: 'Beta', target_date: '2026-02-30' })).toContain('target_date must be a valid YYYY-MM-DD date or null');
  });

  it('detects only schedule-breaking project dependencies', () => {
    expect(isProjectDependencyViolated(
      { target_date: '2026-09-10' },
      { start_date: '2026-09-09' },
    )).toBe(true);
    expect(isProjectDependencyViolated(
      { target_date: '2026-09-10' },
      { start_date: '2026-09-10' },
    )).toBe(false);
    expect(isProjectDependencyViolated({}, { start_date: '2026-09-09' })).toBe(false);
  });

  it('sorts manual and priority project views deterministically', () => {
    const projects = [
      { id: 'late', priority: 'p2', sort_order: 2000 },
      { id: 'urgent', priority: 'p0', sort_order: 3000 },
      { id: 'early', priority: 'p2', sort_order: 1000 },
    ];
    expect(sortProjectsForView(projects, 'manual', 'asc').map(item => item.id)).toEqual(['early', 'late', 'urgent']);
    expect(sortProjectsForView(projects, 'priority', 'asc').map(item => item.id)).toEqual(['urgent', 'early', 'late']);
  });

  it('applies completed-project visibility windows without hiding active work', () => {
    const now = new Date('2026-08-20T12:00:00Z');
    expect(includeProjectByCompletedWindow({ status: 'in_progress' }, 'none', now)).toBe(true);
    expect(includeProjectByCompletedWindow({ status: 'completed', completed_at: '2026-08-18T12:00:00Z' }, 'week', now)).toBe(true);
    expect(includeProjectByCompletedWindow({ status: 'completed', completed_at: '2026-07-01T12:00:00Z' }, 'month', now)).toBe(false);
    expect(includeProjectByCompletedWindow({ status: 'completed' }, 'all', now)).toBe(true);
    expect(includeProjectByCompletedWindow({ status: 'completed' }, 'none', now)).toBe(false);
  });
});

describe('project HTTP boundary', () => {
  it('requires project read scope', async () => {
    const response = await app.request('/api/projects', {
      headers: { authorization: `Bearer ${codexToken}` },
    }, env(['actions:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'projects:read' } });
  });

  it('requires project write scope', async () => {
    const response = await app.request('/api/projects', {
      method: 'POST',
      headers: { authorization: `Bearer ${codexToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Protected project' }),
    }, env(['projects:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'projects:write' } });
  });

  it('keeps project archive owner-only', async () => {
    const response = await app.request('/api/projects/project-1/archive', {
      method: 'POST',
      headers: { authorization: `Bearer ${codexToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: 1 }),
    }, env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
});
