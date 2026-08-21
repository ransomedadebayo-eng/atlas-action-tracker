import { Env, getDb } from '../db';

type Supabase = ReturnType<typeof getDb>;

const ACTIVE_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'todo', 'open'];

function isoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function fallbackTodayCandidates(supabase: Supabase, date: string) {
  const { data, error } = await supabase
    .from('atlas_actions')
    .select('id,title,description,status,business,priority,due_date,review_date,owners,work_mode,next_action,updated_at')
    .in('status', ACTIVE_STATUSES)
    .lte('due_date', date)
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(5);
  if (error) throw error;
  return data || [];
}

function atlasWeekStart(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

async function weeklyGuidance(supabase: Supabase, date: string) {
  const weekStart = atlasWeekStart(date);
  const { data: revision, error: revisionError } = await supabase
    .from('atlas_weekly_plan_revisions')
    .select('id,week_start,version,status,title,revision')
    .eq('week_start', weekStart)
    .eq('status', 'published')
    .maybeSingle();
  if (revisionError) throw revisionError;
  if (!revision) return null;

  const { data: rows, error: itemsError } = await supabase
    .from('atlas_weekly_plan_items')
    .select('*')
    .eq('weekly_revision_id', revision.id)
    .eq('plan_date', date)
    .in('kind', ['day_focus', 'must_win'])
    .order('rank', { ascending: true });
  if (itemsError) throw itemsError;
  const items = rows || [];
  const actionIds = Array.from(new Set(items.map(item => item.source_action_id).filter(Boolean)));
  if (actionIds.length === 0) return { revision, items: [], weekStart };
  const { data: actions, error: actionsError } = await supabase
    .from('atlas_actions')
    .select('*')
    .in('id', actionIds);
  if (actionsError) throw actionsError;
  const actionById = new Map((actions || []).map(action => [String(action.id), action]));
  return {
    revision,
    weekStart,
    items: items.map(item => ({ ...item, action: actionById.get(String(item.source_action_id)) || null })),
  };
}

async function buildFallbackResponse(supabase: Supabase, date: string, reason: string, plan: Record<string, unknown> | null = null) {
  const weekly = await weeklyGuidance(supabase, date);
  const weeklyItems = (weekly?.items || []).filter(item => item.action);
  if (weekly && weeklyItems.length > 0) {
    return {
      date,
      plan,
      source: 'weekly_plan_guidance',
      items: weeklyItems,
      selected: weeklyItems,
      review: [],
      deferred: [],
      suppressed: [],
      fallback: [],
      weekly_plan: weekly.revision,
      diagnostics: {
        code: reason,
        message: `No active Atlas Today plan was available for ${date}. Showing the published weekly focus for this day; daily stewardship may retriage it.`,
        weekly_revision_id: weekly.revision.id,
        week_start: weekly.weekStart,
        ...(plan ? { plan_status: plan.status, plan_id: plan.id } : {}),
        deviation_allowed: true,
      },
    };
  }
  const fallback = await fallbackTodayCandidates(supabase, date);
  return {
    date,
    plan,
    source: 'due_date_fallback',
    items: fallback,
    selected: [],
    review: [],
    deferred: [],
    suppressed: [],
    fallback,
    weekly_plan: weekly?.revision || null,
    diagnostics: {
      code: reason,
      message: `No active Atlas Today plan or published weekly focus was available for ${date}. Showing due and overdue fallback candidates until guarded stewardship writes a plan.`,
      weekly_revision_id: weekly?.revision?.id || null,
      ...(plan ? { plan_status: plan.status, plan_id: plan.id } : {}),
    },
  };
}

/**
 * Read-only projection of the plan written by guarded Codex protocols.
 * The Worker intentionally contains no plan generation or automation mutation path.
 */
export async function readAtlasTodayPlan(env: Env, date = isoDate()) {
  const supabase = getDb(env);
  const { data: plan, error } = await supabase
    .from('atlas_daily_plans')
    .select('*')
    .eq('plan_date', date)
    .maybeSingle();
  if (error) throw error;

  if (!plan) {
    return buildFallbackResponse(supabase, date, 'missing_daily_plan');
  }

  if (plan.status !== 'active') {
    return buildFallbackResponse(supabase, date, 'inactive_daily_plan', plan);
  }

  const { data: items, error: itemsError } = await supabase
    .from('atlas_daily_plan_items')
    .select('*')
    .eq('plan_id', plan.id)
    .order('item_status', { ascending: true })
    .order('rank', { ascending: true, nullsFirst: false });
  if (itemsError) throw itemsError;

  const rows = items || [];
  const actionIds = Array.from(new Set(rows.map(item => item.source_action_id).filter(Boolean)));
  let actionById = new Map<string, Record<string, unknown>>();
  if (actionIds.length > 0) {
    const { data: actions, error: actionsError } = await supabase
      .from('atlas_actions')
      .select('*')
      .in('id', actionIds);
    if (actionsError) throw actionsError;
    actionById = new Map((actions || []).map(action => [String(action.id), action as Record<string, unknown>]));
  }

  const hydratedRows = rows.map(item => ({
    ...item,
    action: item.source_action_id ? actionById.get(String(item.source_action_id)) || null : null,
  }));
  const selected = hydratedRows.filter(item => item.item_status === 'selected');
  const review = hydratedRows.filter(item => item.item_status === 'review');
  const deferred = hydratedRows.filter(item => item.item_status === 'deferred');
  const suppressed = hydratedRows.filter(item => item.item_status === 'suppressed');

  return {
    date,
    plan,
    source: 'atlas_daily_plan',
    items: selected,
    selected,
    review,
    deferred,
    suppressed,
    fallback: [],
    diagnostics: null,
  };
}

export { isoDate as atlasTodayIsoDate };
