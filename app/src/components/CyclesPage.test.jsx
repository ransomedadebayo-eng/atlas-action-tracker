// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CyclesPage from './CyclesPage.jsx';
import * as actionHooks from '../hooks/useActions.js';
import * as cycleHooks from '../hooks/useCycles.js';

vi.mock('../hooks/useActions.js', () => ({ useActions: vi.fn() }));
vi.mock('../hooks/useCycles.js', () => ({
  useCycles: vi.fn(), useCycle: vi.fn(), useConfigureCycles: vi.fn(),
  useAssignCycleAction: vi.fn(), useRemoveCycleAction: vi.fn(), useCompleteCycle: vi.fn(), useDisableCycles: vi.fn(), useStartCycleToday: vi.fn(),
}));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }) }));

function mutation() { return { mutateAsync: vi.fn(), isPending: false }; }
const cycle = {
  id: 'cycle-1', schedule_id: 'schedule-1', cycle_number: 4, name: 'Cycle 4', status: 'active',
  start_date: '2026-08-17', end_date: '2026-08-30', revision: 2,
  schedule: { id: 'schedule-1', business: 'personal', duration_weeks: 2, auto_rollover: true },
  metrics: { issue_count: 2, completed_count: 1, started_count: 1, scope_effort: 5, completed_effort: 2, started_effort: 3, completion_percent: 40, success_percent: 55 },
  capacity: { value: 6, source: 'previous_three_cycles', history_count: 3 }, capacity_load_percent: 83,
  actions: [{ id: 'action-1', title: 'Cycle action', status: 'in_progress', estimate_points: 3 }],
  graph_points: [{ id: 1, scope_effort: 3, started_effort: 0, completed_effort: 0 }, { id: 2, scope_effort: 5, started_effort: 3, completed_effort: 2 }],
  previous_cycle: { id: 'cycle-0', name: 'Cycle 3' }, next_cycle: { id: 'cycle-2', name: 'Cycle 5' },
  divergence: { added_after_completion: [], removed_after_completion: [], snapshot_fixed: false },
};

describe('CyclesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionHooks.useActions.mockReturnValue({ data: [{ id: 'action-2', title: 'Unplanned action', status: 'not_started', cycle_id: null }] });
    cycleHooks.useCycles.mockReturnValue({ data: { schedules: [cycle.schedule], cycles: [cycle, { ...cycle, id: 'cycle-2', name: 'Cycle 5', status: 'planned' }], current: [cycle], upcoming: [{ ...cycle, id: 'cycle-2', name: 'Cycle 5', status: 'planned' }], completed: [] }, isLoading: false, isError: false });
    cycleHooks.useCycle.mockReturnValue({ data: cycle, isLoading: false, isError: false });
    for (const hook of ['useConfigureCycles', 'useAssignCycleAction', 'useRemoveCycleAction', 'useCompleteCycle', 'useDisableCycles', 'useStartCycleToday']) cycleHooks[hook].mockReturnValue(mutation());
  });

  it('renders current and upcoming cycles with capacity', () => {
    render(<CyclesPage cycleId={null} selectedBusiness="personal" onOpenCycle={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Cycles' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open cycle: Cycle 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open cycle: Cycle 5' })).toBeTruthy();
    expect(screen.getAllByText(/Capacity 6/).length).toBeGreaterThan(0);
  });

  it('renders cycle graph, scope, navigation, and completion controls', () => {
    render(<CyclesPage cycleId="cycle-1" selectedBusiness="personal" onOpenCycle={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Cycle 4' })).toBeTruthy();
    expect(screen.getByLabelText('Cycle scope graph')).toBeTruthy();
    expect(screen.getByText('Cycle action')).toBeTruthy();
    expect(screen.getByLabelText('Action to add to cycle')).toBeTruthy();
    expect(screen.getByRole('button', { name: /complete cycle/i })).toBeTruthy();
  });

  it('allows the next planned cycle to start today', () => {
    cycleHooks.useCycle.mockReturnValue({ data: { ...cycle, id: 'cycle-2', name: 'Cycle 5', status: 'planned' }, isLoading: false, isError: false });
    render(<CyclesPage cycleId="cycle-2" selectedBusiness="personal" onOpenCycle={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    expect(screen.getByRole('button', { name: /start today/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: '.ics' }).getAttribute('href')).toContain('/calendar.ics');
  });

  it('has no automated semantic accessibility violations', async () => {
    const { container } = render(<CyclesPage cycleId="cycle-1" selectedBusiness="personal" onOpenCycle={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
