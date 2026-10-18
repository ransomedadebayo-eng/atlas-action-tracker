// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JournalPage from './JournalPage.jsx'
import * as hooks from '../hooks/useJournal.js'

vi.mock('../hooks/useJournal.js', () => ({
  useJournalEntries: vi.fn(), useCreateJournalEntry: vi.fn(), useUpdateJournalEntry: vi.fn(),
  useArchiveJournalEntry: vi.fn(), usePromoteJournalEntry: vi.fn(),
}))
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [] }) }))

describe('JournalPage query states', () => {
  beforeEach(() => hooks.useCreateJournalEntry.mockReturnValue({ mutate: vi.fn(), isPending: false }))

  it('announces a failed read without the empty journal claim or zero totals', () => {
    hooks.useJournalEntries.mockReturnValue({ isLoading: false, isError: true, error: new Error('Journal unavailable') })
    render(<JournalPage />)
    expect(screen.getByRole('alert').textContent).toBe('Journal unavailable')
    expect(screen.queryByText('No journal entries match this view.')).toBeNull()
    expect(screen.queryByText('Shown')).toBeNull()
  })

  it('shows empty copy and zero totals after a successful empty read', () => {
    hooks.useJournalEntries.mockReturnValue({ data: { entries: [] }, isLoading: false, isError: false })
    render(<JournalPage />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('No journal entries match this view.')).toBeTruthy()
    expect(screen.getByText('Shown').previousElementSibling.textContent).toBe('0')
  })
})
