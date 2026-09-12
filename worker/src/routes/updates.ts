import { Hono } from 'hono';
import { Env, getDb } from '../db';
import { apiError } from '../utils/http';
import { OFFICE_DIGEST_BUCKETS } from '../utils/actionFilters';

const router = new Hono<{ Bindings: Env }>();

const DIGEST_SELECT = [
  'digest_bucket',
  'id',
  'identifier',
  'title',
  'status',
  'approval_state',
  'business',
  'project_id',
  'owners',
  'agent_assignment_id',
  'blocked_by',
  'next_action',
  'priority',
  'due_date',
  'work_mode',
  'completed_at',
  'updated_at',
  'created_at',
].join(',');

async function loadAllRows(query: any): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const batchSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await query.range(offset, offset + batchSize - 1);
    if (error) throw error;
    const batch = (data || []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < batchSize) return rows;
    offset += batchSize;
  }
}

router.get('/office-digest', async (c) => {
  try {
    const supabase = getDb(c.env);
    const query = supabase
      .from('atlas_office_digest_v1')
      .select(DIGEST_SELECT)
      .order('business', { ascending: true })
      .order('updated_at', { ascending: false });
    const items = await loadAllRows(query);
    const asOf = new Date().toISOString();
    const counts = Object.fromEntries(OFFICE_DIGEST_BUCKETS.map(bucket => [bucket, 0]));
    for (const item of items) {
      const bucket = String(item.digest_bucket || '');
      if (bucket in counts) counts[bucket] += 1;
    }
    return c.json({
      source: 'atlas_office_digest_v1',
      as_of: asOf,
      counts,
      items,
    });
  } catch (error) {
    console.error(`[updates] office-digest error: ${(error as Error).message}`);
    return apiError(c, 500, 'OFFICE_DIGEST_FAILED', 'Unable to load the office digest.');
  }
});

export default router;
