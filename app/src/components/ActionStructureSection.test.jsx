// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActionStructureSection from './ActionStructureSection.jsx';
import * as actionHooks from '../hooks/useActions.js';

vi.mock('../hooks/useActions.js', () => ({
  useActionStructure: vi.fn(),
  useActions: vi.fn(),
  useCreateSubAction: vi.fn(),
  useSetActionParent: vi.fn(),
  useCreateActionRelation: vi.fn(),
  useTransitionActionRelation: vi.fn(),
  useMarkActionDuplicate: vi.fn(),
  useRestoreDuplicateAction: vi.fn(),
  useConvertActionToProject: vi.fn(),
}));

function mutation() {
  return { mutateAsync: vi.fn(), isPending: false };
}

const action = { id: 'parent-1', title: 'Parent action', status: 'in_progress', revision: 2, resolution: null };
const structure = {
  parent: { id: 'root-1', title: 'Root outcome', status: 'in_progress' },
  children: [{ id: 'child-1', title: 'Child implementation', status: 'done', estimate_points: 3 }],
  child_progress: { total_children: 1, completed_children: 1, total_effort: 3, completed_effort: 3, progress_percent: 100 },
  relations: [{ id: 'rel-1', relation_type: 'blocks', direction: 'blocked_by', related_action: { id: 'blocker-1', title: 'Blocking action' } }],
  canonical_action: null,
};

describe('ActionStructureSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionHooks.useActionStructure.mockReturnValue({ data: structure, isLoading: false, isError: false });
    actionHooks.useActions.mockReturnValue({ data: [
      { id: 'candidate-1', title: 'Candidate action', status: 'not_started' },
      { id: 'canonical-1', title: 'Canonical action', status: 'in_progress' },
    ] });
    for (const hook of ['useCreateSubAction', 'useSetActionParent', 'useCreateActionRelation', 'useTransitionActionRelation', 'useMarkActionDuplicate', 'useRestoreDuplicateAction', 'useConvertActionToProject']) {
      actionHooks[hook].mockReturnValue(mutation());
    }
  });

  it('renders hierarchy progress, parent, child, and relation direction', () => {
    render(<ActionStructureSection action={action} isArchived={false} onSelectAction={vi.fn()} />);
    expect(screen.getByText('1/1 complete · 3/3 effort')).toBeTruthy();
    expect(screen.getByText('Root outcome')).toBeTruthy();
    expect(screen.getByText('Child implementation')).toBeTruthy();
    expect(screen.getAllByText('Blocked by').length).toBeGreaterThan(0);
    expect(screen.getByText('Blocking action')).toBeTruthy();
    expect(screen.getByLabelText('New sub-action title')).toBeTruthy();
    expect(screen.getByLabelText('Related action')).toBeTruthy();
    expect(screen.getByRole('button', { name: /convert parent action to project/i })).toBeTruthy();
    expect(screen.getByText('Automatic references')).toBeTruthy();
  });

  it('renders a distinct duplicate banner and restore control', () => {
    actionHooks.useActionStructure.mockReturnValue({
      data: { ...structure, canonical_action: { id: 'canonical-1', title: 'Canonical action' } },
      isLoading: false,
      isError: false,
    });
    render(<ActionStructureSection action={{ ...action, status: 'done', resolution: 'duplicate', duplicate_of_id: 'canonical-1' }} isArchived={false} />);
    expect(screen.getByText('Duplicate resolution')).toBeTruthy();
    expect(screen.getByText('Canonical: Canonical action')).toBeTruthy();
    expect(screen.getByRole('button', { name: /restore as active/i })).toBeTruthy();
    expect(screen.queryByLabelText('New sub-action title')).toBeNull();
  });

  it('has no automated semantic accessibility violations', async () => {
    const { container } = render(<ActionStructureSection action={action} isArchived={false} />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
