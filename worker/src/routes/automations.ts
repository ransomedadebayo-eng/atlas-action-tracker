import { Hono } from 'hono';
import { Env } from '../db';
import { getDb } from '../db';
import { AUTOMATION_JOBS, AutomationJobName, runAutomationJob } from '../automations/protocolJobs';

const router = new Hono<{ Bindings: Env }>();

router.get('/', (c) => c.json({
  jobs: Object.keys(AUTOMATION_JOBS),
  schedules: {
    '0 * * * *': [
      'agent-work-pull hourly',
      'atlas-nightly-retriage at 08:00 UTC',
      'atlas-stewardship-daily/review-packet-digest/evidence-integrity-check at 15:00 UTC',
      'journal-review-weekly/protocol-learning-weekly Sunday at 18:00 UTC',
    ],
  },
}));

router.get('/registry', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data, error } = await supabase
      .from('automation_run_reports')
      .select('automation_id,status,title,summary,created_at,run_completed_at,artifacts_json')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const latestById = new Map<string, Record<string, unknown>>();
    for (const row of data || []) {
      const id = String(row.automation_id || '');
      if (id && !latestById.has(id)) latestById.set(id, row);
    }

    const surfaces: Record<string, string[]> = {
      'atlas-nightly-retriage': ['Today', 'Review'],
      'atlas-stewardship-daily': ['Review', 'Decide'],
      'review-packet-digest': ['Decide'],
      'journal-review-weekly': ['Journal', 'Review'],
      'protocol-learning-weekly': ['Decide'],
      'agent-work-pull': ['Review'],
      'evidence-integrity-check': ['Review'],
    };

    const jobs = Object.keys(AUTOMATION_JOBS).map(job => ({
      id: job,
      status: 'active',
      schedule: job === 'agent-work-pull'
        ? 'hourly'
        : job === 'atlas-nightly-retriage'
          ? 'daily 08:00 UTC'
          : job === 'journal-review-weekly' || job === 'protocol-learning-weekly'
            ? 'Sunday 18:00 UTC'
            : 'daily 15:00 UTC',
      writes_to: surfaces[job] || ['Reports'],
      route_used: 'atlas-worker',
      latest_report: latestById.get(job) || null,
    }));

    return c.json({ jobs });
  } catch (error) {
    console.error(`[automations] registry error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load automation registry.' }, 500);
  }
});

router.post('/:job/run', async (c) => {
  const authKind = (c as unknown as { get: (key: string) => unknown }).get('atlasAuthKind');
  if (authKind !== 'api_token' && authKind !== 'cloudflare_access') {
    return c.json({ error: 'Automation manual runs require authenticated Atlas access.' }, 403);
  }

  const job = c.req.param('job') as AutomationJobName;
  if (!Object.prototype.hasOwnProperty.call(AUTOMATION_JOBS, job)) {
    return c.json({ error: 'Unknown automation job' }, 404);
  }

  try {
    const result = await runAutomationJob(c.env, job);
    return c.json(result);
  } catch (error) {
    console.error(`[automations] ${job} run error: ${(error as Error).message}`);
    return c.json({ error: 'Automation failed', detail: (error as Error).message }, 500);
  }
});

export default router;
