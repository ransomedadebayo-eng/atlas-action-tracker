import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';

const token = 'codex-structure-test-token-0001';

function env(scopes: string[]): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token, scopes } }),
  };
}

describe('action structure HTTP boundary', () => {
  it('requires actions:read for structure reads', async () => {
    const response = await app.request('/api/actions/action-1/structure', { headers: { authorization: `Bearer ${token}` } }, env(['projects:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'actions:read' } });
  });

  it('requires actions:complete for duplicate resolution', async () => {
    const response = await app.request('/api/actions/action-1/duplicate', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ canonical_action_id: 'action-2', expected_revision: 0 }),
    }, env(['actions:write']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'actions:complete' } });
  });

  it('keeps duplicate restoration owner-only', async () => {
    const response = await app.request('/api/actions/action-1/restore-duplicate', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: 1 }),
    }, env(['actions:read', 'actions:write', 'actions:complete']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });

  it('keeps parent-to-project conversion owner-only', async () => {
    const response = await app.request('/api/actions/action-1/convert-to-project', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: 1 }),
    }, env(['actions:read', 'actions:write']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
});
