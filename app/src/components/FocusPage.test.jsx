// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FocusPage from './FocusPage.jsx';
import { useFocus, useFocusHistory } from '../hooks/useFocus.js';
import { useFocusChime } from '../hooks/useFocusChime.js';
import { useProjects } from '../hooks/useProjects.js';

vi.mock('../hooks/useFocus.js', () => ({ useFocus: vi.fn(), useFocusHistory: vi.fn() }));
vi.mock('../hooks/useFocusChime.js', () => ({ useFocusChime: vi.fn() }));
vi.mock('../hooks/useProjects.js', () => ({ useProjects: vi.fn() }));
vi.mock('../hooks/useBusinesses.js', () => ({ useBusinessContext: () => ({ BUSINESSES: { personal: { label: 'Personal' } } }) }));

const settings = { focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, chime_enabled: false };
const project = { id: 'actual-project-uuid', name: 'Ship the Atlas improvement', status: 'in_progress', business: 'personal' };
const emptyHistory = { items: [], next_cursor: null, totals: { completed_sessions: 0, focus_ms: 0 }, projects: [] };
const session = { id: 'session-1', project_id: project.id, project_name: 'Original project name', business: 'personal', duration_ms: 1500000, started_at: '2026-10-19T12:00:00Z' };
const ledger = { ...session, phase: 'focus', outcome: 'completed', focused_ms: 1500000, ended_at: '2026-10-19T12:25:00Z' };
function timer(overrides = {}) { return { revision: 0, phase: 'focus', status: 'ready', session: null, settings, remaining_ms: 1500000, completed_focus_count: 0, ...overrides }; }

describe('FocusPage', () => {
  let controller, historyQuery, projectsQuery, chime;
  beforeEach(() => {
    vi.clearAllMocks();
    controller = { data: timer(), remainingMs: 1500000, command: vi.fn(), refresh: vi.fn(), retryCommand: vi.fn(), failure: null, busy: false, isLoading: false, isError: false, isFetching: false, uncertain: false, needsReadback: false };
    historyQuery = { data: emptyHistory, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() };
    projectsQuery = { data: [project], isLoading: false, isError: false, refetch: vi.fn() };
    chime = { unlock: vi.fn(), play: vi.fn(), unlocked: false, error: '' };
    useFocus.mockImplementation(() => controller);
    useFocusHistory.mockImplementation(() => historyQuery);
    useProjects.mockImplementation(() => projectsQuery);
    useFocusChime.mockReturnValue(chime);
  });

  it('starts only with a selected real eligible project ID and searches the server project list', async () => {
    projectsQuery.data = [project, ...['completed', 'canceled', 'archived'].map(status => ({ id: status, name: status, status }))];
    render(<FocusPage />);
    const start = screen.getByRole('button', { name: 'Start focus' });
    expect(start.disabled).toBe(true);
    const picker = screen.getByRole('combobox', { name: 'Focus project' });
    expect([...picker.options].map(option => option.value)).toEqual(['', project.id]);
    fireEvent.change(picker, { target: { value: project.id } });
    fireEvent.click(start);
    expect(controller.command).toHaveBeenCalledExactlyOnceWith('start', { project_id: project.id });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search focus projects' }), { target: { value: 'Atlas' } });
    await waitFor(() => expect(useProjects).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Atlas', status: 'backlog,planned,in_progress,paused' })));
  });

  it('shows the immutable project snapshot and active countdown while phase selection is locked', () => {
    controller.data = timer({ status: 'running', session });
    controller.remainingMs = 900000;
    const view = render(<FocusPage />);
    expect(screen.getByText('Original project name')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('15:00');
    expect(screen.queryByRole('combobox', { name: 'Focus project' })).toBeNull();
    for (const button of within(screen.getByRole('group', { name: 'Timer phase' })).getAllByRole('button')) expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(controller.command).toHaveBeenLastCalledWith('pause', {});
    controller.data = { ...controller.data, status: 'paused' };
    view.rerender(<FocusPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(controller.command).toHaveBeenLastCalledWith('resume', {});
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(controller.command).toHaveBeenLastCalledWith('reset', {});
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(controller.command).toHaveBeenLastCalledWith('skip', {});
  });

  it('sends ready-only phase choices and starts a break without inventing a project ID', () => {
    const view = render(<FocusPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Long break', exact: true }));
    expect(controller.command).toHaveBeenLastCalledWith('select_phase', { phase: 'long_break' });
    controller.data = timer({ phase: 'long_break', completed_focus_count: 4, remaining_ms: 900000 });
    controller.remainingMs = 900000;
    view.rerender(<FocusPage />);
    expect(screen.getByText('4 of 4 focus sessions · then a long break')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start long break' }));
    expect(controller.command).toHaveBeenLastCalledWith('start', {});
  });

  it('does not invent completed sessions when a long break was manually selected', () => {
    controller.data = timer({ phase: 'long_break', completed_focus_count: 0 });
    render(<FocusPage />);
    expect(screen.getByText('0 of 4 focus sessions · then a long break')).toBeTruthy();
  });

  it('saves complete settings without locally rebasing an active countdown', async () => {
    controller.data = timer({ status: 'running', session });
    controller.remainingMs = 630000;
    controller.command.mockResolvedValue({ ...controller.data, settings: { ...settings, focus_minutes: 40 } });
    render(<FocusPage />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Focus minutes' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rhythm' }));
    await waitFor(() => expect(controller.command).toHaveBeenCalledWith('settings', { settings: { ...settings, focus_minutes: 40 } }));
    expect(screen.getByRole('timer').textContent).toBe('10:30');
    expect(screen.getByRole('button', { name: 'Save rhythm' }).disabled).toBe(true);
  });

  it('keeps a settings draft available when the command only settled an expired timer', async () => {
    controller.data = timer({ status: 'running', session });
    controller.command.mockResolvedValue(timer({ phase: 'short_break', revision: 1 }));
    render(<FocusPage />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Focus minutes' }), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rhythm' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The previous session finished before this change. Review the timer, then save your rhythm again.');
    expect(screen.getByRole('spinbutton', { name: 'Focus minutes' }).value).toBe('40');
    expect(screen.getByRole('button', { name: 'Save rhythm' }).disabled).toBe(false);
  });

  it('requires a gesture to enable sound and does not play from passive rendering', () => {
    controller.data = timer({ settings: { ...settings, chime_enabled: true } });
    render(<FocusPage />);
    expect(chime.unlock).not.toHaveBeenCalled();
    expect(chime.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Enable sound on this device' }));
    expect(chime.unlock).toHaveBeenCalledOnce();
  });

  it('uses server totals across stable history pages and resets the cursor when filtering an archived project', async () => {
    const summary = [{ project_id: 'archived-id', project_name: 'Archived project name', completed_sessions: 30, focus_ms: 45000000 }];
    const first = { items: [ledger], next_cursor: 'stable:timestamp+session=', totals: { completed_sessions: 30, focus_ms: 45000000 }, projects: summary };
    const second = { ...first, items: [{ ...ledger, id: 'older-session', project_name: 'Older project snapshot' }], next_cursor: null };
    useFocusHistory.mockImplementation((projectId, cursor) => ({ ...historyQuery, data: projectId ? emptyHistory : cursor ? second : first }));
    render(<FocusPage />);
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('12h 30m')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Older sessions' }));
    expect(useFocusHistory).toHaveBeenLastCalledWith('', 'stable:timestamp+session=');
    expect(screen.getByText('Older project snapshot')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Newer sessions' }));
    expect(useFocusHistory).toHaveBeenLastCalledWith('', null);
    fireEvent.click(screen.getByRole('button', { name: 'Older sessions' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter focus history by project' }), { target: { value: 'archived-id' } });
    expect(useFocusHistory).toHaveBeenLastCalledWith('archived-id', null);
    expect(screen.getByText('Page 1')).toBeTruthy();
    expect(screen.getByText(/No sessions yet for this project/)).toBeTruthy();
  });

  it.each(['uncertain', 'readback'])('blocks new commands during %s recovery', kind => {
    controller.failure = { kind, message: 'Recover current timer first.' };
    controller.uncertain = kind === 'uncertain';
    controller.needsReadback = kind === 'readback';
    render(<FocusPage />);
    expect(screen.getByRole('alert').textContent).toContain('Recover current timer first.');
    expect(screen.getByRole('button', { name: 'Reset' }).disabled).toBe(true);
    if (kind === 'uncertain') {
      fireEvent.click(screen.getByRole('button', { name: 'Retry previous command' }));
      expect(controller.retryCommand).toHaveBeenCalledOnce();
    }
  });

  it('explains missing server storage without offering a fake browser timer or empty history', () => {
    controller.data = undefined;
    controller.isError = true;
    controller.error = { code: 'FOCUS_STORAGE_UNAVAILABLE', message: 'Schema missing' };
    render(<FocusPage />);
    expect(screen.getByRole('alert').textContent).toContain('Focus storage is not available on the server yet');
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByText(/No sessions yet/)).toBeNull();
    expect(controller.command).not.toHaveBeenCalled();
  });

  it('distinguishes history and project read errors from successful empty results', () => {
    projectsQuery = { ...projectsQuery, data: undefined, isError: true };
    historyQuery = { ...historyQuery, data: undefined, isError: true, error: new Error('History unavailable') };
    render(<FocusPage />);
    expect(screen.getAllByRole('alert').map(item => item.textContent).join(' ')).toContain('History unavailable');
    expect(screen.getByText('Projects could not be loaded.')).toBeTruthy();
    expect(screen.queryByText(/No active projects yet/)).toBeNull();
    expect(screen.queryByText(/No sessions yet/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Start focus' }).disabled).toBe(true);
  });

  it('has accessible loading, empty and control semantics', async () => {
    controller.data = undefined;
    controller.isLoading = true;
    const view = render(<FocusPage />);
    expect(screen.getByRole('status').textContent).toBe('Loading your server timer...');
    controller.data = timer();
    controller.isLoading = false;
    projectsQuery.data = [];
    view.rerender(<FocusPage />);
    expect(screen.getByText(/No active projects yet/)).toBeTruthy();
    expect(screen.getByText(/No sessions yet/)).toBeTruthy();
    const findings = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } });
    expect(findings.violations).toEqual([]);
  });
});
