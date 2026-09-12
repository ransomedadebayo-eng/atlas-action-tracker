// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TodayList from './TodayList.jsx';
import { useTodayPlan } from '../hooks/useTodayPlan.js';
import { useCurrentMember, useMembers } from '../hooks/useMembers.js';

vi.mock('../hooks/useTodayPlan.js', () => ({ useTodayPlan: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: vi.fn(), useCurrentMember: vi.fn() }));
vi.mock('./ActionCardControls.jsx', () => ({
  default: ({ canArchive }) => <div data-testid="task-controls" data-can-archive={String(canArchive)} />,
}));

const task = {
  id: 'today-item-1',
  item_status: 'selected',
  action: {
    id: 'action-1',
    title: 'Prepare household plan',
    status: 'not_started',
    business: 'personal',
    priority: 'p2',
    owners: ['nicole'],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useTodayPlan.mockReturnValue({ data: { source: 'atlas_daily_plan', items: [task] }, isLoading: false, isError: false });
  useMembers.mockReturnValue({ data: [{ id: 'nicole', name: 'Nicole' }], isError: false });
  useCurrentMember.mockReturnValue({ data: { id: 'nicole', auth_kind: 'human_access' }, isError: false });
});

describe('TodayList scoped principal behavior', () => {
  it('keeps Today usable when the optional principal roster request fails', () => {
    useMembers.mockReturnValue({ data: undefined, isError: true, error: new Error('Principal roster unavailable') });

    render(<TodayList selectedBusiness={null} onSelectAction={vi.fn()} />);

    expect(screen.getByText('Prepare household plan')).toBeTruthy();
    expect(screen.queryByText('Principal roster unavailable')).toBeNull();
  });

  it('does not offer the owner-only archive control to Nicole', () => {
    render(<TodayList selectedBusiness={null} onSelectAction={vi.fn()} />);

    expect(screen.getByTestId('task-controls').getAttribute('data-can-archive')).toBe('false');
  });

  it('preserves the archive control for the owner', () => {
    useCurrentMember.mockReturnValue({ data: { id: 'ransomed', auth_kind: 'owner_access' }, isError: false });

    render(<TodayList selectedBusiness={null} onSelectAction={vi.fn()} />);

    expect(screen.getByTestId('task-controls').getAttribute('data-can-archive')).toBe('true');
  });

  it('still reports a failure from the required Today request', () => {
    useTodayPlan.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('Today unavailable') });

    render(<TodayList selectedBusiness={null} onSelectAction={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toContain('Today unavailable');
  });
});
