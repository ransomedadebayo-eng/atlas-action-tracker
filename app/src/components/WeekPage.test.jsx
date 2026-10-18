// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WeekPage, { ItemCard, weekScorecard } from './WeekPage.jsx';
import * as actionHooks from '../hooks/useActions.js';
import * as weekHooks from '../hooks/useWeekPlan.js';

vi.mock('../hooks/useActions.js', () => ({
  useActions: vi.fn(),
}));

vi.mock('../hooks/useWeekPlan.js', () => ({
  useWeekPlan: vi.fn(),
  useSaveWeekPlan: vi.fn(),
  useRequestWeekReview: vi.fn(),
  usePublishWeekPlan: vi.fn(),
  useForkWeekPlan: vi.fn(),
}));

vi.mock('../api/client.js', () => ({
  weeksApi: { createDraft: vi.fn() },
}));

function mutation() {
  return { mutate: vi.fn(), isPending: false };
}

const linkedAction = {
  id: 'action-foundation',
  title: 'Four-Lane · Foundation',
  status: 'in_progress',
};

const published = {
  id: 'week-1',
  version: 3,
  revision: 3,
  status: 'published',
  title: 'Readable weekly plan',
  summary: 'One concise weekly summary.',
  calendar_acknowledged: true,
  items: [
    {
      id: 'focus-1',
      kind: 'day_focus',
      plan_date: '2026-08-17',
      rank: 0,
      source_action_id: linkedAction.id,
      title: 'Foundation — Bible and protected marriage time',
      notes: 'Read the Bible after waking.',
      action: linkedAction,
    },
    {
      id: 'context-dated',
      kind: 'context',
      plan_date: '2026-08-18',
      rank: 0,
      source_action_id: null,
      title: 'Tuesday recovery context',
      notes: 'Use a recovery wake after the late evening.',
      action: null,
    },
    {
      id: 'missing-source',
      kind: 'day_focus',
      plan_date: '2026-08-19',
      rank: 0,
      source_action_id: 'missing-action',
      title: 'Saved focus with a missing source',
      notes: 'The weekly note should remain readable.',
      action: null,
      action_snapshot: { title: 'Archived source title' },
    },
    {
      id: 'risk-1',
      kind: 'risk',
      plan_date: null,
      rank: 0,
      source_action_id: null,
      title: 'Sleep debt risk',
      notes: 'Protect sleep opportunity.',
      action: null,
    },
    {
      id: 'context-undated',
      kind: 'context',
      plan_date: null,
      rank: 0,
      source_action_id: null,
      title: 'Capacity guidance',
      notes: 'Keep the week recovery-sized.',
      action: null,
    },
  ],
  commitments: [],
};

function renderWeek() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WeekPage
        weekStart="2026-08-17"
        onNavigateWeek={vi.fn()}
        onSelectAction={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('WeekPage readability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionHooks.useActions.mockReturnValue({ data: [linkedAction] });
    weekHooks.useWeekPlan.mockReturnValue({
      data: {
        published,
        draft: null,
        selected_revision: null,
        history: [
          { id: 'week-1', version: 3, status: 'published' },
          { id: 'week-0', version: 2, status: 'superseded' },
        ],
        diagnostics: { stale_calendar: false, missing_actions: ['missing-action'] },
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    weekHooks.useSaveWeekPlan.mockReturnValue(mutation());
    weekHooks.useRequestWeekReview.mockReturnValue(mutation());
    weekHooks.usePublishWeekPlan.mockReturnValue(mutation());
    weekHooks.useForkWeekPlan.mockReturnValue(mutation());
  });

  it('renders valid unlinked notes without false errors and suppresses dated duplicates', () => {
    const { container } = renderWeek();

    expect(screen.queryByText('Linked action is unavailable')).toBeNull();
    expect(screen.getAllByText('Tuesday recovery context')).toHaveLength(1);
    expect(screen.getByText('Sleep debt risk')).toBeTruthy();
    expect(screen.getByText('Capacity guidance')).toBeTruthy();
    expect(screen.getAllByText('One concise weekly summary.')).toHaveLength(1);

    const dayGrid = container.querySelector('.xl\\:grid-cols-3');
    expect(dayGrid).toBeTruthy();
    expect(container.querySelector('.xl\\:grid-cols-7')).toBeNull();
  });

  it('keeps real missing-source failures visible while preserving the weekly note', () => {
    renderWeek();

    expect(screen.getByText('Saved focus with a missing source')).toBeTruthy();
    expect(screen.getByText('Source task unavailable. The saved weekly note is still shown.')).toBeTruthy();
    expect(screen.getByText('Published source: Archived source title')).toBeTruthy();
    expect(screen.getByRole('button', { name: `Open source task: ${linkedAction.title}` })).toBeTruthy();
  });

  it('counts the linked current action status for each scorecard kind', () => {
    const items = [
      { kind: 'must_win', action: { status: 'done' } },
      { kind: 'must_win', action: { status: 'completed' } },
      { kind: 'must_win', action: { status: 'waiting' }, action_snapshot: { status: 'done' } },
      { kind: 'day_focus', action: { status: 'closed' } },
      { kind: 'day_focus', action: null, action_snapshot: { status: 'done' } },
      { id: 'carry-done', kind: 'carryover', action: { status: 'done' } },
      { id: 'carry-blocked', kind: 'carryover', action: { status: 'blocked' } },
      { kind: 'risk', action: { status: 'done' } },
    ];
    expect(weekScorecard(items)).toEqual({ mustWins: { done: 2, total: 3 }, dayFocus: { done: 1, total: 2 }, carriedOver: 2 });
    weekHooks.useWeekPlan.mockReturnValue({ data: { published: { ...published, items }, diagnostics: {} }, isLoading: false });
    renderWeek();
    expect(screen.getByLabelText('Week scorecard').textContent).toBe('Must wins done 2 of 3 · Day focus done 1 of 2 · Carried over 2');
  });

  it('refreshes completion counts when action status changes without a plan revision', () => {
    const view = renderWeek();
    expect(screen.getByLabelText('Week scorecard').textContent).toContain('Day focus done 0 of 2');
    weekHooks.useWeekPlan.mockReturnValue({
      data: { published: { ...published, items: published.items.map(item => item.id === 'focus-1' ? { ...item, action: { ...linkedAction, status: 'done' } } : item) }, diagnostics: {} },
      isLoading: false,
    });
    view.rerender(<QueryClientProvider client={new QueryClient()}><WeekPage weekStart="2026-08-17" onNavigateWeek={vi.fn()} onSelectAction={vi.fn()} /></QueryClientProvider>);
    expect(screen.getByLabelText('Week scorecard').textContent).toContain('Day focus done 1 of 2');
  });

  it('labels every plan-item editor control', () => {
    render(
      <ItemCard
        item={{ kind: 'day_focus', plan_date: '2026-08-17', source_action_id: '', title: 'Editable item', notes: '' }}
        editing
        actions={[linkedAction]}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onSelectAction={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Weekly item type')).toBeTruthy();
    expect(screen.getByLabelText('Linked Atlas action')).toBeTruthy();
    expect(screen.getByLabelText('Plan date')).toBeTruthy();
    expect(screen.getByLabelText('Weekly item title')).toBeTruthy();
    expect(screen.getByLabelText('Weekly item notes')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Choose an Atlas action');
  });

  it('has no automated semantic accessibility violations', async () => {
    const { container } = renderWeek();
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(results.violations).toEqual([]);
  });
});
