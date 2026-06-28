import { Hono } from 'hono';
import { Env } from '../db';
import { atlasTodayIsoDate, readAtlasTodayPlan } from '../automations/atlasToday';

const router = new Hono<{ Bindings: Env }>();

router.get('/', async (c) => {
  try {
    const date = c.req.query('date') || atlasTodayIsoDate();
    const plan = await readAtlasTodayPlan(c.env, date);
    return c.json(plan);
  } catch (error) {
    console.error(`[today] read error: ${(error as Error).message}`);
    return c.json({ error: 'Unable to load Atlas Today plan.' }, 500);
  }
});

export default router;
