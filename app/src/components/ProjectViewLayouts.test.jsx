// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import ProjectViewLayouts, { groupProjects, projectGroupValue, timelineGeometry } from './ProjectViewLayouts.jsx';

const projects = [
  {
    id: 'foundation', name: 'Foundation', status: 'in_progress', health: 'on_track', priority: 'p1',
    lead_id: 'codex', members: ['codex'], start_date: '2026-08-20', target_date: '2026-08-28',
    progress: { progress_percent: 40 }, milestones: [{ id: 'm1', name: 'Schema', target_date: '2026-08-24' }],
    dependencies: [{ id: 'd1', blocking_project_id: 'foundation', blocked_project_id: 'launch', violated: true }],
  },
  {
    id: 'launch', name: 'Launch', status: 'planned', health: 'at_risk', priority: 'p0',
    lead_id: null, members: [], start_date: '2026-08-25', target_date: '2026-09-03',
    progress: { progress_percent: 5 }, milestones: [],
    dependencies: [{ id: 'd1', blocking_project_id: 'foundation', blocked_project_id: 'launch', violated: true }],
  },
];

const callbacks = {
  onOpenProject: vi.fn(),
  onMoveBefore: vi.fn(),
  onStatusChange: vi.fn(),
  onShiftProject: vi.fn(),
};

describe('project view layouts', () => {
  it('groups project rows using stable empty-value buckets', () => {
    expect(projectGroupValue(projects[1], 'lead')).toBe('No lead');
    expect(groupProjects(projects, 'status').map(([name]) => name)).toEqual(['planned', 'in_progress']);
  });

  it('calculates bounded timeline geometry for dated projects', () => {
    const geometry = timelineGeometry(projects, 'month');
    expect(geometry.dated).toHaveLength(2);
    expect(geometry.x('2026-08-20')).toBeGreaterThan(0);
    expect(geometry.x('2026-09-03')).toBeLessThan(100);
    expect(geometry.unitDays).toBe(30);
  });

  it('renders accessible list and board project controls', () => {
    const { rerender } = render(<ProjectViewLayouts {...callbacks} projects={projects} layout="list" groupBy="status" manualOrder />);
    expect(screen.getByRole('button', { name: 'Open project: Foundation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Foundation down' })).toBeTruthy();
    rerender(<ProjectViewLayouts {...callbacks} projects={projects} layout="board" groupBy="status" />);
    expect(screen.getByLabelText('Project board')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open project: Launch' })).toBeTruthy();
  });

  it('renders milestones and violation-colored dependency lines on the timeline', () => {
    const { container } = render(<ProjectViewLayouts {...callbacks} projects={projects} layout="timeline" groupBy="none" zoom="quarter" shiftChain />);
    expect(screen.getByLabelText('Project timeline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open timeline project: Foundation' })).toBeTruthy();
    expect(container.querySelector('line[stroke="#ef4444"]')).toBeTruthy();
    expect(container.querySelector('[title="Schema"]')).toBeTruthy();
  });

  it('has no automated semantic accessibility violations on the timeline', async () => {
    const { container } = render(<ProjectViewLayouts {...callbacks} projects={projects} layout="timeline" groupBy="none" zoom="quarter" shiftChain />);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
