import { Hono } from 'hono';
import { Env, getDb } from '../db';
import { buildDryRunPlan } from '../utils/todayPlan';

const router = new Hono<{ Bindings: Env }>();

function todayLocalDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function planDateFromQuery(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayLocalDate();
}

async function loadFallbackInputs(supabase: ReturnType<typeof getDb>) {
  const [actionsResult, workflowResult] = await Promise.all([
    supabase
      .from('atlas_actions')
      .select('id,title,description,status,business,priority,due_date,owners,tags,notes,updated_at,blocked_by,work_mode,next_action')
      .not('status', 'in', '("done","completed","complete","cancelled","canceled","applied","closed","archived")')
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase.from('atlas_config').select('value').eq('key', 'workflow_state').maybeSingle(),
  ]);

  return {
    actions: (actionsResult.data ?? []) as Record<string, unknown>[],
    workflowState: workflowResult.data?.value ?? {},
  };
}

async function dryRunFromRpcOrFallback(supabase: ReturnType<typeof getDb>, planDate: string, readiness = {}) {
  const { data, error } = await supabase.rpc('run_atlas_today_retriage_dry_run', {
    p_plan_date: planDate,
    p_readiness: readiness,
  });
  if (!error && data) return data;

  const inputs = await loadFallbackInputs(supabase);
  return buildDryRunPlan({ planDate, readiness, ...inputs });
}

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const planDate = planDateFromQuery(c.req.query('date'));
    const { data, error } = await supabase.rpc('get_atlas_today_plan', { p_plan_date: planDate });

    if (!error && data && data.plan && data.plan !== null && data.source === 'daily_plan') {
      return c.json({ ...data, generated_at: new Date().toISOString() });
    }

    const dryRun = await dryRunFromRpcOrFallback(supabase, planDate);
    return c.json({
      source: error ? 'fallback_dry_run' : 'dry_run',
      plan: {
        plan_date: dryRun.plan_date,
        status: 'dry_run',
        readiness_profile: dryRun.readiness_profile,
        source_coverage: dryRun.source_coverage,
        selected_capacity: dryRun.selected_capacity,
        summary: dryRun.summary,
      },
      items: dryRun.items ?? [],
      rule_version: null,
      rules: dryRun.rules ?? [],
      generated_at: new Date().toISOString(),
      warning: error ? 'Daily-plan RPC unavailable; returned deterministic API fallback.' : null,
    });
  } catch (err) {
    console.error(`[today] GET error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.get('/rules', async (c) => {
  try {
    const supabase = getDb(c.env);
    const [rulesResult, versionResult] = await Promise.all([
      supabase.from('atlas_today_rules').select('*').eq('enabled', true).order('rule_type').order('category').order('rule_key'),
      supabase.from('atlas_today_rule_versions').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (rulesResult.error) throw rulesResult.error;
    return c.json({
      rules: rulesResult.data ?? [],
      latest_rule_version: versionResult.data ?? null,
    });
  } catch (err) {
    console.error(`[today] rules error: ${(err as Error).message}`);
    return c.json({ rules: [], latest_rule_version: null, warning: 'Rules table unavailable.' });
  }
});

router.post('/dry-run', async (c) => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json().catch(() => ({}));
    const planDate = planDateFromQuery(body?.date);
    const dryRun = await dryRunFromRpcOrFallback(supabase, planDate, body?.readiness ?? {});
    return c.json({ source: 'dry_run', ...dryRun });
  } catch (err) {
    console.error(`[today] dry-run error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json();
    const { data, error } = await supabase.rpc('upsert_atlas_today_plan', {
      p_plan: body.plan ?? {},
      p_items: body.items ?? [],
    });
    if (error) throw error;
    return c.json({ plan_id: data });
  } catch (err) {
    console.error(`[today] upsert error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/rule-proposals', async (c) => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json();
    const { data, error } = await supabase.rpc('propose_atlas_today_rule_change', { p_payload: body });
    if (error) throw error;
    return c.json({ proposal_id: data }, 201);
  } catch (err) {
    console.error(`[today] proposal error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

router.post('/rule-proposals/:id/activate', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase.rpc('activate_atlas_today_rule_proposal', {
      p_proposal_id: c.req.param('id'),
    });
    if (error) throw error;
    return c.json({ rule_version_id: data });
  } catch (err) {
    console.error(`[today] activate proposal error: ${(err as Error).message}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
