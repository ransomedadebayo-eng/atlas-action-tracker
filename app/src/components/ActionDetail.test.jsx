// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActionDetail from './ActionDetail.jsx'
import * as actionHooks from '../hooks/useActions.js'

vi.mock('./LazyDiscussionThread.jsx', () => ({ default: ({ targetType }) => <div data-testid={`${targetType}-discussion`} /> }))

vi.mock('../hooks/useActions.js', () => ({
  useAction: vi.fn(),
  useUpdateAction: vi.fn(),
  useArchiveAction: vi.fn(),
  useRestoreAction: vi.fn(),
  useCompleteAction: vi.fn(),
  useCreateAgentAssignment: vi.fn(),
}))
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [] }) }))
vi.mock('../hooks/useBusinesses.js', () => ({
  useBusinessContext: () => ({ BUSINESSES: {}, BUSINESS_LIST: [], BUSINESS_COLORS: {} }),
}))
vi.mock('../hooks/useEstimateSettings.js', () => ({ useEstimateSettings: () => ({ data: { enabled: false } }) }))
vi.mock('./ActionStructureSection.jsx', () => ({ default: () => <div>Action structure</div> }))
vi.mock('./ActionCycleControl.jsx', () => ({ default: () => <div>Action cycle</div> }))
vi.mock('../api/client.js', () => ({ activityApi: { get: vi.fn().mockResolvedValue([]) } }))

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ActionDetail actionId="a1" onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

function mutation(mutateAsync = vi.fn()) {
  return { mutateAsync, isPending: false }
}

describe('ActionDetail trust states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actionHooks.useUpdateAction.mockReturnValue(mutation())
    actionHooks.useArchiveAction.mockReturnValue(mutation())
    actionHooks.useRestoreAction.mockReturnValue(mutation())
    actionHooks.useCreateAgentAssignment.mockReturnValue(mutation())
  })

  it('presents action query failures as an accessible alert', () => {
    actionHooks.useAction.mockReturnValue({ isLoading: false, isError: true, error: new Error('Action unavailable') })
    actionHooks.useCompleteAction.mockReturnValue(mutation())

    renderDetail()

    expect(screen.getByRole('alert').textContent).toContain('Action unavailable')
    expect(screen.getByRole('dialog', { name: /unavailable/i })).toBeTruthy()
  })

  it('requires a nonempty manual completion summary', async () => {
    const complete = vi.fn().mockResolvedValue({ id: 'a1', status: 'done', revision: 4 })
    actionHooks.useAction.mockReturnValue({
      data: {
        id: 'a1', identifier: 'ATLAS-608', title: 'Trust repair', status: 'in_progress', priority: 'p1', owners: ['ransomed'],
        tags: [],
        evidence_json: {
          version: 2,
          kind: 'verified_execution',
          summary: 'Deployment and readback verified.',
          sources: ['staging'],
          verification: { status: 'verified' },
        },
        approval_state: 'not_required', revision: 3,
      },
      isLoading: false,
      isError: false,
    })
    actionHooks.useCompleteAction.mockReturnValue(mutation(complete))

    renderDetail()
    expect(screen.getByText('ATLAS-608')).toBeTruthy()
    expect(screen.getByLabelText('Existing completion evidence').textContent).toContain('Deployment and readback verified.')
    fireEvent.click(screen.getByRole('button', { name: 'Mark Done' }))

    expect(await screen.findByText(/enter a completion note/i)).toBeTruthy()
    expect(complete).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Completion note'), { target: { value: 'Verified the finished result.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark Done' }))

    await waitFor(() => expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      id: 'a1',
      expected_revision: 3,
      evidence: expect.objectContaining({ kind: 'manual_attestation', summary: 'Verified the finished result.' }),
    })))
  })
})
