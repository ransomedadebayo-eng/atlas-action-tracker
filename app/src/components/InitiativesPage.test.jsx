// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InitiativesPage, { InitiativeCompletionGraph, groupInitiatives, initiativeResourceHref, initiativeTimelineGeometry } from './InitiativesPage.jsx';
import * as initiativeHooks from '../hooks/useInitiatives.js';
import * as projectHooks from '../hooks/useProjects.js';
import * as memberHooks from '../hooks/useMembers.js';
import * as viewHooks from '../hooks/useViews.js';

vi.mock('./LazyDiscussionThread.jsx', () => ({ default: ({ targetType }) => <div data-testid={`${targetType}-discussion`} /> }));

vi.mock('../hooks/useInitiatives.js', () => ({
  useInitiatives: vi.fn(), useInitiative: vi.fn(), useInitiativeGraph: vi.fn(), useCreateInitiative: vi.fn(), useUpdateInitiative: vi.fn(),
  useArchiveInitiative: vi.fn(), useRestoreInitiative: vi.fn(), useReorderInitiative: vi.fn(), useAttachInitiativeProject: vi.fn(),
  useDetachInitiativeProject: vi.fn(), useAttachInitiativeParent: vi.fn(), useDetachInitiativeParent: vi.fn(), usePostInitiativeUpdate: vi.fn(),
  useCreateInitiativeResource: vi.fn(), useArchiveInitiativeResource: vi.fn(),
}));
vi.mock('../hooks/useProjects.js', () => ({ useProjects: vi.fn() }));
vi.mock('../hooks/useMembers.js', () => ({ useMembers: vi.fn() }));
vi.mock('../hooks/useViews.js', () => ({ useViews: vi.fn(), useCreateView: vi.fn(), useUpdateView: vi.fn(), useArchiveView: vi.fn() }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESS_LIST: [{ id: 'personal', label: 'Personal' }] }) }));

const initiative = {
  id: 'i1', name: 'Return time to families', summary: 'Make household coordination calmer.', description: 'Strategic objective', business: 'personal',
  status: 'active', health: 'at_risk', priority: 'p1', owner_id: 'ransomed', labels: ['2026', 'family'], start_date: '2026-08-01', target_date: '2026-12-31', revision: 2,
  parents: [{ id: 'parent', name: 'FamilyOS' }], children: [{ id: 'child', name: 'Household operations' }],
  direct_projects: [{ id: 'p1', name: 'FamilyOS foundation' }], projects: [{ id: 'p1', name: 'FamilyOS foundation', status: 'in_progress', health: 'at_risk' }],
  rollup: { active_projects: 1, completed_projects: 0, progress_percent: 42, total_issues: 4, completed_issues: 2, total_effort: 8, completed_effort: 3, project_health: { on_track: 0, at_risk: 1, off_track: 0, no_update: 0 } },
  updates: [{ id: 'u1', health: 'at_risk', body: 'Need customer evidence.', created_by: 'ransomed', created_at: '2026-08-20T20:00:00Z' }],
  resources: [{ id: 'r1', title: 'Strategy brief', resource_type: 'link', url: 'https://example.com/brief', revision: 0 }],
};
const graph = { series: [{ project_id: 'p1', project_name: 'FamilyOS foundation', points: [{ week_start: '2026-08-16', completed_issues: 2 }] }] };
function mutation() { return { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }; }

describe('InitiativesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memberHooks.useMembers.mockReturnValue({ data: [{ id: 'ransomed', name: 'Ransomed' }, { id: 'codex', name: 'Codex' }] });
    projectHooks.useProjects.mockReturnValue({ data: [{ id: 'p2', name: 'Available project' }] });
    initiativeHooks.useInitiatives.mockReturnValue({ data: [initiative], isLoading: false, isError: false });
    initiativeHooks.useInitiative.mockReturnValue({ data: initiative, isLoading: false, isError: false });
    initiativeHooks.useInitiativeGraph.mockReturnValue({ data: graph, isLoading: false });
    viewHooks.useViews.mockReturnValue({ data: [] });
    for (const hook of ['useCreateView', 'useUpdateView', 'useArchiveView']) viewHooks[hook].mockReturnValue(mutation());
    for (const hook of ['useCreateInitiative', 'useUpdateInitiative', 'useArchiveInitiative', 'useRestoreInitiative', 'useReorderInitiative', 'useAttachInitiativeProject', 'useDetachInitiativeProject', 'useAttachInitiativeParent', 'useDetachInitiativeParent', 'usePostInitiativeUpdate', 'useCreateInitiativeResource', 'useArchiveInitiativeResource']) initiativeHooks[hook].mockReturnValue(mutation());
  });

  it('groups and lays out initiative portfolio data', () => {
    expect(groupInitiatives([initiative], 'status')[0][0]).toBe('active');
    expect(initiativeTimelineGeometry([initiative], 'quarter').dated).toHaveLength(1);
    render(<InitiativesPage initiativeId={null} selectedBusiness={null} searchQuery="" onOpenInitiative={vi.fn()} onBack={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Initiatives' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open initiative: Return time to families' })).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('renders only HTTPS links or encoded internal document routes', () => {
    expect(initiativeResourceHref({ resource_type: 'link', url: 'https://example.com/brief' })).toBe('https://example.com/brief');
    expect(initiativeResourceHref({ resource_type: 'link', url: 'javascript:alert(1)' })).toBeNull();
    expect(initiativeResourceHref({ resource_type: 'document', document_ref: 'doc:familyos-charter' })).toBe('/documents/doc%3Afamilyos-charter');
    expect(initiativeResourceHref({ resource_type: 'document', document_ref: 'javascript:alert(1)' })).toBeNull();
  });

  it('renders initiative detail, hierarchy, resources, updates, and graph', () => {
    render(<InitiativesPage initiativeId="i1" selectedBusiness={null} searchQuery="" onOpenInitiative={vi.fn()} onBack={vi.fn()} onOpenProject={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Return time to families' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(screen.getAllByText('Need customer evidence.').length).toBeGreaterThan(0);
    expect(screen.getByText('FamilyOS')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Strategy brief' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Weekly completed issues by contributing project' })).toBeTruthy();
  });

  it('renders an accessible initiative detail', async () => {
    const { container } = render(<InitiativesPage initiativeId="i1" selectedBusiness={null} searchQuery="" onOpenInitiative={vi.fn()} onBack={vi.fn()} onOpenProject={vi.fn()} />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

describe('InitiativeCompletionGraph', () => {
  it('shows an explicit empty state', () => {
    render(<InitiativeCompletionGraph graph={{ series: [] }} />);
    expect(screen.getByText(/No completed project actions/i)).toBeTruthy();
  });
});
