import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';

const codexToken = 'codex-digest-test-token-0001';

function env(scopes = ['actions:read']): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token: codexToken, scopes } }),
  };
}

describe('office digest HTTP boundary', () => {
  it('requires the actions read scope', async () => {
    const response = await app.request('/api/updates/office-digest', {
      headers: { authorization: `Bearer ${codexToken}` },
    }, env(['views:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'actions:read' } });
  });
});
