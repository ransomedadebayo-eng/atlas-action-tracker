import { describe, expect, it } from 'vitest';
import { app } from '../index';
import type { Env } from '../db';

const token = 'codex-workflow-test-token-0001';
function env(scopes = ['workflows:read', 'workflows:write']): Env {
  return {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
    NODE_ENV: 'production', ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token, scopes } }),
  };
}

describe('workflow HTTP authorization boundary', () => {
  it('requires workflow read scope for configuration reads', async () => {
    const response = await app.request('/api/workflows?business=personal', { headers: { authorization: `Bearer ${token}` } }, env(['actions:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'workflows:read' } });
  });
  it('requires workflow read scope for Triage reads', async () => {
    const response = await app.request('/api/triage?business=personal', { headers: { authorization: `Bearer ${token}` } }, env(['actions:read']));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ details: { required_scope: 'workflows:read' } });
  });
  it('keeps workflow configuration owner-only', async () => {
    const response = await app.request('/api/workflows/w1/statuses', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Review', category: 'started' }) }, env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
  it('keeps Triage decisions owner-only', async () => {
    const response = await app.request('/api/triage/a1/accept', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, env());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
  it('keeps rule activation and inactivity application owner-only', async () => {
    const activate = await app.request('/api/workflows/w1/rules/r1/activate', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, env());
    const inactivity = await app.request('/api/workflows/w1/inactivity/apply', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }, env());
    expect(activate.status).toBe(403); expect(inactivity.status).toBe(403);
  });
});
