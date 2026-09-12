import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readAtlasTodayPlanMock } = vi.hoisted(() => ({
  readAtlasTodayPlanMock: vi.fn(),
}));

vi.mock('../automations/atlasToday', () => ({
  atlasTodayIsoDate: () => '2026-09-07',
  readAtlasTodayPlan: readAtlasTodayPlanMock,
}));

import { app } from '../index';
import type { Env } from '../db';

const nicoleCodexToken = 'nicole-codex-today-token-0001';
const env: Env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  NODE_ENV: 'production',
  ATLAS_API_PRINCIPALS_JSON: JSON.stringify({
    'nicole-codex': { token: nicoleCodexToken, scopes: ['actions:read'] },
  }),
};

beforeEach(() => {
  readAtlasTodayPlanMock.mockReset();
  readAtlasTodayPlanMock.mockResolvedValue({
    date: '2026-09-07',
    source: 'atlas_daily_plan',
    items: [],
  });
});

describe('Today HTTP projection', () => {
  it('passes the authenticated scoped principal into the Today query', async () => {
    const response = await app.request('/api/today?date=2026-09-07', {
      headers: { authorization: `Bearer ${nicoleCodexToken}` },
    }, env);

    expect(response.status).toBe(200);
    expect(readAtlasTodayPlanMock).toHaveBeenCalledWith(env, '2026-09-07', 'nicole-codex');
    await expect(response.json()).resolves.toMatchObject({ date: '2026-09-07', items: [] });
  });

  it('rejects the same route without actions read scope', async () => {
    const response = await app.request('/api/today', {
      headers: { authorization: `Bearer ${nicoleCodexToken}` },
    }, {
      ...env,
      ATLAS_API_PRINCIPALS_JSON: JSON.stringify({
        'nicole-codex': { token: nicoleCodexToken, scopes: ['principals:read'] },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INSUFFICIENT_SCOPE',
      details: { required_scope: 'actions:read' },
    });
    expect(readAtlasTodayPlanMock).not.toHaveBeenCalled();
  });
});
