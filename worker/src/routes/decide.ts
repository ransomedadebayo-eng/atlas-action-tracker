import { Hono } from 'hono';
import { Env, getDb } from '../db';

const router = new Hono<{ Bindings: Env }>();
const DECISION_TO_STATUS: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  defer: 'deferred',
  close: 'applied',
};

async function safeSelect<T>(label: string, request: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const result = await request;
  if (result.error) return { label, data: [], error: result.error.message };
  return { label, data: result.data || [], error: null };
}

router.get('/', async (c) => {
  const supabase = getDb(c.env);

  const [proposals, reports, runs, signals, reviews] = await Promise.all([
    safeSelect('proposals', supabase
      .from('ai_proposals')
      .select('*')
      .in('status', ['pending', 'approved'])
      .order('proposed_at', { ascending: false })
      .limit(50)),
    safeSelect('automation_reports', supabase
      .from('automation_run_reports')
      .select('id, automation_id, status, title, summary, implemented, verified, remaining_work, artifacts_json, created_at, run_completed_at')
      .order('created_at', { ascending: false })
      .limit(100)),
    safeSelect('agent_runs', supabase
      .from('agent_runs')
      .select('id, status, task_type, result_summary, risk_level, error_message, created_at')
      .in('status', ['proposal_ready', 'review_required', 'blocked', 'failed'])
      .order('created_at', { ascending: false })
      .limit(25)),
    safeSelect('agent_signals', supabase
      .from('agent_signals')
      .select('id, signal_type, severity, summary, created_at, resolved_at')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(40)),
    safeSelect('review_runs', supabase
      .from('review_runs')
      .select('id, review_type, summary, status, created_at')
      .eq('status', 'ready_for_review')
      .order('created_at', { ascending: false })
      .limit(10)),
  ]);

  return c.json({
    proposals: proposals.data,
    reports: reports.data,
    runs: runs.data,
    signals: signals.data,
    reviews: reviews.data,
    source_errors: [proposals, reports, runs, signals, reviews]
      .filter((item) => item.error)
      .map((item) => ({ source: item.label, error: item.error })),
  });
});

router.post('/proposals/:id/decision', async (c) => {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json<Record<string, unknown>>();
    const decision = String(body.decision || '');
    const nextStatus = DECISION_TO_STATUS[decision];
    if (!nextStatus) return c.json({ error: 'Unknown decision.' }, 400);

    const { data: existing, error: fetchError } = await supabase
      .from('ai_proposals')
      .select('id, status, entity_type')
      .eq('id', c.req.param('id'))
      .single();
    if (fetchError || !existing) return c.json({ error: 'Proposal not found.' }, 404);

    const currentStatus = String(existing.status);
    const allowed =
      (currentStatus === 'pending' && ['approve', 'reject', 'defer'].includes(decision)) ||
      (currentStatus === 'approved' && ['close', 'reject', 'defer'].includes(decision));
    if (!allowed) {
      return c.json({ error: decision === 'close' ? 'Accept before closing as done.' : `Proposal already ${currentStatus}.` }, 400);
    }

    const { data, error } = await supabase
      .from('ai_proposals')
      .update({ status: nextStatus, applied_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('status', currentStatus)
      .select('*')
      .single();
    if (error) throw error;
    return c.json(data);
  } catch (err) {
    console.error(`[decide] decision error: ${(err as Error).message}`);
    return c.json({ error: 'Could not record decision.' }, 500);
  }
});

export default router;
