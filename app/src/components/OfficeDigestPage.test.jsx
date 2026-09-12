// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OfficeDigestPage from './OfficeDigestPage.jsx'
import * as digestHooks from '../hooks/useOfficeDigest.js'
import * as memberHooks from '../hooks/useMembers.js'

vi.mock('../hooks/useOfficeDigest.js', () => ({
  useOfficeDigest: vi.fn(),
}))

vi.mock('../hooks/useMembers.js', () => ({
  useMembers: vi.fn(),
}))

vi.mock('../hooks/useBusinesses.js', () => ({
  useBusinessContext: () => ({
    BUSINESS_LIST: [
      { id: 'personal', label: 'Personal' },
      { id: 'riddim_exchange', label: 'Riddim Exchange' },
    ],
    BUSINESSES: {
      personal: { label: 'Personal' },
      riddim_exchange: { label: 'Riddim Exchange' },
    },
    BUSINESS_COLORS: {
      personal: '#888888',
      riddim_exchange: '#44aa88',
    },
  }),
}))

const items = [
  {
    digest_bucket: 'done',
    id: 'done-1',
    identifier: 'ATLAS-101',
    title: 'Lease packet filed',
    status: 'done',
    business: 'personal',
    owners: ['ransomed'],
    agent_assignment_id: 'assign-1',
    completed_at: '2026-09-12T12:00:00Z',
    approval_state: 'not_required',
    priority: 'p2',
  },
  {
    digest_bucket: 'waiting_on_owner',
    id: 'wait-1',
    identifier: 'ATLAS-202',
    title: 'Needs owner review',
    status: 'in_progress',
    business: 'riddim_exchange',
    owners: ['amara', 'ransomed'],
    agent_assignment_id: null,
    approval_state: 'needs_review',
    priority: 'p1',
  },
]

describe('OfficeDigestPage', () => {
  beforeEach(() => {
    digestHooks.useOfficeDigest.mockReturnValue({
      data: { source: 'atlas_office_digest_v1', as_of: '2026-09-12T22:00:00Z', items },
      isLoading: false,
      isError: false,
    })
    memberHooks.useMembers.mockReturnValue({
      data: [
        { id: 'ransomed', name: 'Ransomed' },
        { id: 'amara', name: 'Amara' },
      ],
    })
  })

  it('renders the three exact buckets grouped by office with owners and assignment ids', () => {
    const onOpenSavedView = vi.fn()
    render(<OfficeDigestPage onSelectAction={vi.fn()} onOpenSavedView={onOpenSavedView} />)

    expect(screen.getByRole('heading', { name: 'Office Digest' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Done (48h)' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Waiting-on-owner' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Blocked-by-office' })).toBeTruthy()
    expect(screen.getByText('No actions in this bucket.')).toBeTruthy()
    expect(screen.getByText('ATLAS-101')).toBeTruthy()
    expect(screen.getByText('1:1 owner')).toBeTruthy()
    expect(screen.getByText('assign-1')).toBeTruthy()
    expect(screen.getByText('2 owners')).toBeTruthy()
    expect(screen.getByText('No assignment')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'office-digest-done' }))
    expect(onOpenSavedView).toHaveBeenCalledWith('office-digest-done')
  })
})
