import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import {
  buildInitiativeGraph, calculateInitiativeRollup, descendantInitiativeIds,
  initiativeProjectIds, validateInitiativeBody, validateInitiativeResourceBody,
} from './initiatives';

const codexToken = 'codex-initiative-test-token-0001';
function env(scopes = ['initiatives:read', 'initiatives:write']): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only', NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token: codexToken, scopes } }),
  };
}

describe('initiative validation and rollups', () => {
  it('validates strategic properties and dates', () => {
    expect(validateInitiativeBody({ name: 'Growth', status: 'active', priority: 'p1', labels: ['2026'], start_date: '2026-08-01', target_date: '2026-09-01' })).toEqual([]);
    expect(validateInitiativeBody({ name: '', status: 'unknown', labels: 'bad', start_date: '2026-09-02', target_date: '2026-09-01' })).toEqual(expect.arrayContaining([
      'name is required', 'name must be a non-empty string', 'status is invalid', 'labels must be an array of non-empty strings', 'start_date must not be after target_date',
    ]));
  });

  it('deduplicates multi-parent descendants and recursive project membership', () => {
    const relations = [
      { parent_initiative_id: 'root', child_initiative_id: 'a', status: 'active' },
      { parent_initiative_id: 'root', child_initiative_id: 'b', status: 'active' },
      { parent_initiative_id: 'a', child_initiative_id: 'shared', status: 'active' },
      { parent_initiative_id: 'b', child_initiative_id: 'shared', status: 'active' },
    ];
    expect(Array.from(descendantInitiativeIds('root', relations)).sort()).toEqual(['a', 'b', 'root', 'shared']);
    expect(Array.from(initiativeProjectIds('root', relations, [
      { initiative_id: 'root', project_id: 'p1', status: 'active' },
      { initiative_id: 'shared', project_id: 'p1', status: 'active' },
      { initiative_id: 'shared', project_id: 'p2', status: 'active' },
    ])).sort()).toEqual(['p1', 'p2']);
  });

  it('rolls up project health and canonical action effort', () => {
    expect(calculateInitiativeRollup([
      { id: 'p1', status: 'in_progress', health: 'at_risk' },
      { id: 'p2', status: 'completed', health: 'on_track' },
    ], [
      { project_id: 'p1', status: 'in_progress', estimate_points: 3 },
      { project_id: 'p2', status: 'done', estimate_points: 5 },
    ])).toMatchObject({ total_projects: 2, active_projects: 1, completed_projects: 1, total_effort: 8, completed_effort: 5, progress_percent: 63, project_health: { on_track: 1, at_risk: 1, off_track: 0, no_update: 0 } });
  });

  it('builds weekly completion series per project', () => {
    const series = buildInitiativeGraph([{ id: 'p1', name: 'Launch' }], [
      { project_id: 'p1', completed_at: '2026-08-17T12:00:00Z' },
      { project_id: 'p1', completed_at: '2026-08-18T12:00:00Z' },
      { project_id: 'other', completed_at: '2026-08-18T12:00:00Z' },
    ]);
    expect(series).toHaveLength(1);
    expect(series[0].points).toEqual([{ week_start: '2026-08-16', completed_issues: 2 }]);
  });

  it('accepts only HTTPS links or safe internal document identifiers', () => {
    expect(validateInitiativeResourceBody({ resource_type: 'link', url: 'https://example.com/brief' })).toBeNull();
    expect(validateInitiativeResourceBody({ resource_type: 'link', url: 'javascript:alert(1)' })).toMatch(/HTTPS/);
    expect(validateInitiativeResourceBody({ resource_type: 'link', url: 'https://user:pass@example.com/brief' })).toMatch(/credentials/);
    expect(validateInitiativeResourceBody({ resource_type: 'document', document_ref: 'doc-familyos-charter' })).toBeNull();
    expect(validateInitiativeResourceBody({ resource_type: 'document', document_ref: 'javascript:alert(1)' })).toMatch(/safe internal/);
  });
});

describe('initiative HTTP boundary', () => {
  it('requires initiative read scope', async () => {
    const response = await app.request('/api/initiatives', { headers: { authorization: `Bearer ${codexToken}` } }, env(['projects:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'initiatives:read' } });
  });

  it('requires initiative write scope', async () => {
    const response = await app.request('/api/initiatives', { method: 'POST', headers: { authorization: `Bearer ${codexToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Protected' }) }, env(['initiatives:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'initiatives:write' } });
  });

  it('keeps initiative archive owner-only', async () => {
    const response = await app.request('/api/initiatives/i1/archive', { method: 'POST', headers: { authorization: `Bearer ${codexToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ expected_revision: 1 }) }, env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
});
