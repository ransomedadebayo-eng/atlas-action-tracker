// @vitest-environment jsdom

import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { actionsApi } from '../api/client.js'
import { useArchiveAction, useCompleteAction, useRestoreAction, useUpdateAction } from './useActions.js'

vi.mock('../api/client.js', () => ({
  actionsApi: {
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
    client.setQueryData(['action', 'a1'], { id: 'a1', next_action: 'Old step', notes: 'Old history' })
    const saved = { id: 'a1', next_action: 'New step', notes: 'Concurrent history', priority: 'p0', revision: 12 }
    actionsApi.update.mockResolvedValue(saved)
    const { result } = renderHook(() => useUpdateAction(), { wrapper: createWrapper(client) })

    await act(() => result.current.mutateAsync({ id: 'a1', next_action: 'New step' }))

    expect(actionsApi.update).toHaveBeenCalledExactlyOnceWith('a1', { next_action: 'New step' })
    expect(client.getQueryData(['action', 'a1'])).toEqual(saved)
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
