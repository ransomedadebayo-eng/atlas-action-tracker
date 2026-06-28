import { Hono } from 'hono';
import { Env, getDb } from '../db';

const router = new Hono<{ Bindings: Env }>();

router.get('/review', async (c) => {
  try {
    const supabase = getDb(c.env);
    const [actionsResult, reportsResult, signalsResult] = await Promise.all([
      supabase
        .from('atlas_actions')
        .select('id,title,description,status,business,priority,due_date,review_date,owners,work_mode,approval_state,next_action,updated_at')
        .in('status', ['not_started', 'in_progress', 'waiting', 'blocked'])
        .in('work_mode', ['review_required', 'user_only'])
        .order('priority', { ascending: true })
        .order('review_date', { ascending: true, nullsFirst: false })
        .limit(40),
      supabase
        .from('automation_run_reports')
        .select('id,automation_id,status,title,summary,implemented,verified,remaining_work,review_items_json,created_at')
        .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
        .order('created_at', { ascending: false })
        .limit(25),
      supabase
        .from('agent_signals')
        .select('id,signal_type,severity,summary,details_json,status,created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(25),
    ]);
    if (actionsResult.error) throw actionsResult.error;
    if (reportsResult.error) throw reportsResult.error;
    if (signalsResult.error) throw signalsResult.error;
    return c.json({
      actions: actionsResult.data || [],
      reports: reportsResult.data || [],
      signals: signalsResult.data || [],
    });
  } catch (error) {
    console.error(`[atlas-os/review] error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load Atlas Review.' }, 500);
  }
});

router.get('/decide', async (c) => {
  try {
    const supabase = getDb(c.env);
    const [ruleProposalsResult, signalsResult] = await Promise.all([
      supabase
        .from('atlas_today_rule_proposals')
        .select('*')
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('agent_signals')
        .select('id,signal_type,severity,summary,details_json,status,created_at')
        .eq('status', 'open')
        .in('signal_type', ['decision_digest', 'protocol_learning_proposal', 'stewardship_review_packet'])
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    if (ruleProposalsResult.error) throw ruleProposalsResult.error;
    if (signalsResult.error) throw signalsResult.error;
    return c.json({
      ruleProposals: ruleProposalsResult.data || [],
      signals: signalsResult.data || [],
    });
  } catch (error) {
    console.error(`[atlas-os/decide] error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load Atlas Decide.' }, 500);
  }
});

router.get('/journal', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('peos_journal_entries')
      .select('id,title,body,source,review_state,promoted_targets,created_at,captured_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return c.json({ entries: data || [] });
  } catch (error) {
    console.error(`[atlas-os/journal] error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load Atlas Journal.' }, 500);
  }
});

router.post('/journal', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ error: 'Journal entry content is required.' }, 400);
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('peos_journal_entries')
      .insert({
        title: title || content.slice(0, 80),
        body: content,
        kind: 'thought',
        source: 'atlas_user_journal',
        review_state: 'unreviewed',
        metadata: { created_from: 'atlas_journal' },
      })
      .select('*')
      .single();
    if (error) throw error;
    return c.json(data, 201);
  } catch (error) {
    console.error(`[atlas-os/journal] create error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to save journal entry.' }, 500);
  }
});

export default router;
