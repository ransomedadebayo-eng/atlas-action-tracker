import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';

type Supabase = ReturnType<typeof getDb>;

type ActionRow = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  business?: string | null;
  priority?: string | null;
  due_date?: string | null;
  review_date?: string | null;
  owners?: unknown;
  notes?: string | null;
  work_mode?: string | null;
  next_action?: string | null;
  definition_of_done?: string | null;
  evidence_json?: Record<string, unknown> | null;
  approval_state?: string | null;
  agent_assignment_id?: string | null;
  blocked_by?: unknown;
  updated_at?: string | null;
};

type SignalInput = {
  job_name: string;
  signal_type: string;
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  body?: string;
  action_id?: string | null;
  target_table?: string | null;
  target_id?: string | null;
  recommendation_json?: Record<string, unknown>;
  evidence_json?: Record<string, unknown>;
};

export type AutomationResult = {
  job: string;
  status: 'completed' | 'completed_with_warnings' | 'blocked' | 'failed';
  summary: string;
  evidence: Record<string, unknown>;
};

const ACTIVE_STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked'];
const MAX_ASSIGNMENTS_PER_PULL = 5;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function hasEvidence(action: ActionRow) {
  return Object.keys(jsonObject(action.evidence_json)).length > 0;
}

function owners(action: ActionRow): string[] {
  return Array.isArray(action.owners) ? action.owners.filter((owner): owner is string => typeof owner === 'string') : [];
}

function isBlocked(action: ActionRow) {
  return Array.isArray(action.blocked_by) && action.blocked_by.length > 0;
}

function assignmentPriority(priority?: string | null) {
  if (priority === 'p0') return 'critical';
  if (priority === 'p1') return 'high';
  if (priority === 'p3') return 'low';
  return 'medium';
}

function assignmentTypeForWorkMode(workMode?: string | null) {
  return workMode === 'review_required' || workMode === 'user_only' ? 'review' : 'execution';
}

function classifyWorkMode(action: ActionRow): string {
  const text = `${action.title || ''} ${action.description || ''} ${action.notes || ''} ${action.business || ''}`.toLowerCase();
  if (/\b(pay|payment|wire|transfer|sign|signature|file taxes|tax filing|irs|legal filing|passport|ssn|password|credential|medical|doctor|government|portal)\b/.test(text)) {
    return 'user_only';
  }
  if (/\b(finance|tax|legal|loan|mortgage|insurance|bank|account|contract|external email|send email|calendar|schedule)\b/.test(text)) {
    return 'review_required';
  }
  if (/\b(code|deploy|github|bug|ui|dashboard|worker|api|test|build|codex|automation)\b/.test(text)) {
    return 'autonomous';
  }
  return 'review_required';
}

async function insertSignal(supabase: Supabase, signal: SignalInput) {
  const { error } = await supabase.from('agent_signals').insert({
    signal_type: signal.signal_type,
    severity: signal.severity || 'info',
    status: 'open',
    summary: signal.title,
    details_json: {
      job_name: signal.job_name,
      body: signal.body || null,
      action_id: signal.action_id || null,
      target_table: signal.target_table || null,
      target_id: signal.target_id || null,
      recommendation: signal.recommendation_json || {},
      evidence: signal.evidence_json || {},
    },
  });
  if (error) throw error;
}

async function startRun(supabase: Supabase, jobName: string) {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      provider: 'atlas-automation',
      run_type: jobName,
      task_type: 'automation',
      status: 'running',
      started_at: new Date().toISOString(),
      approval_mode: 'autonomous',
      review_decision: 'not_required',
      risk_level: 'low',
      communication_medium: 'atlas',
      context_snapshot_json: {},
      source_loads_json: { source: 'atlas-worker-scheduled-job' },
      tools_used_json: { tools: ['cloudflare_worker', 'supabase_service_role'] },
      evidence_json: {},
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function finishRun(supabase: Supabase, runId: string, result: AutomationResult, errorText?: string) {
  await supabase
    .from('agent_runs')
    .update({
      status: result.status === 'failed' ? 'failed' : 'completed',
      completion_state: result.status,
      result_summary: result.summary,
      evidence_json: result.evidence,
      error_message: errorText || null,
      completed_at: result.status === 'failed' ? null : new Date().toISOString(),
      failed_at: result.status === 'failed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

async function loadActiveActions(supabase: Supabase): Promise<ActionRow[]> {
  const { data, error } = await supabase
    .from('atlas_actions')
    .select('*')
    .in('status', ACTIVE_STATUSES)
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as ActionRow[];
}

async function createAgentAssignment(supabase: Supabase, action: ActionRow) {
  const now = new Date().toISOString();
  const definition = action.definition_of_done || `Complete and verify: ${action.title}`;
  const assignmentId = uuidv4();
  const { data, error } = await supabase
    .from('agent_assignments')
    .insert({
      id: assignmentId,
      title: `Atlas: ${action.title}`,
      description: action.description || action.notes || null,
      assignment_type: assignmentTypeForWorkMode(action.work_mode),
      task_type: 'execution',
      goal: action.next_action || action.title,
      success_criteria_json: [definition],
      constraints_json: [],
      due_at: action.due_date ? `${action.due_date}T23:59:00.000Z` : null,
      priority: assignmentPriority(action.priority),
      owner_review_required: action.work_mode !== 'autonomous',
      status: action.work_mode === 'autonomous' ? 'queued' : 'awaiting_review',
      created_by: 'atlas-automation',
      work_mode: action.work_mode || 'review_required',
      definition_of_done: definition,
      evidence_required_json: { required: true, sources: ['atlas_action', 'agent_run'] },
      review_medium: action.work_mode === 'autonomous' ? 'chat' : 'peos_review_queue',
      source_action_id: action.id,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) throw error;

  await supabase.from('atlas_actions').update({
    agent_assignment_id: data.id,
    approval_state: action.work_mode === 'autonomous' ? 'not_required' : 'needs_review',
    updated_at: now,
  }).eq('id', action.id);

  await supabase.from('atlas_activity_log').insert({
    action_id: action.id,
    event: 'agent_assignment_created',
    new_value: data.id,
    actor: 'atlas-automation',
  });

  return data;
}

async function runWithLog(env: Env, jobName: string, fn: (supabase: Supabase) => Promise<AutomationResult>) {
  const supabase = getDb(env);
  const runId = await startRun(supabase, jobName);
  try {
    const result = await fn(supabase);
    await finishRun(supabase, runId, result);
    return { ...result, run_id: runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: AutomationResult = {
      job: jobName,
      status: 'failed',
      summary: `${jobName} failed: ${message}`,
      evidence: { error: message },
    };
    await finishRun(supabase, runId, result, message);
    throw error;
  }
}

export async function atlasStewardshipDaily(env: Env) {
  return runWithLog(env, 'atlas-stewardship-daily', async (supabase) => {
    const today = todayIso();
    const reviewFallback = addDaysIso(7);
    const actions = await loadActiveActions(supabase);
    const stale = actions.filter(action => {
      const overdue = !!action.due_date && action.due_date < today;
      return overdue || !action.work_mode || !hasText(action.next_action) || !hasText(action.definition_of_done) || (!action.due_date && !action.review_date);
    });

    if (stale.length > 0) {
      await insertSignal(supabase, {
        job_name: 'atlas-stewardship-daily',
        signal_type: 'stewardship_review_packet',
        severity: stale.some(a => a.priority === 'p0' || (!!a.due_date && a.due_date < today)) ? 'high' : 'medium',
        title: `Atlas stewardship review: ${stale.length} active actions need protocol cleanup`,
        body: 'Review the proposed patches before bulk-changing work modes, dates, owners, priorities, or status.',
        recommendation_json: {
          max_decisions: 3,
          proposed_patches: stale.slice(0, 30).map(action => ({
            action_id: action.id,
            title: action.title,
            patch: {
              work_mode: action.work_mode || classifyWorkMode(action),
              next_action: action.next_action || `Clarify and move forward: ${action.title}`,
              definition_of_done: action.definition_of_done || `Outcome verified and evidence attached for: ${action.title}`,
              review_date: action.due_date ? action.review_date || null : action.review_date || reviewFallback,
            },
            reasons: {
              missing_work_mode: !action.work_mode,
              missing_next_action: !hasText(action.next_action),
              missing_definition_of_done: !hasText(action.definition_of_done),
              missing_date: !action.due_date && !action.review_date,
              overdue: !!action.due_date && action.due_date < today,
            },
          })),
        },
        evidence_json: {
          scanned: actions.length,
          stale: stale.length,
          generated_at: new Date().toISOString(),
        },
      });
    }

    return {
      job: 'atlas-stewardship-daily',
      status: 'completed',
      summary: `Scanned ${actions.length} active actions; ${stale.length} need protocol stewardship.`,
      evidence: { scanned: actions.length, stale: stale.length, today },
    };
  });
}

export async function agentWorkPull(env: Env) {
  return runWithLog(env, 'agent-work-pull', async (supabase) => {
    const actions = await loadActiveActions(supabase);
    const candidates = actions
      .filter(action => action.work_mode === 'autonomous')
      .filter(action => owners(action).includes('codex'))
      .filter(action => !action.agent_assignment_id)
      .filter(action => !isBlocked(action))
      .filter(action => hasText(action.next_action) && hasText(action.definition_of_done))
      .slice(0, MAX_ASSIGNMENTS_PER_PULL);

    const assignments = [];
    for (const action of candidates) {
      assignments.push(await createAgentAssignment(supabase, action));
    }

    if (assignments.length === 0) {
      await insertSignal(supabase, {
        job_name: 'agent-work-pull',
        signal_type: 'agent_pull_idle',
        severity: 'info',
        title: 'Agent pull queue checked; no ready autonomous Codex actions',
        evidence_json: {
          active_scanned: actions.length,
          autonomous_codex_without_assignment: actions.filter(a => a.work_mode === 'autonomous' && owners(a).includes('codex') && !a.agent_assignment_id).length,
        },
      });
    }

    return {
      job: 'agent-work-pull',
      status: 'completed',
      summary: `Created ${assignments.length} Codex assignment(s) from ready autonomous Atlas actions.`,
      evidence: {
        scanned: actions.length,
        assignments_created: assignments.length,
        assignment_ids: assignments.map(a => a.id),
      },
    };
  });
}

export async function reviewPacketDigest(env: Env) {
  return runWithLog(env, 'review-packet-digest', async (supabase) => {
    const { data, error } = await supabase
      .from('agent_signals')
      .select('*')
      .eq('status', 'open')
      .in('severity', ['critical', 'high', 'medium'])
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) throw error;

    if ((data || []).length > 0) {
      await insertSignal(supabase, {
        job_name: 'review-packet-digest',
        signal_type: 'decision_digest',
        severity: 'medium',
        title: `PEOS review digest: ${(data || []).length} recommended decision(s)`,
        body: 'Use these as the top review queue items. Telegram escalation is intentionally not sent unless a separate urgent unblock exists.',
        recommendation_json: {
          decisions: (data || []).map((signal: Record<string, unknown>) => ({
            signal_id: signal.id,
            title: signal.summary,
            severity: signal.severity,
            recommendation: jsonObject(jsonObject(signal.details_json).recommendation),
            if_ignored: 'Work may remain blocked, unclassified, or missing evidence.',
          })),
        },
        evidence_json: { source_signal_count: (data || []).length },
      });
    }

    return {
      job: 'review-packet-digest',
      status: 'completed',
      summary: `Prepared digest from ${(data || []).length} open medium-or-higher signal(s).`,
      evidence: { decisions: (data || []).length, max_decisions: 3 },
    };
  });
}

export async function journalReviewWeekly(env: Env) {
  return runWithLog(env, 'journal-review-weekly', async (supabase) => {
    const { data, error } = await supabase
      .from('peos_journal_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      await insertSignal(supabase, {
        job_name: 'journal-review-weekly',
        signal_type: 'journal_review_blocked',
        severity: 'medium',
        title: 'Journal weekly review could not read PEOS journal entries',
        body: 'Verify the final journal table contract before enabling promotion suggestions.',
        evidence_json: { error: error.message },
      });
      return {
        job: 'journal-review-weekly',
        status: 'blocked',
        summary: 'Journal review blocked by missing or incompatible journal table contract.',
        evidence: { error: error.message },
      };
    }

    const entries = (data || []) as Array<Record<string, unknown>>;
    const unreviewed = entries.filter(entry => {
      const status = String(entry.status || entry.review_status || '').toLowerCase();
      const archived = entry.archived === true || status === 'archived';
      const promoted = Array.isArray(entry.promoted_targets) && entry.promoted_targets.length > 0;
      return !archived && !promoted && status !== 'reviewed';
    });

    if (unreviewed.length > 0) {
      await insertSignal(supabase, {
        job_name: 'journal-review-weekly',
        signal_type: 'journal_review_packet',
        severity: 'low',
        title: `Journal review: ${unreviewed.length} unreviewed private capture(s)`,
        body: 'Raw journal entries are not promoted automatically. Review and explicitly promote only what should become a task, fact, decision, correction, feedback, or protocol proposal.',
        recommendation_json: {
          entries: unreviewed.slice(0, 20).map(entry => ({
            entry_id: entry.id,
            created_at: entry.created_at,
            suggested_targets: ['atlas_action', 'aegis_fact', 'aegis_correction', 'agent_feedback', 'protocol_rule_proposal'],
          })),
        },
        evidence_json: { scanned: entries.length, unreviewed: unreviewed.length },
      });
    }

    return {
      job: 'journal-review-weekly',
      status: 'completed',
      summary: `Scanned ${entries.length} journal entries; ${unreviewed.length} need review.`,
      evidence: { scanned: entries.length, unreviewed: unreviewed.length },
    };
  });
}

export async function protocolLearningWeekly(env: Env) {
  return runWithLog(env, 'protocol-learning-weekly', async (supabase) => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [runsResult, signalsResult] = await Promise.all([
      supabase.from('agent_runs').select('*').eq('provider', 'atlas-automation').gte('created_at', since).order('created_at', { ascending: false }).limit(100),
      supabase.from('agent_signals').select('*').eq('status', 'open').gte('created_at', since).order('created_at', { ascending: false }).limit(100),
    ]);
    if (runsResult.error) throw runsResult.error;
    if (signalsResult.error) throw signalsResult.error;

    const runs = runsResult.data || [];
    const signals = signalsResult.data || [];
    const failures = runs.filter((run: Record<string, unknown>) => run.status === 'failed' || run.status === 'blocked');
    const signalCounts = signals.reduce((acc: Record<string, number>, signal: Record<string, unknown>) => {
      const key = String(signal.signal_type || 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const repeatedPatterns = Object.entries(signalCounts).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= 3);
    if (failures.length > 0 || repeatedPatterns.length > 0) {
      await insertSignal(supabase, {
        job_name: 'protocol-learning-weekly',
        signal_type: 'protocol_learning_proposal',
        severity: repeatedPatterns.length > 0 ? 'medium' : 'low',
        title: 'Weekly protocol learning proposal',
        body: 'Review before changing task playbooks or AGENTS.md. Stable rules should be promoted only after approval.',
        recommendation_json: {
          proposed_changes: repeatedPatterns.map(([signal_type, count]) => ({
            target: signal_type === 'stewardship_review_packet' ? 'task_playbooks' : 'AGENTS.md proposal',
            rationale: `${signal_type} appeared ${count} times this week.`,
          })),
          failed_or_blocked_runs: failures.map((run: Record<string, unknown>) => ({
            run_id: run.id,
            job_name: run.run_type,
            summary: run.result_summary,
          })),
        },
        evidence_json: { runs_scanned: runs.length, open_signals_scanned: signals.length, repeated_patterns: repeatedPatterns },
      });
    }

    return {
      job: 'protocol-learning-weekly',
      status: 'completed',
      summary: `Scanned ${runs.length} runs and ${signals.length} open signals; ${repeatedPatterns.length} repeated pattern(s).`,
      evidence: { runs_scanned: runs.length, open_signals_scanned: signals.length, failures: failures.length, repeated_patterns: repeatedPatterns },
    };
  });
}

export async function evidenceIntegrityCheck(env: Env) {
  return runWithLog(env, 'evidence-integrity-check', async (supabase) => {
    const { data: actions, error: actionsError } = await supabase
      .from('atlas_actions')
      .select('*')
      .eq('status', 'done')
      .limit(500);
    if (actionsError) throw actionsError;

    const doneWithoutEvidence = ((actions || []) as ActionRow[]).filter(action => !hasEvidence(action));
    let agentRunsMissingEvidence: Array<Record<string, unknown>> = [];
    const runsResult = await supabase
      .from('agent_runs')
      .select('id,assignment_id,completion_state,evidence_json,created_at')
      .in('completion_state', ['implemented', 'verified', 'done', 'applied'])
      .limit(500);
    if (!runsResult.error) {
      agentRunsMissingEvidence = (runsResult.data || []).filter((run: Record<string, unknown>) => Object.keys(jsonObject(run.evidence_json)).length === 0);
    }

    if (doneWithoutEvidence.length > 0 || agentRunsMissingEvidence.length > 0 || runsResult.error) {
      await insertSignal(supabase, {
        job_name: 'evidence-integrity-check',
        signal_type: 'evidence_integrity_gap',
        severity: doneWithoutEvidence.length > 0 || agentRunsMissingEvidence.length > 0 ? 'high' : 'medium',
        title: 'Evidence integrity check found gaps',
        body: 'These are quality signals, not new tasks. Add proof, reopen, or dismiss after review.',
        recommendation_json: {
          done_actions_without_evidence: doneWithoutEvidence.slice(0, 30).map(action => ({ action_id: action.id, title: action.title })),
          agent_runs_without_evidence: agentRunsMissingEvidence.slice(0, 30).map(run => ({ run_id: run.id, assignment_id: run.assignment_id })),
          agent_runs_query_error: runsResult.error?.message,
        },
        evidence_json: {
          done_actions_scanned: (actions || []).length,
          done_actions_without_evidence: doneWithoutEvidence.length,
          agent_runs_without_evidence: agentRunsMissingEvidence.length,
          agent_runs_query_error: runsResult.error?.message,
        },
      });
    }

    return {
      job: 'evidence-integrity-check',
      status: runsResult.error ? 'completed_with_warnings' : 'completed',
      summary: `Checked done actions and applied agent runs; ${doneWithoutEvidence.length + agentRunsMissingEvidence.length} evidence gap(s).`,
      evidence: {
        done_actions_scanned: (actions || []).length,
        done_actions_without_evidence: doneWithoutEvidence.length,
        agent_runs_without_evidence: agentRunsMissingEvidence.length,
        agent_runs_query_error: runsResult.error?.message,
      },
    };
  });
}

export const AUTOMATION_JOBS = {
  'atlas-stewardship-daily': atlasStewardshipDaily,
  'agent-work-pull': agentWorkPull,
  'review-packet-digest': reviewPacketDigest,
  'journal-review-weekly': journalReviewWeekly,
  'protocol-learning-weekly': protocolLearningWeekly,
  'evidence-integrity-check': evidenceIntegrityCheck,
} as const;

export type AutomationJobName = keyof typeof AUTOMATION_JOBS;

export async function runAutomationJob(env: Env, jobName: AutomationJobName) {
  return AUTOMATION_JOBS[jobName](env);
}

export async function runScheduledProtocolJobs(env: Env, cron: string) {
  const jobs: AutomationJobName[] = [];
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  if (cron === '0 * * * *') {
    jobs.push('agent-work-pull');
    if (utcHour === 15) jobs.push('atlas-stewardship-daily', 'review-packet-digest', 'evidence-integrity-check');
    if (utcDay === 0 && utcHour === 18) jobs.push('journal-review-weekly', 'protocol-learning-weekly');
  }
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await runAutomationJob(env, job));
    } catch (error) {
      console.error(`[automations] ${job} failed`, error);
    }
  }
  return results;
}
