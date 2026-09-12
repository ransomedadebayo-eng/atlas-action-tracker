import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';
import { validateKnownBusinessId } from '../utils/referenceData';

const router = new Hono<{ Bindings: Env }>();
type Row = Record<string, unknown>;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMPLETE = new Set(['done', 'completed', 'closed']);
const STARTED = new Set(['in_progress', 'waiting', 'blocked']);

function escapeIcs(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsDate(value: unknown) {
  return String(value || '').replaceAll('-', '');
}

function addUtcDays(value: unknown, days: number) {
  const date = new Date(`${String(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function cyclesToIcs(cycles: Row[], calendarName = 'Atlas Cycles') {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Atlas//Cycles//EN',
    'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  ];
  for (const cycle of cycles) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:atlas-cycle-${escapeIcs(cycle.id)}@atlas.ransomed.app`,
      `DTSTART;VALUE=DATE:${icsDate(cycle.start_date)}`,
      `DTEND;VALUE=DATE:${icsDate(addUtcDays(cycle.end_date, 1))}`,
      `SUMMARY:${escapeIcs(cycle.name)}`,
      `DESCRIPTION:${escapeIcs(`${cycle.status || 'planned'} Atlas cycle`)}`,
      `URL:https://atlas.ransomed.app/cycles/${encodeURIComponent(String(cycle.id))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function validDate(value: unknown) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateCycleConfig(body: Row): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(body.duration_weeks) || Number(body.duration_weeks) < 1 || Number(body.duration_weeks) > 8) errors.push('duration_weeks must be between 1 and 8');
  if (![0, 7, 14].includes(Number(body.cooldown_days))) errors.push('cooldown_days must be 0, 7, or 14');
  if (!Number.isSafeInteger(body.future_cycles) || Number(body.future_cycles) < 1 || Number(body.future_cycles) > 15) errors.push('future_cycles must be between 1 and 15');
  if (!validDate(body.start_date)) errors.push('start_date must be a valid YYYY-MM-DD date');
  if (typeof body.auto_rollover !== 'boolean') errors.push('auto_rollover must be boolean');
  if (typeof body.auto_add_started !== 'boolean') errors.push('auto_add_started must be boolean');
  if (body.business !== undefined && body.business !== null && (typeof body.business !== 'string' || !body.business.trim())) errors.push('business must be a configured id or null');
  return errors;
}

function effort(action: Row, unestimatedValue: number) {
  return Number.isSafeInteger(action.estimate_points) ? Number(action.estimate_points) : unestimatedValue;
}

export function calculateCycleMetrics(actions: Row[], unestimatedValue = 1) {
  const scopeEffort = actions.reduce((sum, action) => sum + effort(action, unestimatedValue), 0);
  const completedActions = actions.filter(action => COMPLETE.has(String(action.status)));
  const startedActions = actions.filter(action => STARTED.has(String(action.status)));
  const completedEffort = completedActions.reduce((sum, action) => sum + effort(action, unestimatedValue), 0);
  const startedEffort = startedActions.reduce((sum, action) => sum + effort(action, unestimatedValue), 0);
  const successPercent = scopeEffort === 0 ? 0 : Math.round(((completedEffort + startedEffort * 0.25) / scopeEffort) * 10000) / 100;
  return {
    issue_count: actions.length,
    completed_count: completedActions.length,
    started_count: startedActions.length,
    scope_effort: scopeEffort,
    completed_effort: completedEffort,
    started_effort: startedEffort,
    completion_percent: scopeEffort === 0 ? 0 : Math.round((completedEffort / scopeEffort) * 100),
    success_percent: successPercent,
  };
}

export function calculateCycleCapacity(completedCycles: Row[], principalCount: number, durationWeeks: number, override: unknown = null) {
  if (Number.isSafeInteger(override) && Number(override) >= 0) return { value: Number(override), source: 'override', history_count: completedCycles.length };
  const history = completedCycles
    .map(cycle => cycle.completed_effort_snapshot)
    .filter(value => typeof value === 'number')
    .slice(-3) as number[];
  if (history.length > 0) return { value: Math.round((history.reduce((sum, value) => sum + value, 0) / history.length) * 100) / 100, source: 'previous_three_cycles', history_count: history.length };
  return { value: Math.max(1, principalCount) * Math.max(1, durationWeeks) * 5, source: 'principal_baseline', history_count: 0 };
}

function cycleRpcError(c: Parameters<typeof apiError>[0], error: { code?: string; message?: string }, fallback: string) {
  const message = error.message || '';
  if (error.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c, 409, 'REVISION_CONFLICT', 'The cycle changed. Refresh and retry.');
  if (error.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c, 404, 'CYCLE_REFERENCE_NOT_FOUND', 'The cycle, schedule, or action was not found.');
  if (error.code === '42501' || message.includes('OWNER_REQUIRED')) return apiError(c, 403, 'OWNER_REQUIRED', 'Only the ATLAS owner can perform this cycle lifecycle operation.');
  if (error.code === '55000') return apiError(c, 409, 'CYCLE_NOT_MUTABLE', message || fallback);
  if (['22023', '23505', '23514'].includes(String(error.code))) return apiError(c, 400, 'INVALID_CYCLE_OPERATION', message || fallback);
  console.error(`[cycles] RPC error: ${message || error.code || 'unknown'}`);
  return apiError(c, 500, 'CYCLE_OPERATION_FAILED', fallback);
}

async function loadContext(supabase: ReturnType<typeof getDb>, business?: string) {
  let scheduleQuery = supabase.from('atlas_cycle_schedules').select('*').eq('enabled', true);
  if (business) scheduleQuery = scheduleQuery.or(`business.eq.${business.replace(/[,()]/g, '')},business.is.null`);
  const [schedulesResult, estimateResult, principalsResult] = await Promise.all([
    scheduleQuery.order('created_at', { ascending: true }),
    supabase.from('atlas_config').select('value').eq('key', 'estimate_settings').maybeSingle(),
    supabase.from('atlas_members').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  if (schedulesResult.error) throw schedulesResult.error;
  if (estimateResult.error) throw estimateResult.error;
  if (principalsResult.error) throw principalsResult.error;
  return {
    schedules: (schedulesResult.data || []) as Row[],
    unestimatedValue: Number.isSafeInteger(estimateResult.data?.value?.unestimated_value) ? Number(estimateResult.data?.value?.unestimated_value) : 1,
    principalCount: principalsResult.count || 1,
  };
}

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const business = c.req.query('business') || undefined;
    const context = await loadContext(supabase, business);
    const scheduleIds = context.schedules.map(schedule => String(schedule.id));
    let cycles: Row[] = [];
    if (scheduleIds.length > 0) {
      const cycleResult = await supabase.from('atlas_cycles').select('*').in('schedule_id', scheduleIds).neq('status', 'archived').order('start_date', { ascending: true });
      if (cycleResult.error) throw cycleResult.error;
      cycles = (cycleResult.data || []) as Row[];
    }
    const cycleIds = cycles.map(cycle => String(cycle.id));
    let actions: Row[] = [];
    if (cycleIds.length > 0) {
      const actionResult = await supabase.from('atlas_actions').select('id,cycle_id,status,estimate_points,owners').in('cycle_id', cycleIds);
      if (actionResult.error) throw actionResult.error;
      actions = (actionResult.data || []) as Row[];
    }
    const enriched: Row[] = cycles.map(cycle => {
      const schedule = context.schedules.find(item => item.id === cycle.schedule_id) || {};
      const completedHistory = cycles.filter(item => item.schedule_id === cycle.schedule_id && item.status === 'completed' && String(item.start_date) < String(cycle.start_date));
      const liveMetrics = calculateCycleMetrics(actions.filter(action => action.cycle_id === cycle.id), context.unestimatedValue);
      const snapshot = Array.isArray(cycle.action_snapshot) ? cycle.action_snapshot as Row[] : [];
      const metrics = cycle.status === 'completed' ? {
        issue_count: snapshot.length,
        completed_count: snapshot.filter(action => COMPLETE.has(String(action.status))).length,
        started_count: snapshot.filter(action => STARTED.has(String(action.status))).length,
        scope_effort: Number(cycle.scope_effort_snapshot || 0),
        completed_effort: Number(cycle.completed_effort_snapshot || 0),
        started_effort: Number(cycle.started_effort_snapshot || 0),
        completion_percent: Number(cycle.scope_effort_snapshot || 0) === 0 ? 0 : Math.round((Number(cycle.completed_effort_snapshot || 0) / Number(cycle.scope_effort_snapshot)) * 100),
        success_percent: Number(cycle.success_percent_snapshot || 0),
      } : liveMetrics;
      const capacity = calculateCycleCapacity(completedHistory, context.principalCount, Number(schedule.duration_weeks || 1), cycle.capacity_override);
      return { ...cycle, metrics, capacity, capacity_load_percent: capacity.value === 0 ? 0 : Math.round((metrics.scope_effort / capacity.value) * 100), schedule };
    });
    return c.json({
      schedules: context.schedules,
      cycles: enriched,
      current: enriched.filter(cycle => cycle.status === 'active'),
      upcoming: enriched.filter(cycle => cycle.status === 'planned'),
      completed: enriched.filter(cycle => cycle.status === 'completed').reverse(),
      as_of: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[cycles] list error: ${(error as Error).message}`);
    return apiError(c, 500, 'CYCLE_LIST_FAILED', 'Unable to load cycles.');
  }
});

router.post('/configure', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const errors = validateCycleConfig(body);
    const supabase = getDb(c.env);
    const businessError = await validateKnownBusinessId(supabase, body.business);
    if (businessError) errors.push(businessError);
    if (errors.length > 0) return apiError(c, 400, 'INVALID_CYCLE_CONFIG', errors.join('; '));
    const scheduleId = typeof body.schedule_id === 'string' && body.schedule_id ? body.schedule_id : uuidv4();
    const { data, error } = await supabase.rpc('configure_atlas_cycle_schedule', {
      p_schedule_id: scheduleId,
      p_business: body.business || null,
      p_duration_weeks: body.duration_weeks,
      p_cooldown_days: body.cooldown_days,
      p_future_cycles: body.future_cycles,
      p_start_date: body.start_date,
      p_timezone: body.timezone || 'America/Los_Angeles',
      p_auto_rollover: body.auto_rollover,
      p_auto_add_started: body.auto_add_started,
      p_actor: getActor(c),
      p_expected_revision: Number.isSafeInteger(body.expected_revision) ? body.expected_revision : null,
    });
    if (error) return cycleRpcError(c, error, 'Unable to configure the cycle schedule.');
    return c.json(data, 201);
  } catch (error) {
    console.error(`[cycles] configure error: ${(error as Error).message}`);
    return apiError(c, 500, 'CYCLE_CONFIG_FAILED', 'Unable to configure the cycle schedule.');
  }
});

router.get('/calendar.ics', async (c) => {
  try {
    const business = c.req.query('business') || undefined;
    const context = await loadContext(getDb(c.env), business);
    const scheduleIds = context.schedules.map(schedule => String(schedule.id));
    let cycles: Row[] = [];
    if (scheduleIds.length) {
      const result = await getDb(c.env).from('atlas_cycles').select('*').in('schedule_id', scheduleIds).neq('status', 'archived').order('start_date');
      if (result.error) throw result.error;
      cycles = (result.data || []) as Row[];
    }
    return c.body(cyclesToIcs(cycles, business ? `Atlas ${business} Cycles` : 'Atlas Cycles'), 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="atlas-cycles.ics"',
      'Cache-Control': 'private, no-store',
    });
  } catch (error) {
    console.error(`[cycles] calendar error: ${(error as Error).message}`);
    return apiError(c, 500, 'CYCLE_CALENDAR_FAILED', 'Unable to export the cycle calendar.');
  }
});

router.get('/:id/calendar.ics', async (c) => {
  try {
    const { data, error } = await getDb(c.env).from('atlas_cycles').select('*').eq('id', c.req.param('id')).maybeSingle();
    if (error) throw error;
    if (!data) return apiError(c, 404, 'CYCLE_NOT_FOUND', 'Cycle not found.');
    return c.body(cyclesToIcs([data as Row], String(data.name || 'Atlas Cycle')), 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="atlas-${String(data.id).replace(/[^A-Za-z0-9_-]/g, '')}.ics"`,
      'Cache-Control': 'private, no-store',
    });
  } catch (error) {
    console.error(`[cycles] calendar detail error: ${(error as Error).message}`);
    return apiError(c, 500, 'CYCLE_CALENDAR_FAILED', 'Unable to export the cycle calendar.');
  }
});

router.get('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data: cycle, error: cycleError } = await supabase.from('atlas_cycles').select('*').eq('id', c.req.param('id')).maybeSingle();
    if (cycleError) throw cycleError;
    if (!cycle) return apiError(c, 404, 'CYCLE_NOT_FOUND', 'Cycle not found.');
    const [scheduleResult, actionsResult, eventsResult, activityResult, siblingsResult, estimateResult, principalsResult] = await Promise.all([
      supabase.from('atlas_cycle_schedules').select('*').eq('id', cycle.schedule_id).single(),
      supabase.from('atlas_actions').select('*').eq('cycle_id', cycle.id).order('priority', { ascending: true }).order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('atlas_cycle_scope_events').select('*').eq('cycle_id', cycle.id).order('created_at', { ascending: true }).order('id', { ascending: true }),
      supabase.from('atlas_cycle_activity_log').select('*').eq('cycle_id', cycle.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('atlas_cycles').select('*').eq('schedule_id', cycle.schedule_id).neq('status', 'archived').order('start_date', { ascending: true }),
      supabase.from('atlas_config').select('value').eq('key', 'estimate_settings').maybeSingle(),
      supabase.from('atlas_members').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ]);
    for (const result of [scheduleResult, actionsResult, eventsResult, activityResult, siblingsResult, estimateResult, principalsResult]) if (result.error) throw result.error;
    const siblings = (siblingsResult.data || []) as Row[];
    const index = siblings.findIndex(item => item.id === cycle.id);
    const actions = (actionsResult.data || []) as Row[];
    const unestimatedValue = Number.isSafeInteger(estimateResult.data?.value?.unestimated_value) ? Number(estimateResult.data?.value?.unestimated_value) : 1;
    const metrics = calculateCycleMetrics(actions, unestimatedValue);
    const history = siblings.filter(item => item.status === 'completed' && String(item.start_date) < String(cycle.start_date));
    const capacity = calculateCycleCapacity(history, principalsResult.count || 1, Number(scheduleResult.data.duration_weeks || 1), cycle.capacity_override);
    const snapshotActions = Array.isArray(cycle.action_snapshot) ? cycle.action_snapshot as Row[] : [];
    const snapshotIds = new Set(snapshotActions.map(item => String(item.id)));
    const liveIds = new Set(actions.map(item => String(item.id)));
    const divergence = {
      added_after_completion: actions.filter(item => !snapshotIds.has(String(item.id))).map(item => item.id),
      removed_after_completion: snapshotActions.filter(item => !liveIds.has(String(item.id))).map(item => item.id),
      snapshot_fixed: cycle.status === 'completed',
    };
    const graphPoints = (eventsResult.data || []) as Row[];
    if (graphPoints.length === 0) graphPoints.push({ created_at: new Date().toISOString(), ...metrics, event_type: 'current' });
    return c.json({
      ...cycle,
      schedule: scheduleResult.data,
      actions,
      metrics,
      capacity,
      capacity_load_percent: capacity.value === 0 ? 0 : Math.round((metrics.scope_effort / capacity.value) * 100),
      graph_points: graphPoints,
      activity: activityResult.data || [],
      previous_cycle: index > 0 ? siblings[index - 1] : null,
      next_cycle: index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null,
      divergence,
    });
  } catch (error) {
    console.error(`[cycles] detail error: ${(error as Error).message}`);
    return apiError(c, 500, 'CYCLE_LOAD_FAILED', 'Unable to load the cycle.');
  }
});

router.post('/:id/actions/:actionId/assign', async (c) => {
  const { data, error } = await getDb(c.env).rpc('assign_atlas_action_to_cycle', {
    p_cycle_id: c.req.param('id'), p_action_id: c.req.param('actionId'), p_actor: getActor(c),
  });
  if (error) return cycleRpcError(c, error, 'Unable to assign the action to the cycle.');
  return c.json(data);
});

router.post('/:id/actions/:actionId/remove', async (c) => {
  const { data, error } = await getDb(c.env).rpc('remove_atlas_action_from_cycle', {
    p_cycle_id: c.req.param('id'), p_action_id: c.req.param('actionId'), p_actor: getActor(c),
  });
  if (error) return cycleRpcError(c, error, 'Unable to remove the action from the cycle.');
  return c.json(data);
});

router.post('/:id/complete', async (c) => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  const { data, error } = await getDb(c.env).rpc('complete_atlas_cycle', {
    p_cycle_id: c.req.param('id'),
    p_actor: getActor(c),
    p_expected_revision: Number.isSafeInteger(body.expected_revision) ? body.expected_revision : null,
    p_start_next_now: body.start_next_now === true,
  });
  if (error) return cycleRpcError(c, error, 'Unable to complete and roll over the cycle.');
  return c.json(data);
});

router.post('/:id/start-today', async (c) => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  const { data, error } = await getDb(c.env).rpc('start_atlas_cycle_today', {
    p_cycle_id: c.req.param('id'), p_actor: getActor(c),
    p_expected_revision: Number.isSafeInteger(body.expected_revision) ? body.expected_revision : null,
  });
  if (error) return cycleRpcError(c, error, 'Unable to start the cycle today.');
  return c.json(data);
});

router.post('/schedules/:id/disable', async (c) => {
  const body = await c.req.json<Row>().catch(() => ({} as Row));
  const { data, error } = await getDb(c.env).rpc('disable_atlas_cycle_schedule', {
    p_schedule_id: c.req.param('id'),
    p_actor: getActor(c),
    p_expected_revision: Number.isSafeInteger(body.expected_revision) ? body.expected_revision : null,
  });
  if (error) return cycleRpcError(c, error, 'Unable to disable the cycle schedule.');
  return c.json(data);
});

export default router;
