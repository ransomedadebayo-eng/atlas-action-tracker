import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';

const codexToken = 'codex-weekly-test-token-0001';

function env(scopes = ['weeks:read', 'weeks:write', 'weeks:request_review']): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token: codexToken, scopes } }),
  };
}

describe('weekly plan HTTP boundary', () => {
  it('rejects a non-Monday week before querying the database', async () => {
    const response = await app.request('/api/weeks/2026-08-02', {
      headers: { authorization: `Bearer ${codexToken}` },
    }, env());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_WEEK_START' });
  });

  it('keeps publication owner-only even when a machine can write drafts', async () => {
    const response = await app.request('/api/weeks/revisions/revision-1/publish', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${codexToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expected_revision: 0 }),
    }, env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });

  it('requires weekly read scope for machine readers', async () => {
    const response = await app.request('/api/weeks/2026-08-03', {
      headers: { authorization: `Bearer ${codexToken}` },
    }, env(['actions:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'INSUFFICIENT_SCOPE', details: { required_scope: 'weeks:read' } });
  });

  it('allows the request-review scope through authorization', async () => {
    const response = await app.request('/api/weeks/revisions/revision-1/request-review', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${codexToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expected_revision: 'invalid' }),
    }, env(['weeks:request_review']));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_WEEKLY_PLAN' });
  });
});
