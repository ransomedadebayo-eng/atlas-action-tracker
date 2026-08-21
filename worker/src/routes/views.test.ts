import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';
import { validateSavedView } from './views';

const codexToken = 'codex-view-test-token-0001';

function env(scopes = ['views:read']): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token: codexToken, scopes } }),
  };
}

describe('saved view validation', () => {
  it('accepts a typed project timeline view', () => {
    expect(validateSavedView({
      name: 'Launch timeline',
      entity_type: 'project',
      layout: 'timeline',
      group_by: 'status',
      sort_by: 'priority',
      sort_dir: 'asc',
      filters: { health: 'at_risk' },
      display_options: { zoom: 'quarter', completed_window: 'month' },
    })).toEqual([]);
  });

  it('rejects timeline action views and invalid project display options', () => {
    expect(validateSavedView({ name: 'Bad', entity_type: 'action', layout: 'timeline' }))
      .toContain('timeline layout is available only for project or initiative views');
    expect(validateSavedView({ name: 'Bad', entity_type: 'project', sort_by: 'due_date' }))
      .toContain('sort_by is invalid for the entity type');
    expect(validateSavedView({ name: 'Bad', entity_type: 'project', display_options: { zoom: 'decade' } }))
      .toContain('display_options.zoom must be week, month, quarter, or year');
  });

  it('accepts initiative list and timeline views but rejects initiative boards', () => {
    expect(validateSavedView({ name: 'Strategy', entity_type: 'initiative', layout: 'timeline', group_by: 'owner', sort_by: 'health', display_options: { zoom: 'year' } })).toEqual([]);
    expect(validateSavedView({ name: 'Bad board', entity_type: 'initiative', layout: 'board' })).toContain('board layout is not available for initiative views');
  });

  it('requires valid names and object filters', () => {
    expect(validateSavedView({ entity_type: 'project', filters: [] })).toEqual(expect.arrayContaining([
      'name is required',
      'filters must be an object',
    ]));
  });

  it('rejects competing project and initiative contexts', () => {
    expect(validateSavedView({ name: 'Bad context', entity_type: 'action', context_project_id: 'p1', context_initiative_id: 'i1' })).toContain('a saved view can have only one context');
  });
});

describe('saved view HTTP boundary', () => {
  it('requires the views read scope', async () => {
    const response = await app.request('/api/views', {
      headers: { authorization: `Bearer ${codexToken}` },
    }, env(['projects:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'views:read' } });
  });

  it('keeps saved-view writes owner-only', async () => {
    const response = await app.request('/api/views', {
      method: 'POST',
      headers: { authorization: `Bearer ${codexToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Protected view', entity_type: 'project' }),
    }, env(['views:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });

  it('keeps compatibility deletes owner-only before reaching the non-delete contract', async () => {
    const response = await app.request('/api/views/view-1', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${codexToken}` },
    }, env(['views:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
});
