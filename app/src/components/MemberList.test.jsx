// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemberList from './MemberList.jsx'
import MemberDetail from './MemberDetail.jsx'
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

  it('includes agent principals on the default All tab', () => {
    render(<MemberList />)
    expect(screen.getByRole('heading', { name: 'Active Principals' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All (4)' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Amara')).toBeTruthy()
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.getByText('Ransomed')).toBeTruthy()
  })

  it('shows only agents when the Agents tab is selected', () => {
    render(<MemberList />)
    fireEvent.click(screen.getByRole('tab', { name: 'Agents (2)' }))
    expect(screen.getByRole('tab', { name: 'Agents (2)' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Amara')).toBeTruthy()
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.queryByText('Ransomed')).toBeNull()
  })
})


describe('principal action statuses', () => {
  it('counts open actions as active and legacy canceled actions as terminal', () => {
    memberHooks.useMember.mockReturnValue({ data: members[0], isLoading: false });
    memberHooks.useMembers.mockReturnValue({ data: members });
    memberHooks.useMemberActions.mockReturnValue({ data: [
      { id: 'a1', title: 'Unclassified intake', status: 'open', due_date: '2000-01-01', owners: [] },
      { id: 'a2', title: 'Canceled task', status: 'cancelled', due_date: '2000-01-01', owners: [] },
    ], isLoading: false });
    render(<MemberDetail memberId="ransomed" onBack={vi.fn()} onSelectAction={vi.fn()} />);
    expect(within(screen.getByText('Active').closest('.card')).getByText('1')).toBeTruthy();
    expect(within(screen.getByText('Overdue').closest('.card')).getByText('1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Needs triage (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Canceled (1)' }));
    expect(screen.getByRole('button', { name: 'Open action: Canceled task' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open action: Unclassified intake' })).toBeNull();
  });
});
