import { describe, expect, it } from 'vitest';
import { app } from './index';
import type { Env } from './db';

const localToken = 'local-owner-token-0000000001';
const codexToken = 'codex-machine-token-000000001';

function env(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production',
    ATLAS_API_TOKEN: localToken,
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({
      codex: { token: codexToken, scopes: ['actions:read', 'actions:write', 'automations:read'] },
    }),
    ...overrides,
  };
}

describe('Worker trust boundary', () => {
  it('never accepts the legacy shared token in production', async () => {
    const response = await app.request('/api/actions/action-1', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${localToken}` },
    }, env());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('keeps the local owner token available only in development', async () => {
    const response = await app.request('/api/actions/action-1', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${localToken}` },
    }, env({ NODE_ENV: 'development' }));
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'HARD_DELETE_DISABLED' });
  });

  it('returns 405 without touching the database for an authenticated action reader', async () => {
    const response = await app.request('/api/actions/action-1', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${codexToken}` },
    }, env());
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toContain('POST');
  });

  it('does not expose an automation execution endpoint to machine principals', async () => {
    const response = await app.request('/api/automations/agent-work-pull/run', {
      method: 'POST',
      headers: { authorization: `Bearer ${codexToken}` },
    }, env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  });

  it('does not let actions:write alter ownership without actions:assign', async () => {
    const response = await app.request('/api/actions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${codexToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Protected assignment', business: 'personal', owners: ['codex'] }),
    }, env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'ASSIGNMENT_SCOPE_REQUIRED' });
  });

  it('rejects creation of additional principals even for the local owner', async () => {
    const response = await app.request('/api/members', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${localToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: 'another-person', name: 'Another Person' }),
    }, env({ NODE_ENV: 'development' }));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'PRINCIPAL_ROSTER_FIXED' },
    });
  });
});
