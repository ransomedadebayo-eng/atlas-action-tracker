import { Hono } from 'hono';
import { Env } from '../db';
import { getDb } from '../db';

const router = new Hono<{ Bindings: Env }>();
const PAGE_SIZE = 1000;

router.get('/', (c) => c.json({
  runtime: 'guarded_codex_protocols',
  execution_enabled: false,
  registry_url: '/api/automations/registry',
}));

router.get('/registry', async (c) => {
  try {
    const supabase = getDb(c.env);
    const latestById = new Map<string, Record<string, unknown>>();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('automation_run_reports')
        .select('automation_id,status,title,summary,created_at,run_completed_at,artifacts_json')
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;

      for (const row of data || []) {
        const id = String(row.automation_id || '');
        if (id && !latestById.has(id)) latestById.set(id, row);
      }
      if (!data || data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
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

    const jobs = Array.from(latestById.entries()).map(([id, report]) => {
      const artifacts = report.artifacts_json && typeof report.artifacts_json === 'object' && !Array.isArray(report.artifacts_json)
        ? report.artifacts_json as Record<string, unknown>
        : {};
      return {
        id,
        status: report.status || 'unknown',
        schedule: artifacts.schedule || null,
        writes_to: surfaces[id] || ['Reports'],
        route_used: artifacts.route_used || artifacts.route || 'guarded_codex_protocol',
        latest_report: report,
      };
    });

    return c.json({ runtime: 'guarded_codex_protocols', execution_enabled: false, jobs });
  } catch (error) {
    console.error(`[automations] registry error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load automation registry.' }, 500);
  }
});

export default router;
