import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { app } from '../index';
import focusRouter from './focus';
import { getDb, type Env } from '../db';
import { encodeFocusCursor } from '../utils/focus';

vi.mock('../db', () => ({ getDb: vi.fn() }));
const owner = 'focus-local-owner-token-only';
const principal = 'focus-machine-test-token-only';
const operation = '8511e7c5-ae8d-4fdc-b8b3-89e9f2b2f123';
const env: Env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', NODE_ENV: 'development',
  ATLAS_API_TOKEN: owner,
  ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ claude: { token: principal, scopes: ['actions:read', 'actions:write', 'projects:read', 'projects:write', 'config:read'] } }),
};
const state = {
  server_now: '2026-10-19T12:00:00.000Z', revision: 0,
  settings: { focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, chime_enabled: false },
  phase: 'focus', status: 'ready', session: null, deadline_at: null, remaining_ms: 1500000, completed_focus_count: 0,
};
let rpc: ReturnType<typeof vi.fn>;
function command(body: unknown = { operation_id: operation, expected_revision: 0, command: 'reconcile' }, headers: Record<string, string> = {}) {
  return app.request('/api/focus/commands', {
    method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, env);
}
function get(path = '/api/focus') { return app.request(path, { headers: { authorization: `Bearer ${owner}` } }, env); }

beforeEach(() => {
  vi.clearAllMocks();
  rpc = vi.fn().mockResolvedValue({ data: state, error: null });
  vi.mocked(getDb).mockReturnValue({ rpc } as unknown as ReturnType<typeof getDb>);
});

describe('focus owner boundary', () => {
  it.each(['/api/focus', '/api/focus/history', '/api/focus/commands'])('requires authentication and rejects existing principal scopes at %s', async path => {
    for (const token of [null, principal]) {
      const response = await app.request(path, {
        ...(path.endsWith('commands') ? { method: 'POST', body: '{}' } : {}),
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }, env);
      expect(response.status).toBe(token ? 403 : 401);
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it('keeps a local owner guard even when the router is mounted without global authorization', async () => {
    const isolated = new Hono();
    isolated.use('*', async (c, next) => {
      c.set('atlasActor' as never, 'claude' as never);
      c.set('atlasAuthKind' as never, 'api_principal' as never);
      return next();
    });
    isolated.route('/focus', focusRouter);
    const response = await isolated.request('/focus', {}, env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('returns state through a read-only RPC with no-store caching', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual(state);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('atlas_focus_get_state', { p_owner: 'ransomed' });
  });
});

describe('focus command validation and receipts', () => {
  it.each([
    null, [], 'null', '{broken', '{}',
    { operation_id: operation, expected_revision: -1, command: 'start' },
    { operation_id: operation, expected_revision: 1.1, command: 'start' },
    { operation_id: operation, expected_revision: Number.MAX_SAFE_INTEGER + 1, command: 'start' },
    { operation_id: 'not-a-uuid', expected_revision: 0, command: 'start' },
    { operation_id: operation, expected_revision: 0, command: 'complete_project' },
    { operation_id: operation, expected_revision: 0, command: 'pause', project_id: 'p1' },
    { operation_id: operation, expected_revision: 0, command: 'start', project_id: ' p1' },
    { operation_id: operation, expected_revision: 0, command: 'start', project_id: null },
    { operation_id: operation, expected_revision: 0, command: 'start', project_id: 'x'.repeat(201) },
    { operation_id: operation, expected_revision: 0, command: 'start', actor: 'someone' },
    { operation_id: operation, expected_revision: 0, command: 'select_phase', phase: 'unknown' },
    { operation_id: operation, expected_revision: 0, command: 'settings', settings: { focus_minutes: 25 } },
    { operation_id: operation, expected_revision: 0, command: 'settings', settings: { ...state.settings, focus_minutes: 0 } },
    { operation_id: operation, expected_revision: 0, command: 'settings', settings: { ...state.settings, focus_minutes: 181 } },
    { operation_id: operation, expected_revision: 0, command: 'settings', settings: { ...state.settings, short_break_minutes: 61 } },
    { operation_id: operation, expected_revision: 0, command: 'settings', settings: { ...state.settings, long_break_minutes: 121 } },
    { operation_id: operation, expected_revision: 0, command: 'settings', settings: { ...state.settings, chime_enabled: 'true' } },
    { operation_id: operation, expected_revision: 0, command: 'settings', settings: { ...state.settings, extra: true } },
  ])('rejects invalid command %j before touching storage', async body => {
    const response = await command(body);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'FOCUS_INVALID_COMMAND' });
    expect(getDb).not.toHaveBeenCalled();
  });

  it('rejects declared or actual oversized bodies and unsupported content types', async () => {
    expect((await command('{}', { 'content-length': '9000' })).status).toBe(413);
    expect((await command(' '.repeat(8193), { 'content-length': '1' })).status).toBe(413);
    expect((await command('{}', { 'content-type': 'text/plain' })).status).toBe(415);
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each(['start', 'pause', 'resume', 'reset', 'skip', 'reconcile'])('forwards canonical %s request with no client actor or clock authority', async value => {
    const request = { operation_id: operation.toUpperCase(), expected_revision: 7, command: value, ...(value === 'start' ? { project_id: 'project-actual-id' } : {}) };
    const response = await command(request);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('atlas_focus_command', { p_owner: 'ransomed', p_request: { ...request, operation_id: operation } });
  });

  it.each(['focus', 'short_break', 'long_break'])('accepts phase %s', async phase => {
    const response = await command({ operation_id: operation, expected_revision: 0, command: 'select_phase', phase });
    expect(response.status).toBe(200);
  });

  it('accepts inclusive settings bounds and leaves their timing application to the transaction', async () => {
    for (const settings of [
      { focus_minutes: 1, short_break_minutes: 1, long_break_minutes: 1, chime_enabled: false },
      { focus_minutes: 180, short_break_minutes: 60, long_break_minutes: 120, chime_enabled: true },
    ]) expect((await command({ operation_id: operation, expected_revision: 0, command: 'settings', settings })).status).toBe(200);
  });

  it('preserves an immutable receipt result, including its historical clock on retry', async () => {
    const historical = { ...state, revision: 3, server_now: '2026-10-18T12:00:00Z' };
    rpc.mockResolvedValue({ data: historical, error: null });
    await expect((await command()).json()).resolves.toEqual(historical);
    await expect((await command()).json()).resolves.toEqual(historical);
  });

  it.each([
    ['40001', 'OPERATION_CONFLICT', 409, 'OPERATION_CONFLICT'],
    ['40001', 'REVISION_CONFLICT', 409, 'REVISION_CONFLICT'],
    ['55000', 'FOCUS_INVALID_STATE', 409, 'FOCUS_INVALID_STATE'],
    ['P0002', 'FOCUS_PROJECT_NOT_FOUND', 404, 'FOCUS_PROJECT_NOT_FOUND'],
    ['55000', 'FOCUS_PROJECT_UNAVAILABLE', 409, 'FOCUS_PROJECT_UNAVAILABLE'],
    ['22023', 'FOCUS_PROJECT_REQUIRED', 400, 'FOCUS_PROJECT_REQUIRED'],
  ])('maps storage outcome %s/%s to HTTP %i', async (code, message, status, expected) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await command();
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code: expected });
  });
});

describe('focus storage availability and history', () => {
  it.each(['PGRST202', 'PGRST205', '42P01', '42883', '42501'])('returns actionable unavailable storage for %s', async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'Storage unavailable' } });
    for (const response of [await get(), await command(), await get('/api/focus/history')]) {
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ code: 'FOCUS_STORAGE_UNAVAILABLE', message: expect.stringContaining('owner must approve') });
    }
  });

  it('does not falsely report failure or replay a different operation after an uncertain command', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValue(new Error('Transport disconnected'));
    const response = await command();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'FOCUS_COMMAND_UNCERTAIN', message: expect.stringContaining('exact same operation_id') });
    expect(rpc).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('forwards stable microsecond cursor and project filter while preserving all-history totals', async () => {
    const cursor = { ended_at: '2026-10-19T12:00:00.123456+00:00', id: operation };
    const next = { ended_at: '2026-10-18T12:00:00.123455+00:00', id: operation };
    const result = { items: [{ id: operation }], next_cursor: next, totals: { completed_sessions: 42, focus_ms: 63000000 }, projects: [{ project_id: 'p1', project_name: 'Before rename', completed_sessions: 42, focus_ms: 63000000 }] };
    rpc.mockResolvedValue({ data: result, error: null });
    const response = await get(`/api/focus/history?limit=1&project_id=p1&cursor=${encodeFocusCursor(cursor)}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...result, next_cursor: encodeFocusCursor(next) });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('atlas_focus_history', { p_owner: 'ransomed', p_limit: 1, p_project_id: 'p1', p_cursor_ended_at: cursor.ended_at, p_cursor_id: cursor.id });
  });

  it('returns empty history without deriving totals from page size', async () => {
    const result = { items: [], next_cursor: null, totals: { completed_sessions: 0, focus_ms: 0 }, projects: [] };
    rpc.mockResolvedValue({ data: result, error: null });
    await expect((await get('/api/focus/history')).json()).resolves.toEqual(result);
  });

  it.each(['limit=0', 'limit=101', 'limit=1.5', 'limit=2&limit=3', 'cursor=', 'cursor=not-json', 'cursor=***', 'project_id=', 'unexpected=1', 'project_id=x&project_id=y'])('rejects invalid history query %s', async query => {
    const response = await get(`/api/focus/history?${query}`);
    expect(response.status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });
});
