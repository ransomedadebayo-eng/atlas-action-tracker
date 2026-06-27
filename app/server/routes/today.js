import { Router } from 'express'
import supabase from '../db.js'

const router = Router()

function todayLocalDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function planDateFromValue(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayLocalDate()
}

router.get('/', async (req, res) => {
  try {
    const planDate = planDateFromValue(req.query.date)
    const { data, error } = await supabase.rpc('get_atlas_today_plan', { p_plan_date: planDate })
    if (error) throw error
    return res.json({ ...data, generated_at: new Date().toISOString() })
  } catch (err) {
    console.error(`[today] GET error: ${err.message}`)
    return res.status(500).json({ error: 'Could not load Atlas Today plan' })
  }
})

export default router
