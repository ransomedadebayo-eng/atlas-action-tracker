import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('../db', () => ({
  getDb: getDbMock,
}));

import { atlasTodayIsoDate, readAtlasTodayPlan } from './atlasToday';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only',
};

function planQuery(plan: Record<string, unknown> | null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: plan, error: null }),
      }),
    }),
  };
}

function fallbackQuery(fallback: Record<string, unknown>[], weeklyActions: Record<string, unknown>[] = []) {
  const fallbackResult = {
    order: vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: fallback, error: null }),
      }),
    }),
  };
  const inResult = {
    lte: vi.fn().mockReturnValue(fallbackResult),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: weeklyActions, error: null }).then(resolve, reject),
  };
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue(inResult),
    }),
  };
}

function planItemsQuery(items: Record<string, unknown>[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: items, error: null }),
        }),
      }),
    }),
  };
}

function weeklyRevisionQuery(revision: Record<string, unknown> | null = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: revision, error: null }),
        }),
      }),
    }),
  };
}

function weeklyItemsQuery(items: Record<string, unknown>[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: items, error: null }),
          }),
        }),
      }),
    }),
  };
}

function dbFor({
  plan,
  fallback = [],
  items = [],
  weeklyRevision = null,
  weeklyItems = [],
  weeklyActions = [],
}: {
  plan: Record<string, unknown> | null;
  fallback?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  weeklyRevision?: Record<string, unknown> | null;
  weeklyItems?: Record<string, unknown>[];
  weeklyActions?: Record<string, unknown>[];
}) {
  const from = vi.fn((table: string) => {
    if (table === 'atlas_daily_plans') return planQuery(plan);
    if (table === 'atlas_actions') return fallbackQuery(fallback, weeklyActions);
    if (table === 'atlas_daily_plan_items') return planItemsQuery(items);
    if (table === 'atlas_weekly_plan_revisions') return weeklyRevisionQuery(weeklyRevision);
    if (table === 'atlas_weekly_plan_items') return weeklyItemsQuery(weeklyItems);
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from };
}

beforeEach(() => {
  getDbMock.mockReset();
});

describe('atlasTodayIsoDate', () => {
  it('uses the ATLAS Pacific calendar date across the UTC rollover', () => {
    expect(atlasTodayIsoDate(new Date('2026-07-10T06:59:59Z'))).toBe('2026-07-09');
    expect(atlasTodayIsoDate(new Date('2026-07-10T07:00:00Z'))).toBe('2026-07-10');
  });
});

describe('readAtlasTodayPlan', () => {
  it('returns an active same-date plan as the authoritative Today source', async () => {
    const plan = { id: 'plan-active', plan_date: '2026-07-30', status: 'active' };
    const db = dbFor({ plan });
    getDbMock.mockReturnValue(db);

    const result = await readAtlasTodayPlan(env, '2026-07-30');

    expect(result).toMatchObject({
      plan,
      source: 'atlas_daily_plan',
      diagnostics: null,
      items: [],
      fallback: [],
    });
    expect(db.from).toHaveBeenCalledWith('atlas_daily_plan_items');
  });

  it.each(['draft', 'blocked', 'superseded'])(
    'does not present a %s plan as authoritative',
    async status => {
      const plan = { id: `plan-${status}`, plan_date: '2026-07-30', status };
      const fallback = [{ id: 'action-overdue', title: 'Due fallback' }];
      const db = dbFor({ plan, fallback });
      getDbMock.mockReturnValue(db);

      const result = await readAtlasTodayPlan(env, '2026-07-30');

      expect(result).toMatchObject({
        plan,
        source: 'due_date_fallback',
        items: fallback,
        fallback,
        selected: [],
        diagnostics: {
          code: 'inactive_daily_plan',
          plan_status: status,
          plan_id: plan.id,
        },
      });
      expect(db.from).not.toHaveBeenCalledWith('atlas_daily_plan_items');
    },
  );

  it('distinguishes a missing plan from an inactive one', async () => {
    const fallback = [{ id: 'action-due', title: 'Due today' }];
    const db = dbFor({ plan: null, fallback });
    getDbMock.mockReturnValue(db);

    const result = await readAtlasTodayPlan(env, '2026-07-30');

    expect(result).toMatchObject({
      plan: null,
      source: 'due_date_fallback',
      items: fallback,
      diagnostics: {
        code: 'missing_daily_plan',
      },
    });
  });

  it('uses the published weekly focus before due-date fallback', async () => {
    const weeklyRevision = { id: 'week-revision', week_start: '2026-07-27', version: 1, status: 'published' };
    const weeklyItem = { id: 'week-item', kind: 'day_focus', plan_date: '2026-07-30', source_action_id: 'action-week', title: 'Weekly focus' };
    const weeklyAction = { id: 'action-week', title: 'Canonical weekly action', status: 'in_progress' };
    const db = dbFor({ plan: null, fallback: [{ id: 'due-action' }], weeklyRevision, weeklyItems: [weeklyItem], weeklyActions: [weeklyAction] });
    getDbMock.mockReturnValue(db);

    const result = await readAtlasTodayPlan(env, '2026-07-30');

    expect(result).toMatchObject({
      source: 'weekly_plan_guidance',
      items: [{ id: 'week-item', action: weeklyAction }],
      diagnostics: { code: 'missing_daily_plan', weekly_revision_id: 'week-revision' },
    });
  });
});
