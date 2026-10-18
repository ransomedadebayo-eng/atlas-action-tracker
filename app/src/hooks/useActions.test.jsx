// @vitest-environment jsdom

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { actionsApi } from '../api/client.js'
import { useAction, useArchiveAction, useCompleteAction, useRestoreAction, useUpdateAction } from './useActions.js'

vi.mock('../api/client.js', () => ({
  actionsApi: {
    get: vi.fn(),
    update: vi.fn(),
    complete: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
  },
}))

function createWrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return function TestQueryProvider({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('safe action mutation hooks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards only edited fields and caches the authoritative saved action', async () => {
    const client = new QueryClient()
    const relations = [{ id: 'rel1', related_action: { id: 'a2', title: 'Related action' } }]
    client.setQueryData(['action', 'a1'], { id: 'a1', next_action: 'Old step', notes: 'Old history', relations })
    const saved = { id: 'a1', next_action: 'New step', notes: 'Concurrent history', priority: 'p0', revision: 12 }
    actionsApi.update.mockResolvedValue(saved)
    const { result } = renderHook(() => useUpdateAction(), { wrapper: createWrapper(client) })

    await act(() => result.current.mutateAsync({ id: 'a1', next_action: 'New step' }))

    expect(actionsApi.update).toHaveBeenCalledExactlyOnceWith('a1', { next_action: 'New step' })
    expect(client.getQueryData(['action', 'a1'])).toEqual({ ...saved, relations })
  })

  it('keeps GET-only enrichment during a delayed refetch, then accepts refreshed associations', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const relations = [{ id: 'rel1', related_action: { id: 'a2', title: 'Related action' } }]
    client.setQueryData(['action', 'a1'], { id: 'a1', next_action: 'Old step', revision: 11, relations })
    const saved = { id: 'a1', next_action: 'Saved step', priority: 'p0', revision: 12 }
    actionsApi.update.mockResolvedValue(saved)
    let resolveRefetch
    actionsApi.get.mockReturnValue(new Promise(resolve => { resolveRefetch = resolve }))
    const { result } = renderHook(() => ({ action: useAction('a1'), update: useUpdateAction() }), { wrapper: createWrapper(client) })

    await act(() => result.current.update.mutateAsync({ id: 'a1', next_action: 'Saved step' }))

    await waitFor(() => expect(result.current.action.isFetching).toBe(true))
    expect(actionsApi.get).toHaveBeenCalledExactlyOnceWith('a1')
    expect(result.current.action.data).toEqual({ ...saved, relations })

    await act(async () => resolveRefetch({ ...saved, relations: [] }))

    await waitFor(() => expect(result.current.action.isFetching).toBe(false))
    expect(result.current.action.data).toEqual({ ...saved, relations: [] })
    client.clear()
  })

  it('keeps saved fields and GET-only enrichment when the refetch fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    const relations = [{ id: 'rel1', related_action: { id: 'a2', title: 'Related action' } }]
    client.setQueryData(['action', 'a1'], { id: 'a1', next_action: 'Old step', revision: 11, relations })
    const saved = { id: 'a1', next_action: 'Saved step', notes: 'Concurrent history', revision: 12 }
    actionsApi.update.mockResolvedValue(saved)
    actionsApi.get.mockRejectedValue(new Error('Refetch unavailable'))
    const { result } = renderHook(() => ({ action: useAction('a1'), update: useUpdateAction() }), { wrapper: createWrapper(client) })

    await act(() => result.current.update.mutateAsync({ id: 'a1', next_action: 'Saved step' }))

    await waitFor(() => expect(result.current.action.isRefetchError).toBe(true))
    expect(result.current.action.data).toEqual({ ...saved, relations })
    expect(result.current.update.isSuccess).toBe(true)
    client.clear()
  })

  it('accepts authoritative clears, empty arrays, zero estimates and server normalization', async () => {
    const client = new QueryClient()
    client.setQueryData(['action', 'a1'], {
      id: 'a1', next_action: 'Old step', notes: 'Old notes', due_date: '2026-10-09',
      tags: ['old'], owners: ['ransomed'], estimate_points: 3, parent_action_id: 'a2',
      relations: [{ id: 'rel1' }],
    })
    const fields = { next_action: '  Saved step  ', notes: '', due_date: null, tags: [], owners: [], estimate_points: 0 }
    const saved = { id: 'a1', ...fields, next_action: 'Saved step', parent_action_id: null, relations: [] }
    actionsApi.update.mockResolvedValue(saved)
    const { result } = renderHook(() => useUpdateAction(), { wrapper: createWrapper(client) })

    await act(() => result.current.mutateAsync({ id: 'a1', ...fields }))

    expect(actionsApi.update).toHaveBeenCalledExactlyOnceWith('a1', fields)
    expect(client.getQueryData(['action', 'a1'])).toEqual(saved)
    client.clear()
  })

  it('seeds the detail cache when no GET data is cached', async () => {
    const client = new QueryClient()
    const saved = { id: 'a1', next_action: 'Saved step', due_date: null, revision: 12 }
    actionsApi.update.mockResolvedValue(saved)
    const { result } = renderHook(() => useUpdateAction(), { wrapper: createWrapper(client) })

    await act(() => result.current.mutateAsync({ id: 'a1', next_action: 'Saved step' }))

    expect(client.getQueryData(['action', 'a1'])).toEqual(saved)
    client.clear()
  })

  it('sends explicit completion evidence and revision', async () => {
    actionsApi.complete.mockResolvedValue({ id: 'a1', revision: 8 })
    const { result } = renderHook(() => useCompleteAction(), { wrapper: createWrapper() })
    const evidence = {
      version: 2,
      kind: 'manual_attestation',
      summary: 'Verified the finished result.',
      sources: [],
      verification: { status: 'attested' },
    }

    await act(() => result.current.mutateAsync({ id: 'a1', expected_revision: 7, evidence }))

    expect(actionsApi.complete).toHaveBeenCalledWith('a1', { expected_revision: 7, evidence })
  })

  it('uses audited archive and restore endpoints', async () => {
    actionsApi.archive.mockResolvedValue({ id: 'a1', status: 'archived' })
    actionsApi.restore.mockResolvedValue({ id: 'a1', status: 'not_started' })
    const archive = renderHook(() => useArchiveAction(), { wrapper: createWrapper() })
    const restore = renderHook(() => useRestoreAction(), { wrapper: createWrapper() })

    await act(() => archive.result.current.mutateAsync({ id: 'a1', expected_revision: 2 }))
    await act(() => restore.result.current.mutateAsync({ id: 'a1', expected_revision: 3 }))

    expect(actionsApi.archive).toHaveBeenCalledWith('a1', { expected_revision: 2 })
    expect(actionsApi.restore).toHaveBeenCalledWith('a1', { expected_revision: 3 })
  })
})
