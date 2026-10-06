import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index';
import { getDb } from '../db';
import type { Env } from '../db';
import { loadWorkflowAction } from '../services/workflows';

vi.mock('../db', () => ({ getDb: vi.fn() }));
vi.mock('../services/workflows', () => ({
  executeWorkflowRules: vi.fn().mockResolvedValue(null),
  loadWorkflowAction: vi.fn(),
}));

const token = 'codex-partial-update-test-only-token';
const env: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-only',
  NODE_ENV: 'production',
  ATLAS_API_PRINCIPALS_JSON: JSON.stringify({ codex: { token, scopes: ['actions:write'] } }),
};

describe('partial action update HTTP contract', () => {
  let record: Record<string, unknown>;
  let update: ReturnType<typeof vi.fn>;
  let concurrentEdit: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    record = {
      id: 'a1', title: 'Repair follow-up', status: 'waiting', priority: 'p1',
      due_date: '2026-10-09', owners: ['ransomed'], tags: ['repair'],
      notes: 'Existing history.', next_action: 'Old next step', revision: 11,
    };
    concurrentEdit = () => {};
    update = vi.fn();
    const from = vi.fn((table: string) => {
      if (table === 'atlas_activity_log') return { insert: vi.fn().mockResolvedValue({ error: null }) };
      if (table !== 'atlas_actions') throw new Error(`Unexpected table: ${table}`);
      let patch: Record<string, unknown> | undefined;
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: (fields: Record<string, unknown>) => {
          update(fields);
          patch = fields;
          return query;
        },
        single: async () => {
          if (patch) {
            concurrentEdit();
            record = { ...record, ...patch };
          }
          return { data: { ...record }, error: null };
        },
      };
      return query;
    });
    vi.mocked(getDb).mockReturnValue({ from } as unknown as ReturnType<typeof getDb>);
    vi.mocked(loadWorkflowAction).mockImplementation(async () => ({ ...record }));
  });

  function put(body: Record<string, unknown>) {
    return app.request('/api/actions/a1', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, env);
  }

  it.each([10499, 10598])('preserves all untouched fields and %i characters of notes', async length => {
    const prefix = '  History <keep>—\n';
    const suffix = '\n  ';
    record.notes = prefix + 'x'.repeat(length - prefix.length - suffix.length) + suffix;
    const before = { ...record };
    const response = await put({ next_action: 'Await approved schedule.' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledExactlyOnceWith({ next_action: 'Await approved schedule.', updated_at: expect.any(String) });
    expect(record).toEqual({ ...before, next_action: 'Await approved schedule.', updated_at: expect.any(String) });
    expect((await response.json() as Record<string, unknown>).notes).toBe(before.notes);
  });

  it('preserves unrelated edits made between the server read and partial update', async () => {
    const concurrent = {
      notes: 'Concurrent history\n' + 'x'.repeat(10598), title: 'Owner title',
      status: 'in_progress', priority: 'p0', due_date: '2026-10-10', revision: 12,
    };
    concurrentEdit = () => { record = { ...record, ...concurrent }; };
    const response = await put({ next_action: 'Await visit findings.' });

    expect(response.status).toBe(200);
    expect(record).toMatchObject({ ...concurrent, next_action: 'Await visit findings.' });
    expect(update).toHaveBeenCalledExactlyOnceWith({ next_action: 'Await visit findings.', updated_at: expect.any(String) });
  });

  it('continues rejecting a new oversized notes replacement', async () => {
    const before = { ...record };
    const response = await put({ notes: 'n'.repeat(10001) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'notes exceeds maximum length of 10000 characters' });
    expect(update).not.toHaveBeenCalled();
    expect(record).toEqual(before);
  });
});
