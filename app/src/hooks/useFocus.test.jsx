// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusApi } from '../api/client.js';
import { useFocus } from './useFocus.js';

vi.mock('../api/client.js', () => ({ focusApi: { get: vi.fn(), command: vi.fn(), history: vi.fn() } }));
const settings = { focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, chime_enabled: false };
function ready(overrides = {}) { return { revision: 0, phase: 'focus', status: 'ready', settings, session: null, deadline_at: null, remaining_ms: 1500000, completed_focus_count: 0, ...overrides }; }
function running(revision = 1) { return ready({ revision, status: 'running', deadline_at: new Date(Date.now() + 1500000).toISOString(), session: { id: 'session-1', project_id: 'real-project', project_name: 'Original project name', business: 'personal', duration_ms: 1500000, started_at: new Date().toISOString() } }); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
async function advanceClock(milliseconds) {
  // Flush React between clock ticks, as the real browser event loop does.
  for (let remaining = milliseconds; remaining > 0; remaining -= 1000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(remaining, 1000)); });
  }
}

describe('useFocus durable commands', () => {
  let server, client;
  beforeEach(() => {
    vi.clearAllMocks();
    focusApi.command.mockReset();
    focusApi.get.mockReset();
    server = ready();
    focusApi.get.mockImplementation(async () => ({ ...server, server_now: new Date(Date.now()).toISOString() }));
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  });
  afterEach(() => { client.clear(); onlineManager.setOnline(true); vi.useRealTimers(); vi.restoreAllMocks(); });
  function mount(onCompleted = vi.fn()) {
    return renderHook(() => useFocus(onCompleted), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  }
  async function loaded(result) { await waitFor(() => expect(result.current.data?.revision).toBe(server.revision)); }

  it('starts with the actual project ID, UUID and revision, then reads back before permitting another command', async () => {
    const getAfterCommand = deferred();
    const { result } = mount();
    await loaded(result);
    focusApi.command.mockImplementationOnce(async () => {
      server = running();
      focusApi.get.mockReturnValueOnce(getAfterCommand.promise);
      return { ...server, server_now: '2000-01-01T00:00:00Z' }; // receipt time must be ignored
    });
    let commandPromise;
    act(() => { commandPromise = result.current.command('start', { project_id: 'real-project' }); });
    await waitFor(() => expect(focusApi.command).toHaveBeenCalledOnce());
    const body = focusApi.command.mock.calls[0][0];
    expect(body).toMatchObject({ command: 'start', expected_revision: 0, project_id: 'real-project' });
    expect(body.operation_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.current.busy).toBe(true);
    await act(async () => { await result.current.command('skip'); });
    expect(focusApi.command).toHaveBeenCalledOnce();
    await act(async () => {
      getAfterCommand.resolve({ ...server, revision: 7, server_now: new Date().toISOString() });
      await commandPromise;
    });
    await waitFor(() => expect(result.current.data.revision).toBe(7));
    expect(result.current.remainingMs).toBeGreaterThan(1490000);
    expect(result.current.busy).toBe(false);
  });

  it('reuses the exact operation after an uncertain committed start, even after state refresh', async () => {
    const { result } = mount();
    await loaded(result);
    focusApi.command.mockImplementationOnce(async () => { server = running(); throw new TypeError('Network interrupted after commit'); });
    await act(async () => { await result.current.command('start', { project_id: 'real-project' }); });
    expect(result.current.failure.kind).toBe('uncertain');
    await waitFor(() => expect(result.current.data.status).toBe('running'));
    focusApi.command.mockResolvedValueOnce(server);
    await act(async () => { await result.current.retryCommand(); });
    expect(focusApi.command.mock.calls[1][0]).toEqual(focusApi.command.mock.calls[0][0]);
    expect(result.current.failure).toBeNull();
    expect(focusApi.get.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('refetches after 409 and waits for an explicit new command with the fresh revision', async () => {
    const { result } = mount();
    await loaded(result);
    focusApi.command.mockImplementationOnce(async () => { server = { ...running(5), status: 'paused', remaining_ms: 900000 }; throw Object.assign(new Error('Changed'), { status: 409, code: 'REVISION_CONFLICT' }); });
    await act(async () => { await result.current.command('start', { project_id: 'real-project' }); });
    expect(result.current.failure.kind).toBe('conflict');
    await waitFor(() => expect(result.current.data.revision).toBe(5));
    expect(focusApi.command).toHaveBeenCalledOnce();
    focusApi.command.mockImplementationOnce(async () => { server = running(6); return server; });
    await act(async () => { await result.current.command('resume'); });
    expect(focusApi.command.mock.calls[1][0]).toMatchObject({ command: 'resume', expected_revision: 5 });
    expect(focusApi.command.mock.calls[1][0].operation_id).not.toBe(focusApi.command.mock.calls[0][0].operation_id);
  });

  it('blocks further commands after acknowledged POST until a failed GET readback recovers', async () => {
    const { result } = mount();
    await loaded(result);
    focusApi.command.mockImplementationOnce(async () => {
      server = running();
      focusApi.get.mockRejectedValueOnce(new Error('Readback failed'));
      return server;
    });
    await act(async () => { await result.current.command('start', { project_id: 'real-project' }); });
    expect(result.current.needsReadback).toBe(true);
    await act(async () => { await result.current.command('reset'); });
    expect(focusApi.command).toHaveBeenCalledOnce();
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.needsReadback).toBe(false));
    await waitFor(() => expect(result.current.data.status).toBe('running'));
  });

  it('refreshes on window refocus without sending commands or repeatedly fetching for a burst of events', async () => {
    server = running();
    const { result } = mount();
    await loaded(result);
    const reads = focusApi.get.mock.calls.length;
    act(() => {
      for (let index = 0; index < 6; index++) window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(focusApi.get).toHaveBeenCalledTimes(reads + 1));
    expect(focusApi.command).not.toHaveBeenCalled();
  });

  it('settles an expired fourth focus once, leaves the long break ready, and chimes once despite repeated reads', async () => {
    server = { ...running(9), deadline_at: new Date(Date.now() - 10000).toISOString(), completed_focus_count: 3 };
    const onCompleted = vi.fn();
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 10, phase: 'long_break', remaining_ms: 900000, completed_focus_count: 4 });
      return server;
    });
    const { result } = mount(onCompleted);
    await waitFor(() => expect(result.current.data?.phase).toBe('long_break'));
    expect(focusApi.command).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: 'reconcile', expected_revision: 9 }));
    expect(result.current.data.status).toBe('ready');
    expect(onCompleted).toHaveBeenCalledOnce();
    await act(async () => { await result.current.refresh(); await result.current.refresh(); });
    expect(focusApi.command).toHaveBeenCalledOnce();
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it.each(['manual refresh', 'window focus', 'query refetch', 'network reconnect'])('delivers an acknowledged completion once after failed readback recovers through %s', async recovery => {
    server = { ...running(9), deadline_at: new Date(Date.now() - 10000).toISOString(), completed_focus_count: 3 };
    const onCompleted = vi.fn();
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 10, phase: 'long_break', remaining_ms: 900000, completed_focus_count: 4, settings: { ...settings, chime_enabled: true } });
      focusApi.get.mockRejectedValueOnce(new Error('Immediate readback failed'));
      return { ...server, server_now: '2000-01-01T00:00:00Z' };
    });
    const { result } = mount(onCompleted);
    await waitFor(() => expect(result.current.needsReadback).toBe(true));
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => { await result.current.command('reset'); });
    expect(focusApi.command).toHaveBeenCalledOnce();

    // A second failed read must preserve both the completion and command guard.
    focusApi.get.mockRejectedValueOnce(new Error('Still offline'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.needsReadback).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
    if (recovery === 'manual refresh') await act(async () => { await result.current.refresh(); });
    else if (recovery === 'window focus') act(() => { window.dispatchEvent(new Event('focus')); });
    else if (recovery === 'query refetch') await act(async () => { await client.refetchQueries({ queryKey: ['focus'], exact: true }); });
    else {
      act(() => { onlineManager.setOnline(false); });
      act(() => { onlineManager.setOnline(true); });
    }
    await waitFor(() => expect(result.current.needsReadback).toBe(false));
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith('session-1', expect.objectContaining({
      revision: 10, phase: 'long_break', status: 'ready', settings: { ...settings, chime_enabled: true },
    }));
    expect(Date.parse(onCompleted.mock.calls[0][1].server_now)).toBeGreaterThan(Date.parse('2000-01-01T00:00:00Z'));
    await act(async () => { await result.current.refresh(); await result.current.refresh(); });
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(focusApi.command).toHaveBeenCalledOnce();
  });

  it('accepts a scheduled polling GET after acknowledged completion readback failed, without requiring window focus', async () => {
    vi.useFakeTimers();
    server = { ...running(9), deadline_at: new Date(Date.now() - 10000).toISOString(), completed_focus_count: 3 };
    const onCompleted = vi.fn();
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 10, phase: 'long_break', remaining_ms: 900000, completed_focus_count: 4 });
      focusApi.get.mockRejectedValueOnce(new Error('Immediate readback failed'));
      return server;
    });
    const { result } = mount(onCompleted);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.needsReadback).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(result.current.needsReadback).toBe(false);
    expect(result.current.data.phase).toBe('long_break');
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith('session-1', expect.objectContaining({ revision: 10 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(focusApi.command).toHaveBeenCalledOnce();
  });

  it('cannot use a late pre-acknowledgement GET or cached state to unlock readback or deliver the completion', async () => {
    server = { ...running(9), deadline_at: new Date(Date.now() - 10000).toISOString(), completed_focus_count: 3 };
    const acknowledgement = deferred();
    const preAckRead = deferred();
    const onCompleted = vi.fn();
    focusApi.command.mockReturnValueOnce(acknowledgement.promise);
    const { result } = mount(onCompleted);
    await waitFor(() => expect(focusApi.command).toHaveBeenCalledOnce());
    focusApi.get.mockReturnValueOnce(preAckRead.promise);
    let oldFetch;
    act(() => { oldFetch = client.refetchQueries({ queryKey: ['focus'], exact: true }); });
    await waitFor(() => expect(focusApi.get).toHaveBeenCalledTimes(2));
    server = ready({ revision: 10, phase: 'long_break', remaining_ms: 900000, completed_focus_count: 4 });
    focusApi.get.mockRejectedValueOnce(new Error('Post-acknowledgement GET failed'));
    act(() => { acknowledgement.resolve(server); });
    await waitFor(() => expect(result.current.needsReadback).toBe(true));
    await act(async () => {
      preAckRead.resolve({ ...server, server_now: new Date().toISOString() });
      await oldFetch;
    });
    act(() => { client.setQueryData(['focus'], { ...server, server_now: new Date().toISOString(), clock_offset_ms: 0 }); });
    expect(result.current.needsReadback).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => { await result.current.command('reset'); });
    expect(focusApi.command).toHaveBeenCalledOnce();
    await act(async () => { await client.refetchQueries({ queryKey: ['focus'], exact: true }); });
    expect(result.current.needsReadback).toBe(false);
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith('session-1', expect.objectContaining({ revision: 10 }));
  });

  it('retains completion when an uncertain operation retry is acknowledged but its readback fails', async () => {
    server = { ...running(2), deadline_at: new Date(Date.now() - 10000).toISOString() };
    const onCompleted = vi.fn();
    focusApi.command.mockRejectedValueOnce(new TypeError('Response interrupted'));
    const { result } = mount(onCompleted);
    await waitFor(() => expect(result.current.failure?.kind).toBe('uncertain'));
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 3, phase: 'short_break', remaining_ms: 300000, completed_focus_count: 1 });
      focusApi.get.mockRejectedValueOnce(new Error('Readback failed after retry'));
      return server;
    });
    await act(async () => { await result.current.retryCommand(); });
    expect(focusApi.command.mock.calls[1][0]).toEqual(focusApi.command.mock.calls[0][0]);
    expect(result.current.needsReadback).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => { await result.current.refresh(); await result.current.refresh(); });
    expect(result.current.needsReadback).toBe(false);
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith('session-1', expect.objectContaining({ revision: 3, phase: 'short_break' }));
    expect(focusApi.command).toHaveBeenCalledTimes(2);
  });

  it('confirms an uncertain committed reconcile by replaying its receipt after ready readback', async () => {
    vi.useFakeTimers();
    server = { ...running(9), deadline_at: new Date(Date.now() - 10000).toISOString(), completed_focus_count: 3 };
    const onCompleted = vi.fn();
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 10, phase: 'long_break', remaining_ms: 900000, completed_focus_count: 4 });
      throw new TypeError('Response lost after commit');
    });
    focusApi.command.mockImplementationOnce(async () => server);
    const { result } = mount(onCompleted);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.data.phase).toBe('long_break');
    expect(result.current.uncertain).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => { await result.current.command('start'); });
    expect(focusApi.command).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(focusApi.command).toHaveBeenCalledTimes(2);
    expect(focusApi.command.mock.calls[1][0]).toEqual(focusApi.command.mock.calls[0][0]);
    expect(result.current.failure).toBeNull();
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith('session-1', expect.objectContaining({ revision: 10, phase: 'long_break' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); await result.current.refresh(); });
    expect(focusApi.command).toHaveBeenCalledTimes(2);
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it.each(['window focus', 'polling'])('confirms an uncertain completion after the immediate GET fails and %s restores ready state', async recovery => {
    vi.useFakeTimers();
    const startTime = Date.now();
    let online = false;
    server = { ...running(9), deadline_at: new Date(startTime - 10000).toISOString(), completed_focus_count: 3 };
    const initial = { ...server, server_now: new Date(startTime).toISOString() };
    focusApi.get.mockResolvedValueOnce(initial).mockImplementation(async () => {
      if (!online) throw new TypeError('Offline');
      return { ...server, server_now: new Date(Date.now()).toISOString() };
    });
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 10, phase: 'long_break', remaining_ms: 900000, completed_focus_count: 4 });
      throw new TypeError('Response lost after commit');
    }).mockImplementationOnce(async () => server);
    const onCompleted = vi.fn();
    const { result } = mount(onCompleted);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.uncertain).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
    if (recovery === 'polling') {
      // Failed preflights back off at 2/6/14 seconds; the next poll happens
      // 15 seconds after the last failed read, before the 30-second retry.
      await advanceClock(28000);
      online = true;
      await advanceClock(1500);
      expect(result.current.data.phase).toBe('long_break');
      expect(onCompleted).not.toHaveBeenCalled();
      await advanceClock(2500);
    } else {
      online = true;
      act(() => { window.dispatchEvent(new Event('focus')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    }
    expect(result.current.failure).toBeNull();
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith('session-1', expect.objectContaining({ revision: 10 }));
    expect(focusApi.command).toHaveBeenCalledTimes(2);
    expect(focusApi.command.mock.calls[1][0]).toEqual(focusApi.command.mock.calls[0][0]);
  });

  it.each([
    ['focus reset', 'focus', 'focus'],
    ['focus skip', 'focus', 'short_break'],
    ['break skip', 'short_break', 'focus'],
  ])('does not chime when an uncommitted reconcile was superseded by another tab’s %s', async (_case, phase, nextPhase) => {
    vi.useFakeTimers();
    server = { ...running(9), phase, deadline_at: new Date(Date.now() - 10000).toISOString() };
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 10, phase: nextPhase });
      throw new TypeError('Response unavailable, command not committed');
    }).mockRejectedValueOnce(Object.assign(new Error('Another tab changed the timer'), { status: 409, code: 'REVISION_CONFLICT' }));
    const onCompleted = vi.fn();
    const { result } = mount(onCompleted);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(focusApi.command).toHaveBeenCalledTimes(2);
    expect(focusApi.command.mock.calls[1][0]).toEqual(focusApi.command.mock.calls[0][0]);
    expect(result.current.failure).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(focusApi.command).toHaveBeenCalledTimes(2);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it.each([400, 409])('does not invent a completion or repeat a definitively rejected %i reconcile with ready readback', async status => {
    vi.useFakeTimers();
    server = { ...running(9), deadline_at: new Date(Date.now() - 10000).toISOString() };
    focusApi.command.mockImplementationOnce(async () => {
      server = ready({ revision: 10 });
      throw Object.assign(new Error('Rejected'), { status });
    });
    const onCompleted = vi.fn();
    mount(onCompleted);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(focusApi.command).toHaveBeenCalledOnce();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('backs off an uncertain reconcile and retains its operation ID for the next attempt', async () => {
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    server = { ...running(2), deadline_at: new Date(clock - 1000).toISOString() };
    focusApi.command.mockRejectedValueOnce(new TypeError('Offline'));
    const { result } = mount();
    await waitFor(() => expect(result.current.failure?.automatic).toBe(true));
    expect(focusApi.command).toHaveBeenCalledOnce();
    await act(async () => { await result.current.refresh(); });
    expect(focusApi.command).toHaveBeenCalledOnce();
    focusApi.command.mockImplementationOnce(async () => { server = ready({ revision: 3, phase: 'short_break', remaining_ms: 300000, completed_focus_count: 1 }); return server; });
    clock += 4000;
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.data.status).toBe('ready'));
    expect(focusApi.command.mock.calls[1][0]).toEqual(focusApi.command.mock.calls[0][0]);
  });
});
