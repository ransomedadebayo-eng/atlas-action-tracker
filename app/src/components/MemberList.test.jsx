// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemberList from './MemberList.jsx'
import * as memberHooks from '../hooks/useMembers.js'

vi.mock('../hooks/useMembers.js', () => ({
  useMembers: vi.fn(),
  useMemberStats: vi.fn(),
  useMember: vi.fn(),
  useMemberActions: vi.fn(),
}))

vi.mock('../hooks/useBusinesses.js', () => ({
  useBusinessContext: () => ({ BUSINESSES: {}, BUSINESS_COLORS: {} }),
}))

const members = [
  { id: 'ransomed', name: 'Ransomed', principal_type: 'owner', is_active: true, role: 'Owner', businesses: [] },
  { id: 'nicole', name: 'Nicole', principal_type: 'human', is_active: true, role: 'Human', businesses: [] },
  { id: 'amara', name: 'Amara', principal_type: 'agent', is_active: true, role: 'Chief of Staff', businesses: [] },
  { id: 'engineering', name: 'Engineering', principal_type: 'agent', is_active: true, role: 'Engineering Manager', businesses: [] },
]

describe('MemberList principals', () => {
  beforeEach(() => {
    memberHooks.useMembers.mockReturnValue({ data: members, isLoading: false, isError: false })
    memberHooks.useMemberStats.mockReturnValue({ data: [], isLoading: false, isError: false })
  })

  it('shows agent principals on the default All tab', () => {
    render(<MemberList />)
    expect(screen.getByText('Amara')).toBeTruthy()
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.getByText('Ransomed')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Agents (2)' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: 'All (4)' }).getAttribute('aria-selected')).toBe('true')
  })

  it('limits the list to agents when the Agents tab is selected', () => {
    render(<MemberList />)
    fireEvent.click(screen.getByRole('tab', { name: 'Agents (2)' }))
    expect(screen.getByText('Amara')).toBeTruthy()
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.queryByText('Ransomed')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Agents (2)' }).getAttribute('aria-selected')).toBe('true')
  })
})
