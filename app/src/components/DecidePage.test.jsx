// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DecidePage from './DecidePage.jsx'
import { useDecisionQueue } from '../hooks/useDecide.js'

vi.mock('../hooks/useDecide.js', () => ({ useDecisionQueue: vi.fn(), useDecideProposal: vi.fn() }))

const empty = { proposals: [], reports: [], runs: [], signals: [], reviews: [], source_errors: [] }
const emptyMessages = ['Decision queue is clear.', 'No agent runs need owner action.', 'No open signals.', 'No strategic reviews are ready.']

describe('DecidePage query states', () => {
  it('announces a failed read without claiming the queue is clear or reporting zero counts', () => {
    useDecisionQueue.mockReturnValue({ isLoading: false, isError: true, error: new Error('Decision service unavailable') })
    render(<DecidePage />)
    expect(screen.getByRole('alert').textContent).toBe('Decision service unavailable')
    for (const message of emptyMessages) expect(screen.queryByText(message)).toBeNull()
    expect(screen.queryByText('0 open')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Agent runs' })).toBeNull()
  })

  it('shows the clear queue and empty sections only after a successful zero result', () => {
    useDecisionQueue.mockReturnValue({ data: empty, isLoading: false, isError: false })
    render(<DecidePage />)
    expect(screen.queryByRole('alert')).toBeNull()
    for (const message of emptyMessages) expect(screen.getByText(message)).toBeTruthy()
    expect(screen.getByText('0 open')).toBeTruthy()
  })

  it('keeps loading distinct from the empty queue', () => {
    useDecisionQueue.mockReturnValue({ isLoading: true, isError: false })
    render(<DecidePage />)
    expect(screen.getByText('Loading decision queue...')).toBeTruthy()
    for (const message of emptyMessages) expect(screen.queryByText(message)).toBeNull()
    expect(screen.queryByText('0 open')).toBeNull()
  })
})
