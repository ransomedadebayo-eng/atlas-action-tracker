import { Hono } from 'hono';
import { Env, getDb } from '../db';

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

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const planDate = planDateFromQuery(c.req.query('date'));
    const { data, error } = await supabase.rpc('get_atlas_today_plan', { p_plan_date: planDate });
    if (error) throw error;
    return c.json({ ...data, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error(`[today] GET error: ${(err as Error).message}`);
    return c.json({ error: 'Could not load Atlas Today plan' }, 500);
  }
});

export default router;
