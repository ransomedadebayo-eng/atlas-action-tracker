// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TodayList from './TodayList.jsx';
import { useTodayPlan } from '../hooks/useTodayPlan.js';
import { useCompleteAction, useArchiveAction } from '../hooks/useActions.js';

vi.mock('../hooks/useTodayPlan.js', () => ({ useTodayPlan: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [] }) }));
vi.mock('../hooks/useActions.js', () => ({ useCompleteAction: vi.fn(), useArchiveAction: vi.fn() }));
vi.mock('../hooks/useBusinesses.js', () => ({
  useBusinessContext: () => ({ BUSINESSES: {}, BUSINESS_COLORS: {} }),
}));

function action(id, status, extra = {}) {
  return { id, title: `Task ${id}`, status, business: 'atlas', priority: 'p2', owners: [], revision: 7, ...extra };
}

function setItems(items) {
  useTodayPlan.mockReturnValue({ data: { source: 'weekly_plan_guidance', items: items.map(item => item.action ? { source_action_id: item.action.id, ...item } : item) }, isLoading: false, isError: false });
}

const terminalStatuses = ['done', 'completed', 'closed', 'canceled', 'cancelled', 'archived', ' CANCELED '];

describe('TodayList task eligibility', () => {
  let complete;

  beforeEach(() => {
    vi.clearAllMocks();
    complete = vi.fn().mockResolvedValue({ status: 'done' });
    useCompleteAction.mockReturnValue({ mutateAsync: complete, isPending: false });
    useArchiveAction.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    setItems([]);
  });

  it('excludes terminal aliases and archived records before applying the five-task limit', () => {
    const hidden = terminalStatuses.map((status, index) => action(`terminal-${index}`, status));
    hidden.push(action('archived-open', 'open', { archived_at: '2026-10-18T00:00:00Z' }));
    const visible = ['open', 'triage', 'not_started', 'todo', 'in_progress', 'waiting'].map((status, index) => action(`eligible-${index}`, status));
    setItems([
      ...hidden.map((row, index) => index % 2 ? row : { id: `plan-${row.id}`, action: row }),
      ...visible.map(row => ({ id: `plan-${row.id}`, action: row })),
    ]);

    render(<TodayList onSelectAction={vi.fn()} />);

    hidden.forEach(row => {
      expect(screen.queryByText(row.title)).toBeNull();
      expect(screen.queryByRole('button', { name: `Complete ${row.title}` })).toBeNull();
      expect(screen.queryByRole('button', { name: `Archive ${row.title}` })).toBeNull();
    });
    visible.slice(0, 5).forEach(row => expect(screen.getByText(row.title)).toBeTruthy());
    expect(screen.queryByText(visible[5].title)).toBeNull();
    expect(screen.getByText('5 items')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Complete Task eligible-/ })).toHaveLength(5);
    expect(complete).not.toHaveBeenCalled();
  });

  it('renders the empty Today state when a plan contains only terminal work', () => {
    setItems(terminalStatuses.map((status, index) => ({ action: action(`closed-${index}`, status) })));

    render(<TodayList onSelectAction={vi.fn()} />);

    expect(screen.getByText('No tasks selected for today.')).toBeTruthy();
    expect(screen.getByText('0 items')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Complete / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Archive / })).toBeNull();
  });

  it('retains scoped task navigation and evidence-required completion for eligible work', async () => {
    const onSelectAction = vi.fn();
    setItems([
      { action: action('other-office', 'open', { business: 'personal', title: 'Review another office' }) },
      { action: action('other-search', 'open', { title: 'Unrelated work' }) },
      { action: action('eligible', 'waiting', { title: 'Review the owner packet' }) },
    ]);
    render(<TodayList selectedBusiness="atlas" searchQuery="owner packet" onSelectAction={onSelectAction} />);

    expect(screen.queryByText('Review another office')).toBeNull();
    expect(screen.queryByText('Unrelated work')).toBeNull();
    fireEvent.click(screen.getByText('Review the owner packet').closest('button'));
    expect(onSelectAction).toHaveBeenCalledExactlyOnceWith('eligible');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Review the owner packet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete task' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a completion note');
    expect(complete).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Completion note'), { target: { value: 'Verified the eligible task outcome.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete task' }));
    await waitFor(() => expect(complete).toHaveBeenCalledExactlyOnceWith({
      id: 'eligible', expected_revision: 7,
      evidence: { version: 2, kind: 'manual_attestation', summary: 'Verified the eligible task outcome.', sources: [], verification: { status: 'attested' } },
    }));
  });
});
