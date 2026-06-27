import { Router } from 'express';
import supabase from '../db.js';

const router = Router();
const DECISION_TO_STATUS = {
  approve: 'approved',
  reject: 'rejected',
  defer: 'deferred',
  close: 'applied',
};

async function safeSelect(label, request) {
  const result = await request;
  if (result.error) return { label, data: [], error: result.error.message };
  return { label, data: result.data || [], error: null };
}

router.get('/', async (req, res) => {
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

  res.json({
    proposals: proposals.data,
    reports: reports.data,
    runs: runs.data,
    signals: signals.data,
    reviews: reviews.data,
    source_errors: [proposals, reports, runs, signals, reviews]
      .filter(item => item.error)
      .map(item => ({ source: item.label, error: item.error })),
  });
});

router.post('/proposals/:id/decision', async (req, res) => {
  try {
    const decision = String(req.body.decision || '');
    const nextStatus = DECISION_TO_STATUS[decision];
    if (!nextStatus) return res.status(400).json({ error: 'Unknown decision.' });

    const { data: existing, error: fetchError } = await supabase
      .from('ai_proposals')
      .select('id, status, entity_type')
      .eq('id', req.params.id)
      .single();
    if (fetchError || !existing) return res.status(404).json({ error: 'Proposal not found.' });

    const currentStatus = String(existing.status);
    const allowed =
      (currentStatus === 'pending' && ['approve', 'reject', 'defer'].includes(decision)) ||
      (currentStatus === 'approved' && ['close', 'reject', 'defer'].includes(decision));
    if (!allowed) {
      return res.status(400).json({ error: decision === 'close' ? 'Accept before closing as done.' : `Proposal already ${currentStatus}.` });
    }

    const { data, error } = await supabase
      .from('ai_proposals')
      .update({ status: nextStatus, applied_at: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('status', currentStatus)
      .select('*')
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error(`[decide] decision error: ${err.message}`);
    res.status(500).json({ error: 'Could not record decision.' });
  }
});

export default router;
