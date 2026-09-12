// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MediaDietPage from './MediaDietPage.jsx'
import * as mediaHooks from '../hooks/useMediaPlan.js'

vi.mock('../hooks/useMediaPlan.js', () => ({
  useMediaPlan: vi.fn(),
  useUpdateMediaStatus: vi.fn(),
  useStartTwitterAllowance: vi.fn(),
  useRecordMediaFeedback: vi.fn(),
}))

const todayItem = {
  id: 'today', title: 'One useful briefing', creator: 'Morning Brew Daily', platform: 'youtube',
  category: 'brief_news', item_type: 'consumable', source_url: 'https://www.youtube.com/watch?v=one',
  duration_minutes: 18, planned_date: '2026-09-02', trigger_kind: 'daytime_transition_1',
  purpose: 'Know what changed without opening a feed.', input_job: 'orient',
  selection_reason: 'Current, relevant, and not already watched.', stop_rule: 'Stop after the second segment.',
  rank: 0, status: 'queued', revision: 1, eligible_from: '2026-09-02T18:30:00Z',
}
const thursdayItem = { ...todayItem, id: 'thursday', title: 'Open the Portal', creator: 'Think Fast Talk Smart', platform: 'spotify', source_url: 'https://open.spotify.com/episode/example', planned_date: '2026-09-03', input_job: 'advance', rank: 1 }
const saturdayItem = { ...todayItem, id: 'saturday', title: 'Lagos Groove Chill', creator: 'Spotify', platform: 'spotify', source_url: 'https://open.spotify.com/playlist/example', planned_date: '2026-09-05', trigger_kind: 'saturday_walk', input_job: 'restore', rank: 2 }
const sundayItem = { ...todayItem, id: 'sunday', title: 'How a Crushed Faith Comes Home', creator: 'Ask Pastor John', platform: 'spotify', source_url: 'https://open.spotify.com/episode/faith', planned_date: '2026-09-06', trigger_kind: 'sunday_faith', input_job: 'restore', rank: 3 }
const resetItem = { id: 'reset', title: 'Familiar screen-off music', creator: 'Your library', platform: 'apple_music', category: 'reset', item_type: 'reset', source_url: null, duration_minutes: 15, planned_date: null, trigger_kind: 'after_work_reset', purpose: 'Use familiar audio without browsing.', input_job: 'reset', selection_reason: 'Lowers stimulation.', stop_rule: 'Keep the screen off.', rank: 4, status: 'queued', revision: 1 }

function day(date, kind, title, reason, item = null, is_today = false) { return { date, kind, title, reason, item, is_today } }
function payload(overrides = {}) {
  const daily_map = [
    day('2026-08-31', 'open', 'No media was planned', 'Use the time for projects, family, or rest.'),
    day('2026-09-01', 'open', 'No media was planned', 'Use the time for projects, family, or rest.'),
    day('2026-09-02', 'item', todayItem.title, todayItem.purpose, todayItem, true),
    day('2026-09-03', 'item', thursdayItem.title, thursdayItem.purpose, thursdayItem),
    day('2026-09-04', 'open', 'Open day', 'Use the time for projects, family, or rest.'),
    day('2026-09-05', 'item', saturdayItem.title, saturdayItem.purpose, saturdayItem),
    day('2026-09-06', 'item', sundayItem.title, sundayItem.purpose, sundayItem),
  ]
  return {
    week_start: '2026-08-31', today: '2026-09-02',
    plan: { id: 'plan', week_start: '2026-08-31', source_status: 'partial', intent_summary: 'A useful mix of current affairs, growth, music, and faith.', input_jobs: ['orient', 'advance', 'restore'], weekly_budget: 5 },
    items: [todayItem, thursdayItem, saturdayItem, sundayItem, resetItem], daily_map,
    today_guidance: daily_map[2], reset_item: resetItem,
    source_warning: 'Some personal sources were unavailable; the seven-day map still shows the verified choices.',
    twitter_allowance: { state: 'closed', available: false }, input_review: null,
    ...overrides,
  }
}

describe('MediaDietPage seven-day guidance', () => {
  let mutate
  let recordFeedback

  beforeEach(() => {
    vi.clearAllMocks()
    mutate = vi.fn((_, options) => options?.onSuccess?.())
    recordFeedback = vi.fn((_, options) => options?.onSuccess?.())
    mediaHooks.useMediaPlan.mockReturnValue({ data: payload(), isLoading: false, isError: false, error: null })
    mediaHooks.useUpdateMediaStatus.mockReturnValue({ mutate, isPending: false })
    mediaHooks.useStartTwitterAllowance.mockReturnValue({ mutate: vi.fn(), isPending: false })
    mediaHooks.useRecordMediaFeedback.mockReturnValue({ mutate: recordFeedback, isPending: false })
  })

  it('leads with today and shows all seven daily states without system jargon', () => {
    render(<MediaDietPage />)
    const today = screen.getByRole('region', { name: 'Today' })
    expect(within(today).getByText(todayItem.title)).toBeTruthy()
    expect(within(today).getByText(/Suggested:/)).toBeTruthy()
    const week = screen.getByRole('region', { name: 'Your week' })
    expect(week).toBeTruthy()
    expect(within(week).getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getByText(thursdayItem.title)).toBeTruthy()
    expect(screen.getByText(saturdayItem.title)).toBeTruthy()
    expect(screen.getByText(sundayItem.title)).toBeTruthy()
    expect(screen.queryByText(/media is closed/i)).toBeNull()
    expect(screen.queryByText(/ceiling|quota|recovery week/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Today' })).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('makes an intentional open day explicit and keeps Reset secondary', () => {
    const data = payload()
    data.today_guidance = { ...data.daily_map[4], date: '2026-09-04', is_today: true }
    data.daily_map = data.daily_map.map(row => ({ ...row, is_today: row.date === '2026-09-04' }))
    data.today = '2026-09-04'
    mediaHooks.useMediaPlan.mockReturnValue({ data, isLoading: false, isError: false, error: null })
    render(<MediaDietPage />)
    expect(screen.getByRole('heading', { name: 'No planned media today' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Reset' })).toBeTruthy()
    expect(screen.getAllByText(/projects, family, or rest/).length).toBeGreaterThan(0)
  })

  it('closes Done without promoting Thursday and collects one usefulness signal', () => {
    render(<MediaDietPage />)
    fireEvent.click(screen.getByRole('button', { name: `Mark done: ${todayItem.title}` }))
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'today', status: 'done', expected_revision: 1 }), expect.any(Object))
    expect(screen.getByText('Was that useful?')).toBeTruthy()
    expect(screen.queryByText(thursdayItem.title, { selector: 'h2' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }))
    expect(recordFeedback).toHaveBeenCalledWith(expect.objectContaining({ id: 'today', outcome: 'helpful' }), expect.any(Object))
  })

  it('keeps Spotify links directly actionable in the weekly map', () => {
    render(<MediaDietPage />)
    const links = screen.getAllByRole('link', { name: /Open source|Open/ })
    expect(links.some(link => link.getAttribute('href') === thursdayItem.source_url)).toBe(true)
    expect(links.some(link => link.getAttribute('href') === saturdayItem.source_url)).toBe(true)
  })

  it('supports Later and Skip without changing another day', () => {
    render(<MediaDietPage />)
    fireEvent.click(screen.getByRole('button', { name: `Move later: ${todayItem.title}` }))
    fireEvent.click(screen.getByRole('button', { name: `Skip item: ${todayItem.title}` }))
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ status: 'later' }), expect.any(Object))
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped' }), expect.any(Object))
  })

  it('teaches loading, error, and empty states', () => {
    mediaHooks.useMediaPlan.mockReturnValueOnce({ data: null, isLoading: true, isError: false, error: null })
    const { rerender } = render(<MediaDietPage />)
    expect(screen.getByLabelText('Loading media plan')).toBeTruthy()
    mediaHooks.useMediaPlan.mockReturnValueOnce({ data: payload({ plan: null, daily_map: [] }), isLoading: false, isError: false, error: null })
    rerender(<MediaDietPage />)
    expect(screen.getByText('No weekly media map yet')).toBeTruthy()
    mediaHooks.useMediaPlan.mockReturnValueOnce({ data: null, isLoading: false, isError: true, error: new Error('No connection') })
    rerender(<MediaDietPage />)
    expect(screen.getByRole('alert').textContent).toContain('No connection')
  })

  it('has no automated semantic accessibility violations', async () => {
    const { container } = render(<MediaDietPage />)
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations).toEqual([])
  })
})
