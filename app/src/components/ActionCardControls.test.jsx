// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActionCardControls from './ActionCardControls.jsx'
import * as actionHooks from '../hooks/useActions.js'

vi.mock('../hooks/useActions.js', () => ({
  useCompleteAction: vi.fn(),
  useArchiveAction: vi.fn(),
}))

function mutation(mutateAsync = vi.fn()) {
  return { mutateAsync, isPending: false }
}

const action = { id: 'a1', title: 'Mobile lifecycle task', revision: 7 }

describe('ActionCardControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actionHooks.useCompleteAction.mockReturnValue(mutation())
    actionHooks.useArchiveAction.mockReturnValue(mutation())
  })

  it('requires completion evidence and keeps the card click isolated', async () => {
    const complete = vi.fn().mockResolvedValue({ id: 'a1', status: 'done' })
    const openCard = vi.fn()
    actionHooks.useCompleteAction.mockReturnValue(mutation(complete))

    render(
      <div onClick={openCard}>
        <ActionCardControls action={action} />
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Complete Mobile lifecycle task' }))
    expect(openCard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Complete task' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a completion note')
    expect(complete).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Completion note'), { target: { value: 'Verified the finished result.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete task' }))

    await waitFor(() => expect(complete).toHaveBeenCalledWith({
      id: 'a1',
      expected_revision: 7,
      evidence: {
        version: 2,
        kind: 'manual_attestation',
        summary: 'Verified the finished result.',
        sources: [],
        verification: { status: 'attested' },
      },
    }))
  })

  it('explains and confirms the safe archive transition', async () => {
    const archive = vi.fn().mockResolvedValue({ id: 'a1', status: 'archived' })
    actionHooks.useArchiveAction.mockReturnValue(mutation(archive))

    render(<ActionCardControls action={action} />)

    fireEvent.click(screen.getByRole('button', { name: 'Archive Mobile lifecycle task' }))
    expect(screen.getByText(/not permanently deleted/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Archive task' }))

    await waitFor(() => expect(archive).toHaveBeenCalledWith({ id: 'a1', expected_revision: 7 }))
  })
})
