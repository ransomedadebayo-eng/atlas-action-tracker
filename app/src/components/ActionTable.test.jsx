// @vitest-environment jsdom

import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActionTable from './ActionTable.jsx'
import { useActions } from '../hooks/useActions.js'

vi.mock('../hooks/useActions.js', () => ({ useActions: vi.fn() }))
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [] }) }))
vi.mock('../hooks/useCycles.js', () => ({ useCycles: () => ({ data: { cycles: [] } }) }))
vi.mock('../hooks/useViews.js', () => ({ useViews: () => ({ data: [] }) }))
vi.mock('../hooks/useBusinesses.js', () => ({
  useBusinessContext: () => ({ BUSINESS_LIST: [], BUSINESSES: {}, BUSINESS_COLORS: {} }),
}))
vi.mock('./StatsStrip.jsx', () => ({ default: () => null }))
vi.mock('./ActionCardControls.jsx', () => ({ default: () => null }))
vi.mock('./FilterBar.jsx', () => ({
  default: ({ onFilterChange }) => <button onClick={() => onFilterChange({ priority: 'p1' })}>Choose priority</button>,
}))

const actions = [
  { id: 'older', title: 'Older update', status: 'waiting', priority: 'p1', updated_at: '2026-09-10T12:00:00Z', completed_at: '2026-09-10T12:00:00Z' },
  { id: 'newer', title: 'Newer update', status: 'waiting', priority: 'p2', updated_at: '2026-09-12T12:00:00Z', completed_at: '2026-09-12T12:00:00Z' },
]

function Harness() {
  const [savedViewId, setSavedViewId] = useState('office-digest-waiting-on-owner')
  return <>
    <button onClick={() => setSavedViewId(null)}>All Tasks</button>
    <ActionTable savedViewId={savedViewId} onSavedViewIdChange={setSavedViewId} />
  </>
}

function latestQuery() {
  return useActions.mock.calls.at(-1)[0]
}

describe('ActionTable digest saved views', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useActions.mockReturnValue({ data: actions })
  })
  afterEach(cleanup)

  it.each(['office-digest-waiting-on-owner', 'office-digest-blocked-by-office', 'office-digest-done'])(
    'sorts %s newest first', savedViewId => {
      render(<ActionTable savedViewId={savedViewId} />)
      expect(screen.getAllByLabelText(/^Open action:/).map(row => row.textContent)).toEqual([
        expect.stringContaining('Newer update'), expect.stringContaining('Older update'),
        expect.stringContaining('Newer update'), expect.stringContaining('Older update'),
      ])
    },
  )

  it('clears the digest filters, selected chip and sort on All Tasks navigation', () => {
    render(<Harness />)
    expect(latestQuery()).toMatchObject({ open: 'true', approval_state: 'needs_review' })
    fireEvent.click(screen.getByRole('button', { name: 'All Tasks' }))
    expect(latestQuery().open).toBeUndefined()
    expect(latestQuery().approval_state).toBeUndefined()
    expect(latestQuery().status).toContain('not_started')
    expect(screen.getByRole('button', { name: 'Waiting-on-owner' }).className).not.toContain('bg-accent-muted')
    expect(screen.getAllByLabelText(/^Open action:/)[0].textContent).toContain('Older update')
  })

  it('preserves a protocol filter selected while leaving a digest', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Codex Pull Queue' }))
    expect(latestQuery()).toMatchObject({ work_mode: 'autonomous', owner_id: 'codex' })
    expect(latestQuery().open).toBeUndefined()
  })

  it('preserves a manual filter selected while leaving a digest', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose priority' }))
    expect(latestQuery()).toMatchObject({ priority: 'p1' })
    expect(latestQuery().open).toBeUndefined()
  })
})
