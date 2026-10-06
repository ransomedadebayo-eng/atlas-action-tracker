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
vi.mock('../hooks/useWorkflows.js', () => ({ useWorkflow: () => ({ data: null }) }))
vi.mock('./ActionStructureSection.jsx', () => ({ default: () => <div>Action structure</div> }))
vi.mock('./ActionCycleControl.jsx', () => ({ default: () => <div>Action cycle</div> }))
vi.mock('../api/client.js', () => ({ activityApi: { get: vi.fn().mockResolvedValue([]) } }))

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<ActionDetail actionId="a1" onClose={vi.fn()} />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
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

describe('ActionDetail partial saves', () => {
  let action
  let update

  beforeEach(() => {
    vi.clearAllMocks()
    action = {
      id: 'a1', title: 'Repair follow-up', status: 'waiting', priority: 'p1',
      due_date: '2026-10-09', owners: ['ransomed'], tags: ['repair'],
      next_action: 'Await vendor response.', notes: 'Existing history.', revision: 11,
      evidence_json: { summary: 'Existing evidence' },
    }
    actionHooks.useAction.mockImplementation(() => ({ data: action, isLoading: false, isError: false }))
    update = vi.fn().mockImplementation(async ({ id, ...fields }) => {
      if (fields.notes?.length > 10000) throw new Error('notes exceeds maximum length of 10000 characters')
      action = { ...action, ...fields, id }
      return action
    })
    actionHooks.useUpdateAction.mockReturnValue(mutation(update))
    actionHooks.useArchiveAction.mockReturnValue(mutation())
    actionHooks.useRestoreAction.mockReturnValue(mutation())
    actionHooks.useCompleteAction.mockReturnValue(mutation())
    actionHooks.useCreateAgentAssignment.mockReturnValue(mutation())
  })

  it.each([10499, 10598])('saves a next action with %i characters of unchanged notes', async length => {
    const prefix = '  History <keep>—\n'
    const suffix = '\n  '
    const notes = prefix + 'x'.repeat(length - prefix.length - suffix.length) + suffix
    action.notes = notes
    renderDetail()
    expect(screen.getByLabelText('Action notes').value).toBe(notes)

    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Await visit findings and written quote.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Sav(e|ing)/ })).toBeNull())
    expect(update).toHaveBeenCalledExactlyOnceWith({ id: 'a1', next_action: 'Await visit findings and written quote.' })
    expect(action.notes).toBe(notes)
    expect(action).toMatchObject({ status: 'waiting', priority: 'p1', due_date: '2026-10-09' })
  })

  it('does not resubmit stale untouched fields after a concurrent refetch', async () => {
    const view = renderDetail()
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Await the approved schedule.' } })
    action = {
      ...action, title: 'Updated by owner', notes: 'New history.\n' + 'x'.repeat(10598),
      status: 'in_progress', priority: 'p0', due_date: '2026-10-10', owners: ['codex'],
      tags: ['approved'], evidence_json: { summary: 'New owner evidence' }, revision: 12,
    }
    const concurrent = { ...action }
    view.rerender(<ActionDetail actionId="a1" onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Sav(e|ing)/ })).toBeNull())
    expect(update).toHaveBeenCalledExactlyOnceWith({ id: 'a1', next_action: 'Await the approved schedule.' })
    expect(action).toEqual({ ...concurrent, next_action: 'Await the approved schedule.' })
  })

  it('skips a save when edits were reverted to the loaded values', async () => {
    renderDetail()
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Temporary edit' } })
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: action.next_action } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Sav(e|ing)/ })).toBeNull())
    expect(update).not.toHaveBeenCalled()
  })

  it('treats restored tag arrays as unchanged', async () => {
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag repair' }))
    fireEvent.change(screen.getByLabelText('Add tag'), { target: { value: 'repair' } })
    fireEvent.keyDown(screen.getByLabelText('Add tag'), { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Updated step' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith({ id: 'a1', next_action: 'Updated step' }))
  })

  it('uses the saved form as the baseline for the next save', async () => {
    renderDetail()
    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: 'Updated step' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Sav(e|ing)/ })).toBeNull())

    fireEvent.change(screen.getByLabelText('Action title'), { target: { value: 'Updated title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenLastCalledWith({ id: 'a1', title: 'Updated title' })
  })

  it('keeps review packet overrides partial with oversized notes', async () => {
    action.status = 'in_progress'
    action.notes = 'n'.repeat(10598)
    renderDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Needs Review Packet' }))

    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith({ id: 'a1', status: 'waiting', approval_state: 'needs_review' }))
    expect(action.notes).toHaveLength(10598)
  })

  it('sends intentional notes edits and explicit date clearing without other fields', async () => {
    renderDetail()
    fireEvent.change(screen.getByLabelText('Action notes'), { target: { value: 'Owner-edited history.' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith({ id: 'a1', notes: 'Owner-edited history.', due_date: null }))
  })

  it('keeps failed notes edits available for correction', async () => {
    renderDetail()
    const notes = 'n'.repeat(10001)
    fireEvent.change(screen.getByLabelText('Action notes'), { target: { value: notes } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'notes exceeds maximum length of 10000 characters')
    expect(screen.getByLabelText('Action notes').value).toBe(notes)
    expect(screen.getByRole('button', { name: 'Save', exact: true }).disabled).toBe(false)
    expect(action.notes).toBe('Existing history.')
  })
})
