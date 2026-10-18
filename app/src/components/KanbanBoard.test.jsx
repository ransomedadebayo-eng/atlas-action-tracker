// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KanbanBoard from './KanbanBoard.jsx';
import { useActions } from '../hooks/useActions.js';
vi.mock('../hooks/useActions.js', () => ({ useActions: vi.fn(), useUpdateAction: () => ({ mutate: vi.fn() }) }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: () => ({ data: [] }) }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESSES: {}, BUSINESS_LIST: [], BUSINESS_COLORS: {} }) }));
vi.mock('./ActionCardControls.jsx', () => ({ default: () => null }));
const base = { owners: [], tags: [], priority: 'p2' };
describe('Kanban statuses', () => {
  beforeEach(() => useActions.mockReturnValue({ data: [] }));
  it('shows the seven fixed columns and keeps archived work hidden', () => {
    useActions.mockReturnValue({ data: [
      { ...base, id: 'open', title: 'Classify this task', status: 'open' },
      { ...base, id: 'cancelled', title: 'Canceled history', status: 'cancelled' },
      { ...base, id: 'archived', title: 'Archived history', status: 'archived' },
    ] });
    render(<KanbanBoard hideDone={false} />);
    expect(screen.getByText('Needs triage')).toBeTruthy();
    expect(screen.getByText('To do')).toBeTruthy();
    expect(screen.getByText('Canceled')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open action: Canceled history' })).toBeTruthy();
    expect(screen.queryByText('Unclassified')).toBeNull();
    expect(screen.queryByText('Archived history')).toBeNull();
  });
  it('adds an Unclassified column only when unknown statuses exist', () => {
    useActions.mockReturnValue({ data: [{ ...base, id: 'unknown', title: 'Legacy work', status: 'unmapped' }] });
    render(<KanbanBoard hideDone={false} />);
    expect(screen.getByText('Unclassified')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open action: Legacy work' })).toBeTruthy();
  });
});
