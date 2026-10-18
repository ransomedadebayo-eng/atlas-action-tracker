// @vitest-environment jsdom

import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActionDetail from './ActionDetail.jsx'
import { actionsApi } from '../api/client.js'

// Exercise the actual action query/mutation hooks and panel together.
vi.mock('../api/client.js', () => ({
  actionsApi: { get: vi.fn(), update: vi.fn() },
  activityApi: { get: vi.fn().mockResolvedValue([]) },
}))
vi.mock('./LazyDiscussionThread.jsx', () => ({ default: () => null }))
vi.mock('./ActionStructureSection.jsx', () => ({ default: () => null }))
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [] }) }))
vi.mock('../hooks/useBusinesses.js', () => ({
  useBusinessContext: () => ({ BUSINESSES: {}, BUSINESS_LIST: [], BUSINESS_COLORS: {} }),
}))
vi.mock('../hooks/useEstimateSettings.js', () => ({ useEstimateSettings: () => ({ data: { enabled: false } }) }))

describe('ActionDetail saved detail cache', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['delayed', 'failed'])('keeps GET enrichment and the authoritative form after saving with a %s refetch', async refetch => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const notes = '  Historical notes <keep>\n' + 'n'.repeat(10598) + '\n  '
    const action = {
      id: 'a1', title: 'Repair follow-up', status: 'waiting', priority: 'p1',
      due_date: '2026-10-09', owners: [], tags: [], next_action: 'Old step', notes, revision: 11,
    }
    const relations = [{ id: 'rel1', related_action: { id: 'a2', title: 'Related action' } }]
    client.setQueryData(['action', 'a1'], { ...action, relations })
    const saved = { ...action, next_action: 'Saved step', due_date: null, priority: 'p0', revision: 12 }
    actionsApi.update.mockResolvedValue(saved)
    let resolveRefetch
    if (refetch === 'delayed') {
      actionsApi.get.mockReturnValue(new Promise(resolve => { resolveRefetch = resolve }))
    } else {
      actionsApi.get.mockRejectedValue(new Error('Refetch unavailable'))
    }
    render(<ActionDetail actionId="a1" onClose={vi.fn()} />, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    fireEvent.change(screen.getByLabelText('Next action'), { target: { value: '  Saved step  ' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /^Sav(e|ing)/ })).toBeNull())
    await waitFor(() => expect(client.getQueryState(['action', 'a1'])).toMatchObject(
      refetch === 'failed' ? { status: 'error', fetchStatus: 'idle' } : { fetchStatus: 'fetching' },
    ))
    expect(actionsApi.update).toHaveBeenCalledExactlyOnceWith('a1', { next_action: '  Saved step  ', due_date: null })
    expect(screen.getByLabelText('Next action').value).toBe('Saved step')
    expect(screen.getByLabelText('Due date').value).toBe('')
    expect(screen.getByLabelText('Action notes').value).toBe(notes)
    expect(client.getQueryData(['action', 'a1'])).toEqual({ ...saved, relations })

    // The server-normalized form becomes the next baseline, even without a GET.
    fireEvent.change(screen.getByLabelText('Action title'), { target: { value: 'Updated title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(actionsApi.update).toHaveBeenCalledTimes(2))
    expect(actionsApi.update).toHaveBeenLastCalledWith('a1', { title: 'Updated title' })
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Sav(e|ing)/ })).toBeNull())

    if (resolveRefetch) await act(async () => resolveRefetch({ ...saved, relations: [] }))
    client.clear()
  })
})
