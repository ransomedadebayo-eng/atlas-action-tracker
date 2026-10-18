// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectsPage from './ProjectsPage.jsx';
import * as actionHooks from '../hooks/useActions.js';
import * as memberHooks from '../hooks/useMembers.js';
import * as projectHooks from '../hooks/useProjects.js';
import * as viewHooks from '../hooks/useViews.js';

vi.mock('./LazyDiscussionThread.jsx', () => ({ default: ({ targetType }) => <div data-testid={`${targetType}-discussion`} /> }));

vi.mock('../hooks/useActions.js', () => ({ useActions: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: vi.fn() }));
vi.mock('../hooks/useBusinesses.js', () => ({
  useBusinessContext: () => ({ BUSINESSES: { personal: { label: 'Personal Office' } }, BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }),
}));
vi.mock('../hooks/useEstimateSettings.js', () => ({
  useEstimateSettings: () => ({ data: { enabled: true, options: [{ value: 1, label: '1' }, { value: 3, label: '3' }] } }),
}));
vi.mock('../hooks/useProjects.js', () => ({
  useProjects: vi.fn(),
  useProject: vi.fn(),
  useCreateProject: vi.fn(),
  useUpdateProject: vi.fn(),
  useArchiveProject: vi.fn(),
  useRestoreProject: vi.fn(),
  useCreateProjectMilestone: vi.fn(),
  useUpdateProjectMilestone: vi.fn(),
  useArchiveProjectMilestone: vi.fn(),
  usePostProjectUpdate: vi.fn(),
  useCreateProjectDependency: vi.fn(),
  useResolveProjectDependency: vi.fn(),
  useArchiveProjectDependency: vi.fn(),
  useAssignProjectAction: vi.fn(),
  useRemoveProjectAction: vi.fn(),
  useReorderProject: vi.fn(),
  useMoveProjectTimeline: vi.fn(),
}));
vi.mock('../hooks/useViews.js', () => ({
  useViews: vi.fn(),
  useCreateView: vi.fn(),
  useUpdateView: vi.fn(),
  useArchiveView: vi.fn(),
}));

function mutation() {
  return { mutateAsync: vi.fn(), isPending: false };
}

const project = {
  id: 'project-1',
  name: 'Atlas project foundation',
  summary: 'Add outcome-level project management.',
  description: 'Projects connect strategy to executable Atlas actions.',
  business: 'personal',
  status: 'in_progress',
  health: 'on_track',
  priority: 'p1',
  lead_id: 'codex',
  members: ['ransomed', 'codex'],
  start_date: '2026-08-20',
  target_date: '2026-09-15',
  update_frequency: 'weekly',
  revision: 3,
  sort_order: 1000, open_action_count: 3, oldest_open_days: 21, is_stale: true, last_activity_at: '2026-09-01T00:00:00Z',
  progress: {
    total_issues: 2,
    completed_issues: 1,
    blocked_issues: 0,
    active_issues: 1,
    total_effort: 5,
    completed_effort: 2,
    progress_percent: 40,
  },
  actions: [{ id: 'action-1', identifier: 'ATLAS-101', title: 'Build project API', status: 'in_progress', priority: 'p1', estimate_points: 3, project_milestone_id: 'milestone-1' }],
  milestones: [{ id: 'milestone-1', name: 'Foundation', status: 'in_progress', target_date: '2026-08-31', revision: 1 }],
  updates: [{ id: 'update-1', health: 'on_track', body: 'Schema and API are connected.', created_by: 'codex', created_at: '2026-08-20T20:00:00Z' }],
  dependencies: [],
  activity: [],
};

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/projects');
    memberHooks.useMembers.mockReturnValue({ data: [{ id: 'ransomed', name: 'Ransomed' }, { id: 'codex', name: 'Codex' }] });
    actionHooks.useActions.mockReturnValue({ data: [] });
    viewHooks.useViews.mockReturnValue({ data: [] });
    viewHooks.useCreateView.mockReturnValue(mutation());
    viewHooks.useUpdateView.mockReturnValue(mutation());
    viewHooks.useArchiveView.mockReturnValue(mutation());
    projectHooks.useProjects.mockReturnValue({ data: [project], isLoading: false, isError: false });
    projectHooks.useProject.mockReturnValue({ data: project, isLoading: false, isError: false });
    for (const name of [
      'useCreateProject', 'useUpdateProject', 'useArchiveProject', 'useRestoreProject',
      'useCreateProjectMilestone', 'useUpdateProjectMilestone', 'useArchiveProjectMilestone',
      'usePostProjectUpdate', 'useCreateProjectDependency', 'useResolveProjectDependency',
      'useArchiveProjectDependency',
      'useAssignProjectAction', 'useRemoveProjectAction', 'useReorderProject', 'useMoveProjectTimeline',
    ]) projectHooks[name].mockReturnValue(mutation());
  });

  it('renders a portfolio project with health and progress', () => {
    render(<ProjectsPage projectId={null} selectedBusiness={null} searchQuery="" onOpenProject={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
    const projectButton = screen.getByRole('button', { name: /open project: atlas project foundation/i });
    expect(projectButton.textContent).toContain('40%');
    expect(projectButton.textContent).toContain('on track');
    expect(projectButton.textContent).toContain('3 open actions');
    expect(projectButton.textContent).toContain('Oldest open 21 days');
    expect(projectButton.textContent).toContain('Stale');
    expect(screen.getByRole('heading', { name: 'Personal Office' })).toBeTruthy();
    expect(screen.getByLabelText('Group projects by').value).toBe('business');
    expect(new URLSearchParams(window.location.search).get('group')).toBe('business');
    expect(screen.queryByLabelText('Filter projects by initiative')).toBeNull();
  });

  it('renders the project aggregate and mutation controls', () => {
    viewHooks.useViews.mockReturnValue({ data: [{ id: 'view-1', name: 'Started work', entity_type: 'action', context_project_id: 'project-1', filters: { status: 'in_progress,waiting,blocked' }, layout: 'list', sort_by: 'priority', revision: 0, is_favorite: true }] });
    render(<ProjectsPage projectId="project-1" selectedBusiness={null} searchQuery="" onOpenProject={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Atlas project foundation' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Project actions' })).toBeTruthy();
    expect(screen.getByText('Build project API')).toBeTruthy();
    expect(screen.getAllByText('Foundation').length).toBeGreaterThan(0);
    expect(screen.getByText('Schema and API are connected.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Started work/ })).toBeTruthy();
  });

  it('announces failed and successful project saves through the same persistent polite status', async () => {
    const update = vi.fn()
      .mockRejectedValueOnce(new Error('start_date must not be after target_date'))
      .mockResolvedValueOnce(project);
    projectHooks.useUpdateProject.mockReturnValue({ mutateAsync: update, isPending: false });
    render(<ProjectsPage projectId="project-1" selectedBusiness={null} searchQuery="" onOpenProject={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Edit project' }));
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByText('start_date must not be after target_date')).toBe(status);
    expect(screen.getByRole('button', { name: 'Save project' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }));
    expect(await screen.findByText('Project saved.')).toBe(status);
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Save project' })).toBeNull();
  });

  it.each([
    ['canceled', 'cancelled'], ['cancelled', 'canceled'],
    ['not_started', 'todo'], ['todo', 'not_started'], ['not_started', 'backlog'],
    ['open', 'triage'], ['triage', 'open'], ['done', 'completed'], ['closed', 'done'],
  ])('includes historical %s/%s aliases in project action views', (filterStatus, storedStatus) => {
    projectHooks.useProject.mockReturnValue({ data: {
      ...project,
      actions: [
        { id: 'matching', title: 'Matching historical action', status: storedStatus, priority: 'p1' },
        { id: 'excluded', title: 'Unrelated blocked action', status: 'blocked', priority: 'p1' },
      ],
    }, isLoading: false, isError: false });
    viewHooks.useViews.mockReturnValue({ data: [{
      id: 'alias-view', name: 'Saved status view', entity_type: 'action', context_project_id: 'project-1',
      filters: { status: filterStatus }, layout: 'list', sort_by: 'priority', revision: 0,
    }] });
    render(<ProjectsPage projectId="project-1" selectedBusiness={null} searchQuery="" onOpenProject={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Saved status view' }));
    expect(screen.getByText('Matching historical action')).toBeTruthy();
    expect(screen.queryByText('Unrelated blocked action')).toBeNull();
  });

  it('has no automated semantic accessibility violations on project detail', async () => {
    const { container } = render(<ProjectsPage projectId="project-1" selectedBusiness={null} searchQuery="" onOpenProject={vi.fn()} onBack={vi.fn()} onSelectAction={vi.fn()} />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
