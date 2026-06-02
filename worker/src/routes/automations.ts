import { Hono } from 'hono';
import { Env } from '../db';
import { AUTOMATION_JOBS, AutomationJobName, runAutomationJob } from '../automations/protocolJobs';

const router = new Hono<{ Bindings: Env }>();

router.get('/', (c) => c.json({
  jobs: Object.keys(AUTOMATION_JOBS),
  schedules: {
    '0 * * * *': [
      'agent-work-pull hourly',
      'atlas-stewardship-daily/review-packet-digest/evidence-integrity-check at 15:00 UTC',
      'journal-review-weekly/protocol-learning-weekly Sunday at 18:00 UTC',
    ],
  },
}));

router.post('/:job/run', async (c) => {
  const authKind = (c as unknown as { get: (key: string) => unknown }).get('atlasAuthKind');
  if (authKind !== 'api_token') {
    return c.json({ error: 'Automation manual runs require API-token authentication.' }, 403);
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
