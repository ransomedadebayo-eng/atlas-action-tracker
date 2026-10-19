import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { focusApi } from '../api/client.js';
import { focusRemainingMs, sampleFocusState } from '../utils/focusTimer.js';

export async function readFocusState({ signal } = {}) {
  const sentAt = Date.now();
  const state = await focusApi.get({ signal });
  return sampleFocusState(state, sentAt, Date.now());
}

export function useFocusHistory(projectId, cursor) {
  return useQuery({
    queryKey: ['focusHistory', projectId || '', cursor || null],
    queryFn: ({ signal }) => focusApi.history({ limit: 20, project_id: projectId, cursor }, { signal }),
    staleTime: 30000,
    retry: false,
  });
}

export function useFocus(onCompleted) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['focus'], queryFn: readFocusState, retry: false, staleTime: 0,
    refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
    refetchInterval: current => current.state.data?.status === 'running' ? 15000 : false,
    refetchIntervalInBackground: false,
  });
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const stateRef = useRef(query.data);
  stateRef.current = query.data;
  const inFlight = useRef(false);
  const readbackRequired = useRef(false);
  const outstanding = useRef(null);
  const retryClock = useRef({ attempts: 0, at: 0 });
  const completed = useRef(new Set());
  const completionCallback = useRef(onCompleted);
  completionCallback.current = onCompleted;

  const refreshState = useCallback(async () => {
    await client.cancelQueries({ queryKey: ['focus'], exact: true });
    const fresh = await client.fetchQuery({ queryKey: ['focus'], queryFn: readFocusState, staleTime: 0, retry: false });
    stateRef.current = fresh;
    readbackRequired.current = false;
    setFailure(previous => previous?.kind === 'readback' ? null : previous);
    return fresh;
  }, [client]);

  // React Query handles visibility/reconnect; also refresh on a window returning
  // focus. Deduplicate rapid focus events and let the query cancel stale reads.
  useEffect(() => {
    let lastFocus = -Infinity;
    const refresh = () => {
      if (Date.now() - lastFocus < 1000 || inFlight.current) return;
      lastFocus = Date.now();
      void refreshState().catch(() => {});
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refreshState]);

  useEffect(() => {
    setNow(Date.now());
    if (query.data?.status !== 'running') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [query.data]);

  const execute = useCallback(async (command, payload = {}, { retry = false, automatic = false } = {}) => {
    if (inFlight.current) return null;
    if (readbackRequired.current && !retry) return null;
    const current = stateRef.current;
    if (!current) return null;
    if (outstanding.current && !retry && !(automatic && outstanding.current.automatic)) return null;
    const operation = outstanding.current || {
      body: { operation_id: crypto.randomUUID(), expected_revision: current.revision, command, ...payload },
      automatic,
      expiredSession: current.session && current.status === 'running' && focusRemainingMs(current) <= 0 ? current.session.id : null,
    };
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    outstanding.current = operation;
    retryClock.current.at = Date.now() + 2000;
    try {
      if (retry || (automatic && retryClock.current.attempts)) await refreshState();
      await client.cancelQueries({ queryKey: ['focus'], exact: true });
      const acknowledged = await focusApi.command(operation.body);
      readbackRequired.current = true;
      outstanding.current = null;
      retryClock.current = { attempts: 0, at: Date.now() + 2000 };
      void client.invalidateQueries({ queryKey: ['focusHistory'] });
      // A receipt replay may contain an old revision and server_now. Never use
      // it as the current timer or permit a second command before GET readback.
      let fresh;
      try { fresh = await refreshState(); }
      catch {
        setFailure({ kind: 'readback', message: 'Your command was saved, but the timer could not refresh. Refresh before continuing.' });
        return null;
      }
      if (operation.expiredSession && acknowledged.status === 'ready' && !acknowledged.session
        && !completed.current.has(operation.expiredSession)) {
        completed.current.add(operation.expiredSession);
        completionCallback.current?.(operation.expiredSession, fresh);
      }
      return fresh;
    } catch (error) {
      const conflict = error.status === 409;
      const uncertain = !error.status || error.status >= 500;
      if (!uncertain) outstanding.current = null;
      retryClock.current = {
        attempts: retryClock.current.attempts + 1,
        at: Date.now() + Math.min(30000, 2000 * 2 ** Math.min(retryClock.current.attempts, 4)),
      };
      let fresh;
      try { fresh = await refreshState(); } catch { /* Keep the query error visible. */ }
      if (operation.automatic && fresh && fresh.status !== 'running') {
        outstanding.current = null;
        setFailure(null);
      } else {
        setFailure({
          kind: conflict ? 'conflict' : uncertain ? 'uncertain' : 'rejected',
          automatic: operation.automatic, code: error.code,
          message: conflict
            ? error.code && !['REVISION_CONFLICT', 'OPERATION_CONFLICT'].includes(error.code)
              ? `${error.message} Review the refreshed timer and choose again.`
              : 'The timer changed elsewhere. Review the refreshed timer, then choose your command again.'
            : uncertain
              ? 'The server response was interrupted. Refreshing does not repeat your command. Retry the same command to confirm its result.'
              : error.message,
        });
      }
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [client, refreshState]);

  const remainingMs = focusRemainingMs(query.data, now);
  useEffect(() => {
    if (query.data?.status !== 'running' || remainingMs > 0 || busy || query.isFetching) return;
    if (failure && !failure.automatic) return;
    if (Date.now() < retryClock.current.at) return;
    void execute('reconcile', {}, { automatic: true });
  }, [query.data, query.isFetching, remainingMs, now, busy, failure, execute]);

  const refresh = useCallback(async () => {
    try {
      const result = await refreshState();
      if (!outstanding.current) setFailure(null);
      return result;
    } catch { return null; }
  }, [refreshState]);

  return {
    ...query, remainingMs, busy, failure, command: execute, refresh,
    retryCommand: () => execute('', {}, { retry: true }),
    uncertain: failure?.kind === 'uncertain',
    needsReadback: failure?.kind === 'readback',
  };
}
