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
    const fallback = await fallbackTodayCandidates(supabase, date);
    return {
      date,
      plan: null,
      source: 'due_date_fallback',
      items: fallback,
      selected: [],
      review: [],
      deferred: [],
      suppressed: [],
      fallback,
      diagnostics: {
        code: 'missing_daily_plan',
        message: `No Atlas Today plan exists for ${date}. Showing due and overdue fallback candidates until the guarded stewardship protocol writes a plan.`,
      },
    };
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
