import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index';
import { getDb, type Env } from '../db';
import { calculateProjectActivity } from './projects';
import { coerceActionBody, validateActionFields } from '../utils/actionUtils';
import { ACTION_STATUSES, STATUS_ALIASES } from '../utils/statuses';

vi.mock('../db', () => ({ getDb: vi.fn() }));
type Row = Record<string, any>;
const token = 'simplification-machine-test-token';
const ownerToken = 'simplification-local-owner-token';
const env: Env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  NODE_ENV: 'development', ATLAS_API_TOKEN: ownerToken,
  ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ claude: { token, scopes: ['actions:read', 'actions:write', 'projects:read', 'notifications:read'] } }),
};

function request(path: string, body?: Row, method = body ? 'POST' : 'GET', owner = false) {
  return app.request(path, {
    method, headers: { authorization: `Bearer ${owner ? ownerToken : token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, env);
}

/** Throws on every table outside the retained model, so removed-table reads fail tests. */
function database(tables: Record<string, Row[]>, pageCap = Infinity) {
  const writes: { table: string; fields: Row | Row[] }[] = [];
  const selects: string[] = [];
  const pages: { table: string; start: number; orders: string[] }[] = [];
  const from = vi.fn((table: string) => {
    if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
    let rows = tables[table];
    let patch: Row | Row[] | undefined;
    let inserting = false;
    const orders: string[] = [];
    const result = () => {
      if (patch) {
        writes.push({ table, fields: patch });
        if (inserting) rows = Array.isArray(patch) ? patch : [patch];
        else rows = rows.map(row => ({ ...row, ...patch }));
        patch = undefined;
        tables[table] = rows;
      }
      return { data: rows.slice(0, pageCap), count: rows.length, error: null };
    };
    const query: any = {
      select: (value = '*') => { selects.push(value); return query; },
      eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
      neq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] !== value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query; },
      is: () => query, not: () => query, or: () => query, order: (field: string) => { orders.push(field); return query; }, limit: () => query,
      range: (start: number, end: number) => {
        pages.push({ table, start, orders: [...orders] });
        return Promise.resolve({ ...result(), data: rows.slice(start, Math.min(end + 1, start + pageCap)) });
      },
      insert: (fields: Row | Row[]) => { patch = fields; inserting = true; return query; },
      update: (fields: Row) => { patch = fields; return query; },
      single: async () => ({ ...result(), data: rows[0] || null }),
      maybeSingle: async () => ({ ...result(), data: rows[0] || null }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  });
  vi.mocked(getDb).mockReturnValue({ from } as unknown as ReturnType<typeof getDb>);
  return { from, writes, selects, pages };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('retired HTTP surfaces', () => {
  it.each(['cycles', 'initiatives', 'templates', 'releases', 'insights', 'dashboards', 'exports', 'workflows', 'triage'])('%s returns 410 before owner, principal or missing authentication', async surface => {
    for (const headers of [{}, { authorization: `Bearer ${token}` }, { authorization: `Bearer ${ownerToken}` }, { 'x-atlas-release-key': 'retired-key' }] as Record<string, string>[]) {
      for (const suffix of ['', '/historical-id']) {
        const response = await app.request(`/api/${surface}${suffix}`, { method: 'POST', headers }, env);
        expect(response.status).toBe(410);
        await expect(response.json()).resolves.toMatchObject({ code: 'ATLAS_SURFACE_RETIRED' });
      }
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it('does not match another API prefix that starts with a retired surface name', async () => {
    const response = await app.request('/api/cycles-unrelated', {}, env);
    expect(response.status).toBe(401);
  });
});

describe('fixed statuses and partial writes', () => {
  it('uses the eight specified values and labels in order', () => {
    expect(ACTION_STATUSES.map(item => [item.value, item.label])).toEqual([
      ['open', 'Needs triage'], ['not_started', 'To do'], ['in_progress', 'In progress'],
      ['waiting', 'Waiting'], ['blocked', 'Blocked'], ['done', 'Done'], ['canceled', 'Canceled'], ['archived', 'Archived'],
    ]);
    for (const [alias, value] of Object.entries(STATUS_ALIASES)) {
      const body = coerceActionBody({ status: alias });
      expect(body.status).toBe(value);
      expect(validateActionFields(body)).toEqual([]);
    }
    expect(validateActionFields(coerceActionBody({ status: 'frozen' }))).not.toEqual([]);
  });

  it('preserves a historical cancelled status when only title changes and ignores deprecated fields', async () => {
    const db = database({ atlas_actions: [{ id: 'a1', title: 'Old', status: 'cancelled' }], atlas_activity_log: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await request('/api/actions/a1', { title: 'New', cycle_id: { invalid: true }, workflow_status_id: false, template_id: 'x'.repeat(20000), template_instance_id: [] }, 'PUT');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ title: 'New', status: 'cancelled' });
    expect(db.writes.find(write => write.table === 'atlas_actions')?.fields).toEqual({ title: 'New', updated_at: expect.any(String) });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('ignored deprecated field');
  });

  it.each([['triage', 'open'], ['backlog', 'not_started'], ['cancelled', 'canceled']])('maps %s only when explicitly written', async (status, canonical) => {
    const db = database({ atlas_actions: [{ id: 'a1', status: 'waiting' }], atlas_activity_log: [] });
    const response = await request('/api/actions/a1', { status }, 'PUT');
    expect(response.status).toBe(200);
    expect(db.writes[0].fields).toMatchObject({ status: canonical });
  });

  it.each(['completed', 'closed', 'done', 'archived'])('keeps explicit transition protection for %s', async status => {
    const db = database({ atlas_actions: [{ id: 'a1', status: 'waiting' }] });
    const response = await request('/api/actions/a1', { status }, 'PUT');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'EXPLICIT_TRANSITION_REQUIRED' });
    expect(db.writes).toEqual([]);
  });

  it('creates triage-compatible actions as open without workflow RPCs', async () => {
    const db = database({ atlas_actions: [], atlas_activity_log: [], atlas_config: [] });
    const response = await request('/api/actions', { title: 'New task', business: 'personal', triage: true });
    expect(response.status).toBe(201);
    expect(db.writes.find(write => write.table === 'atlas_actions')?.fields).toMatchObject({ status: 'open' });
    expect(JSON.stringify(await response.json())).not.toMatch(/workflow_status|workflow_automation_runs/);
  });
});

describe('retained reads without retired tables', () => {
  it.each(['', '?sort_by=title&cycle_id=old&template_id=old&release_id=old&pipeline_id=old&stage_run_id=old&include_triage=false'])('lists actions with plain action rows (%s)', async suffix => {
    const db = database({ atlas_actions: [{ id: 'a1', title: 'Needs triage', status: 'open', priority: 'p1' }] });
    const response = await request(`/api/actions${suffix}`);
    expect(response.status).toBe(200);
    const body = await response.json() as Row;
    expect(body.items[0]).toMatchObject({ id: 'a1', status: 'open' });
    expect(db.selects).toEqual(['*']);
    expect(JSON.stringify(body)).not.toMatch(/workflow_status|workflow_automation_runs/);
  });

  it('loads action detail without release or workflow joins', async () => {
    const db = database({ atlas_actions: [{ id: 'a1', status: 'cancelled' }] });
    const response = await request('/api/actions/a1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'cancelled' });
    expect(db.selects).toEqual(['*']);
  });

  it.each(['/api/projects?initiative=old&template_id=old', '/api/projects/p1'])('loads %s without initiative memberships', async path => {
    const updated = new Date().toISOString();
    database({
      atlas_projects: [{ id: 'p1', status: 'in_progress', updated_at: '2020-01-01T00:00:00Z' }],
      atlas_actions: [{ id: 'a1', project_id: 'p1', status: 'open', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' }],
      atlas_project_updates: [{ project_id: 'p1', created_at: updated }],
      atlas_project_milestones: [], atlas_project_dependencies: [], atlas_project_activity_log: [], atlas_config: [],
    });
    const response = await request(path);
    expect(response.status).toBe(200);
    const body = await response.json() as Row;
    const project = body.items ? body.items[0] : body;
    expect(project).toMatchObject({ open_action_count: 1, last_activity_at: updated, is_stale: false });
    expect(project.oldest_open_days).toBeGreaterThan(2000);
    expect(project).not.toHaveProperty('initiatives');
  });

  it('lists and filters stored notifications for retired categories', async () => {
    database({ atlas_notifications: [{ id: 'n1', principal_id: 'claude', status: 'unread', event: { category: 'releases', resource_type: 'release' } }] });
    const response = await request('/api/notifications?category=releases');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ items: [{ id: 'n1', event: { category: 'releases', resource_type: 'release' } }] });
  });
});

describe('project activity metrics', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  it('counts the specified open statuses, excludes archived actions and floors oldest age', () => {
    const actions = ['open', 'not_started', 'todo', 'in_progress', 'waiting', 'blocked', 'done', 'canceled', 'cancelled', 'archived'].map(status => ({ status, created_at: '2026-10-01T18:00:00Z' }));
    actions.push({ status: 'open', archived_at: '2026-10-17', created_at: '2000-01-01' } as any);
    expect(calculateProjectActivity({ status: 'in_progress', updated_at: '2026-10-01T12:00:00Z' }, actions, [], now)).toMatchObject({ open_action_count: 6, oldest_open_days: 16, is_stale: true });
  });
  it('is stale only strictly beyond fourteen days and uses the latest of all activity sources', () => {
    const project = { status: 'in_progress', updated_at: '2026-10-04T12:00:00Z' };
    expect(calculateProjectActivity(project, [], [], now).is_stale).toBe(false);
    expect(calculateProjectActivity({ ...project, updated_at: '2026-10-04T11:59:59Z' }, [], [], now).is_stale).toBe(true);
    expect(calculateProjectActivity(project, [{ updated_at: '2026-10-05T12:00:00Z' }], [{ created_at: '2026-10-06T12:00:00Z' }], now)).toMatchObject({ last_activity_at: '2026-10-06T12:00:00.000Z', is_stale: false });
    expect(calculateProjectActivity({ status: 'paused', updated_at: '2020-01-01' }, [], [], now).is_stale).toBe(false);
    expect(calculateProjectActivity(project, [], [], now).oldest_open_days).toBeNull();
  });
});

describe('retained input boundaries', () => {
  it('ignores both saved-view initiative context and cycle filters before validation', async () => {
    const db = database({ atlas_saved_views: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await request('/api/views', { name: 'Tasks', entity_type: 'action', context_project_id: 'p1', context_initiative_id: { invalid: true }, filters: { status: 'open', cycle_id: 'old' } }, 'POST', true);
    expect(response.status).toBe(201);
    const fields = db.writes[0].fields as Row;
    expect(fields).not.toHaveProperty('context_initiative_id');
    expect(fields.filters).toEqual({ status: 'open' });
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each(['/api/projects', '/api/documents'])('ignores template input for %s', async path => {
    const table = path.endsWith('projects') ? 'atlas_projects' : 'atlas_documents';
    const db = database({ [table]: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await request(path, { name: 'Project', title: 'Document', template_id: { name: 'x'.repeat(10000) }, template_instance_id: [] }, 'POST', true);
    expect(response.status).toBe(201);
    expect(db.writes[0].fields).not.toHaveProperty('template_id');
    expect(db.writes[0].fields).not.toHaveProperty('template_instance_id');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('ignores initiative subscription input without persisting it', async () => {
    const db = database({ atlas_integration_connections: [{ id: 'c1', status: 'draft' }], atlas_integration_subscriptions: [], atlas_integration_activity_log: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await request('/api/integrations/connections/c1/subscriptions', { name: 'Kept events', categories: ['comments'], resource_types: ['action'], initiative_id: { invalid: true } }, 'POST', true);
    expect(response.status).toBe(201);
    expect(db.writes[0].fields).not.toHaveProperty('initiative_id');
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each(['initiative_updates', 'cycles', 'releases', 'analytics', 'workflows'])('rejects new %s category settings while historical notifications remain readable', async category => {
    const preference = await request('/api/notifications/preferences', { channel: 'inbox', category, delivery_mode: 'immediate' }, 'PUT', true);
    expect(preference.status).toBe(400);
    database({ atlas_integration_connections: [{ id: 'c1' }] });
    const subscription = await request('/api/integrations/connections/c1/subscriptions', { categories: [category] }, 'POST', true);
    expect(subscription.status).toBe(400);
  });

  it.each(['initiative', 'cycle', 'template', 'release', 'insight', 'workflow'])('rejects new retired %s resources', async resource => {
    const notification = await request('/api/notifications/subscriptions', { target_type: resource, target_id: 'old' }, 'POST', true);
    expect(notification.status).toBe(400);
    database({ atlas_integration_connections: [{ id: 'c1' }] });
    const subscription = await request('/api/integrations/connections/c1/subscriptions', { resource_types: [resource] }, 'POST', true);
    expect(subscription.status).toBe(400);
    const reference = await request('/api/integrations/connections/c1/references', { resource_type: resource, resource_id: 'old', provider_ref: 'old' }, 'POST', true);
    expect(reference.status).toBe(400);
  });

  it.each(['initiative', 'cycle'])('rejects new %s document contexts', async context_type => {
    const response = await request('/api/documents', { title: 'Document', context_type, context_id: 'old' }, 'POST', true);
    expect(response.status).toBe(400);
  });

  it.each(['initiative', 'initiative_update'])('rejects new %s discussion targets', async target_type => {
    const response = await request('/api/comments', { target_type, target_id: 'old', body: 'Comment' }, 'POST', true);
    expect(response.status).toBe(400);
  });
});

describe('review regression fixes', () => {
  it.each([
    ['open', ['open', 'triage']],
    ['not_started', ['not_started', 'todo', 'backlog']],
    ['done', ['done', 'completed', 'closed']],
    ['canceled', ['canceled', 'cancelled']],
    ['archived', ['archived']],
  ] as [string, string[]][])('reads canonical %s and every stored alias in both list sort branches', async (canonical, spellings) => {
    const rows = ['open', 'triage', 'not_started', 'todo', 'backlog', 'done', 'completed', 'closed', 'canceled', 'cancelled', 'archived']
      .map((status, index) => ({ id: `a${index}`, title: status, priority: 'p1', status, archived_at: status === 'archived' ? '2026-10-01' : null }));
    for (const requested of spellings) {
      for (const sort_by of ['priority', 'title']) {
        const db = database({ atlas_actions: rows });
        const response = await request(`/api/actions?status=${requested}&sort_by=${sort_by}`);
        expect(response.status).toBe(200);
        const body = await response.json() as Row;
        expect(body.items.map((item: Row) => item.status).sort()).toEqual([...spellings].sort());
        expect(db.writes).toEqual([]);
      }
    }
  });

  it('preserves open-filter exclusion of both canceled spellings and archived rows', async () => {
    database({ atlas_actions: ['canceled', 'cancelled', 'archived'].map(status => ({ id: status, status })) });
    const response = await request('/api/actions?status=canceled,archived&open=true');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ items: [], total: 0 });
  });

  it.each(['/api/projects', '/api/projects/p1'])('paginates action and update metric sources beyond a server cap for %s', async path => {
    const recent = new Date(Date.now() - 86400000).toISOString();
    const db = database({
      atlas_projects: [
        { id: 'p1', name: 'Target project', status: 'in_progress', updated_at: '2020-01-01T00:00:00Z' },
        { id: 'p2', name: 'Other project', status: 'in_progress', updated_at: '2020-01-01T00:00:00Z' },
      ],
      atlas_actions: [
        { id: 'a1', project_id: 'p1', status: 'done', created_at: '2026-10-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' },
        { id: 'a2', project_id: 'p1', status: 'open', created_at: '2026-10-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' },
        { id: 'a3', project_id: 'p1', status: 'blocked', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' },
        { id: 'a4', project_id: 'p1', status: 'waiting', created_at: '2026-10-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' },
      ],
      atlas_project_updates: [
        { id: 'u1', project_id: 'p2', created_at: new Date().toISOString() },
        { id: 'u2', project_id: 'p2', created_at: new Date().toISOString() },
        { id: 'u3', project_id: 'p1', created_at: recent },
        { id: 'u4', project_id: 'p1', created_at: '2026-09-01T00:00:00Z' },
        { id: 'u5', project_id: 'p1', created_at: '2026-08-01T00:00:00Z' },
      ],
      atlas_project_milestones: [], atlas_project_dependencies: [], atlas_project_activity_log: [], atlas_config: [],
    }, 2);
    const response = await request(path);
    expect(response.status).toBe(200);
    const body = await response.json() as Row;
    const project = body.items ? body.items.find((item: Row) => item.id === 'p1') : body;
    expect(project).toMatchObject({ open_action_count: 3, last_activity_at: recent, is_stale: false });
    expect(project.oldest_open_days).toBeGreaterThan(2000);
    for (const table of ['atlas_actions', 'atlas_project_updates']) {
      const pages = db.pages.filter(page => page.table === table);
      expect(pages.length).toBeGreaterThan(1);
      expect(pages[0].start).toBe(0);
      expect(pages[1].start).toBe(2);
      expect(pages.every(page => page.orders.at(-1) === 'id')).toBe(true);
    }
    if (!body.items) {
      expect(project.actions).toHaveLength(4);
      expect(project.updates).toHaveLength(3);
    }
  });
});
