// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActionDetail from './ActionDetail.jsx'
import * as hooks from '../hooks/useActions.js'
import { activityApi } from '../api/client.js'

vi.mock('../hooks/useActions.js', () => ({
  useAction: vi.fn(), useUpdateAction: vi.fn(), useArchiveAction: vi.fn(),
  useRestoreAction: vi.fn(), useCompleteAction: vi.fn(), useCreateAgentAssignment: vi.fn(),
}))
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [] }) }))
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESSES: {}, BUSINESS_LIST: [], BUSINESS_COLORS: {} }) }))
vi.mock('../hooks/useEstimateSettings.js', () => ({ useEstimateSettings: () => ({ data: { enabled: false } }) }))
vi.mock('../api/client.js', () => ({ activityApi: { get: vi.fn().mockResolvedValue([]) } }))
vi.mock('./ActionStructureSection.jsx', () => ({ default: () => null }))
vi.mock('./LazyDiscussionThread.jsx', () => ({ default: () => <div>
  <details><summary>Discussion options</summary><button>Closed discussion control</button></details>
  <button disabled>Pending discussion control</button>
  <div hidden><button>Hidden discussion control</button></div>
  <div style={{ display: 'none' }}><button>Unrendered discussion control</button></div>
  <button tabIndex={-1}>Skipped discussion control</button>
</div> }))

const action = { id: 'a1', title: 'Focus regression', status: 'open', priority: 'p2', owners: [], tags: [], revision: 1 }

describe('ActionDetail keyboard focus', () => {
  let query, opener, client
  beforeEach(() => {
    query = { isLoading: true, isError: false }
    activityApi.get.mockResolvedValue([])
    hooks.useAction.mockImplementation(() => query)
    for (const hook of ['useUpdateAction', 'useRestoreAction', 'useCompleteAction', 'useCreateAgentAssignment']) {
      hooks[hook].mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    }
    hooks.useArchiveAction.mockReturnValue({ mutateAsync: vi.fn(), isPending: true })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    opener = document.createElement('button')
    opener.textContent = 'Open action'
    document.body.append(opener)
    opener.focus()
  })
  afterEach(() => {
    client.clear()
    opener.remove()
    vi.restoreAllMocks()
  })
  function mount(onClose = vi.fn()) {
    return render(<ActionDetail actionId="a1" onClose={onClose} />, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })
  }

  it('focuses the real panel after loading, wraps both Tab directions, and restores the opener', async () => {
    const view = mount()
    expect(document.activeElement).toBe(opener)
    query = { data: action, isLoading: false, isError: false }
    view.rerender(<ActionDetail actionId="a1" onClose={vi.fn()} />)
    const title = await screen.findByLabelText('Action title')
    const panel = title.closest('[tabindex="-1"]')
    await waitFor(() => expect(document.activeElement).toBe(panel))
    const close = within(panel).getByRole('button', { name: 'Close action details' })
    expect(within(panel).getByRole('button', { name: 'Archive action' }).disabled).toBe(true)

    fireEvent.keyDown(panel, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    const summary = screen.getByText('Discussion options')
    expect(document.activeElement).toBe(summary)
    fireEvent.keyDown(summary, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    // The same trap picks up newly expanded controls instead of a mount-time list.
    summary.parentElement.open = true
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('Closed discussion control'))
    title.focus()
    query = { ...query, data: { ...action, notes: 'Refetched' } }
    view.rerender(<ActionDetail actionId="a1" onClose={vi.fn()} />)
    expect(document.activeElement).toBe(title)
    view.unmount()
    expect(document.activeElement).toBe(opener)
  })

  it('keeps dirty Escape dismissal behind the discard guard and consumes the shortcut', async () => {
    query = { data: action, isLoading: false, isError: false }
    const onClose = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const globalShortcut = vi.fn()
    window.addEventListener('keydown', globalShortcut)
    const view = mount(onClose)
    const title = await screen.findByLabelText('Action title')
    fireEvent.change(title, { target: { value: 'Unsaved change' } })
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    expect(globalShortcut).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    window.removeEventListener('keydown', globalShortcut)
    view.unmount()
    expect(document.activeElement).toBe(opener)
  })

  it('makes a load failure keyboard accessible and restores focus when dismissed', () => {
    query = { isLoading: false, isError: true, error: new Error('Unavailable') }
    const onClose = vi.fn()
    const view = mount(onClose)
    const dialog = screen.getByRole('dialog', { name: 'Action details unavailable' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close action details' }))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    view.unmount()
    expect(document.activeElement).toBe(opener)
  })
})
