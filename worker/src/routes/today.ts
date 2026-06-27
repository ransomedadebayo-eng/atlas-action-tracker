import { Hono } from 'hono';
import { Env, getDb } from '../db';

const router = new Hono<{ Bindings: Env }>();
const NON_DONE_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'todo', 'open'];

function todayLocalDate() {
  return new Date().toISOString().slice(0, 10);
}

router.get('/', async (c) => {
  const supabase = getDb(c.env);
  const date = c.req.query('date') || todayLocalDate();

  try {
    const { data: plan, error: planError } = await supabase
      .from('atlas_daily_plans')
      .select('*')
      .eq('plan_date', date)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (planError) throw planError;

    if (!plan) {
      return c.json({ date, plan: null, items: [], source: 'fallback' });
    }

    const { data: items, error: itemsError } = await supabase
      .from('atlas_daily_plan_items')
      .select('*')
      .eq('plan_id', plan.id)
      .eq('item_status', 'selected')
      .order('rank', { ascending: true });

    if (itemsError) throw itemsError;

    const actionIds = Array.from(new Set((items || [])
      .map((item) => item.source_action_id)
      .filter(Boolean)));

    let actionById = new Map<string, Record<string, unknown>>();
    if (actionIds.length > 0) {
      const { data: actions, error: actionsError } = await supabase
        .from('atlas_actions')
        .select('*')
        .in('id', actionIds);
      if (actionsError) throw actionsError;
      actionById = new Map((actions || []).map((action) => [String(action.id), action as Record<string, unknown>]));
    }

    return c.json({
      date,
      plan,
      source: 'atlas_daily_plan',
      items: (items || []).map((item) => ({
        ...item,
        action: item.source_action_id ? actionById.get(item.source_action_id) || null : null,
      })),
    });
  } catch (err) {
    console.error(`[today] GET error: ${(err as Error).message}`);

    const { data, error } = await supabase
      .from('atlas_actions')
      .select('*')
      .in('status', NON_DONE_STATUSES)
      .lte('due_date', date)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5);

    if (error) {
      console.error(`[today] fallback error: ${error.message}`);
      return c.json({ error: 'Internal server error' }, 500);
    }

    return c.json({
      date,
      plan: null,
      source: 'due_date_fallback',
      items: (data || []).map((action, index) => ({
        id: action.id,
        source_action_id: action.id,
        item_status: 'selected',
        rank: index + 1,
        title: action.title,
        summary: action.next_action || action.description || '',
        reason: action.due_date === date ? 'Due today.' : 'Overdue and still open.',
        estimated_effort: null,
        source_confidence: 'medium',
        matched_rules: [],
        action,
      })),
    });
  }
});

export default router;
