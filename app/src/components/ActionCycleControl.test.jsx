// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActionCycleControl from './ActionCycleControl.jsx';
import * as cycleHooks from '../hooks/useCycles.js';

vi.mock('../hooks/useCycles.js', () => ({ useCycles: vi.fn(), useAssignCycleAction: vi.fn(), useRemoveCycleAction: vi.fn() }));
function mutation() { return { mutateAsync: vi.fn(), isPending: false }; }

describe('ActionCycleControl', () => {
  beforeEach(() => {
    cycleHooks.useCycles.mockReturnValue({ data: { cycles: [{ id: 'cycle-1', name: 'Cycle 4', status: 'active' }], current: [{ id: 'cycle-1', name: 'Cycle 4', status: 'active' }], upcoming: [{ id: 'cycle-2', name: 'Cycle 5', status: 'planned' }] }, isLoading: false, isError: false });
    cycleHooks.useAssignCycleAction.mockReturnValue(mutation());
    cycleHooks.useRemoveCycleAction.mockReturnValue(mutation());
  });
  it('shows the current and upcoming cycle options', () => {
    render(<ActionCycleControl action={{ id: 'a1', business: 'personal', cycle_id: 'cycle-1' }} isArchived={false} />);
    expect(screen.getByLabelText('Action cycle').value).toBe('cycle-1');
    expect(screen.getByRole('option', { name: 'Cycle 5 · planned' })).toBeTruthy();
  });
});
