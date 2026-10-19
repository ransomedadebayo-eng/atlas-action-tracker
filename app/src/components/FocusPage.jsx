import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coffee, History, Pause, Play, RotateCcw, Search, SkipForward, Timer, Volume2 } from 'lucide-react';
import { useFocus, useFocusHistory } from '../hooks/useFocus.js';
import { useFocusChime } from '../hooks/useFocusChime.js';
import { useProjects } from '../hooks/useProjects.js';
import { useBusinessContext } from '../hooks/useBusinesses.js';
import { eligibleFocusProject, FOCUS_PHASES, formatCountdown, formatFocusTime, parseFocusSettings } from '../utils/focusTimer.js';

function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()); }
function when(value) { return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''; }
function ErrorNotice({ children }) { return <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{children}</div>; }

export default function FocusPage() {
  const chime = useFocusChime();
  const [completionNotice, setCompletionNotice] = useState('');
  const onCompleted = useCallback((_id, state) => {
    setCompletionNotice('Session complete. Your next timer is ready when you are.');
    if (state.settings.chime_enabled) chime.play();
  }, [chime.play]);
  const focus = useFocus(onCompleted);
  const state = focus.data;
  const { BUSINESSES = {} } = useBusinessContext();
  const businessName = id => BUSINESSES[id]?.label || label(id);
  const [search, setSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  useEffect(() => { const timer = setTimeout(() => setProjectSearch(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const projectsQuery = useProjects({ status: 'backlog,planned,in_progress,paused', completed_window: 'none', search: projectSearch || undefined, limit: 200, sort_by: 'name', sort_dir: 'asc' });
  const projects = (projectsQuery.data || []).filter(eligibleFocusProject);
  const [selectedProject, setSelectedProject] = useState(null);
  const previousSession = useRef(null);
  useEffect(() => {
    if (previousSession.current && !state?.session) setSelectedProject(null);
    previousSession.current = state?.session?.id || null;
  }, [state?.session]);

  const [settingsDraft, setSettingsDraft] = useState(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const settingsKey = JSON.stringify(state?.settings);
  useEffect(() => {
    if (state?.settings && !settingsDirty) setSettingsDraft({ ...state.settings });
  }, [settingsKey, settingsDirty]);

  const [historyProject, setHistoryProject] = useState('');
  const [cursor, setCursor] = useState(null);
  const [cursorStack, setCursorStack] = useState([]);
  const [historyCatalog, setHistoryCatalog] = useState([]);
  const history = useFocusHistory(historyProject, cursor);
  useEffect(() => {
    if (!historyProject && history.data?.projects) setHistoryCatalog(history.data.projects);
  }, [historyProject, history.data]);
  const historyOptions = useMemo(() => {
    const options = new Map(historyCatalog.map(item => [item.project_id, item.project_name]));
    for (const project of projects) options.set(project.id, project.name);
    return [...options].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  }, [historyCatalog, projectsQuery.data]);

  async function command(name, payload = {}) {
    setCompletionNotice('');
    if (name === 'start' || name === 'resume') {
      if (state.settings.chime_enabled) void chime.unlock();
    }
    return focus.command(name, payload);
  }
  async function saveSettings(event) {
    event.preventDefault();
    setSettingsError('');
    try {
      const settings = parseFocusSettings(settingsDraft);
      const saved = await command('settings', { settings });
      if (saved) {
        if (Object.keys(settings).every(key => saved.settings[key] === settings[key])) {
          setSettingsDirty(false);
          setSettingsDraft({ ...saved.settings });
        } else setSettingsError('The previous session finished before this change. Review the timer, then save your rhythm again.');
      }
    } catch (error) { setSettingsError(error.message); }
  }

  if (!state) {
    return <div className="mx-auto max-w-6xl space-y-5">
      <h1 className="text-2xl font-semibold text-text-primary">Focus</h1>
      {focus.isLoading ? <p role="status" className="card p-8 text-text-secondary">Loading your server timer...</p> : <ErrorNotice>
        <p className="font-semibold">Focus is unavailable</p>
        <p className="mt-2">{focus.error?.code === 'FOCUS_STORAGE_UNAVAILABLE'
          ? 'Focus storage is not available on the server yet. The timer and session history are unavailable until it is configured. Nothing is saved only in this browser.'
          : focus.error?.message || 'The server timer could not be loaded.'}</p>
        <button type="button" className="btn-secondary mt-4 min-h-11" disabled={focus.isFetching} onClick={focus.refresh}>Try again</button>
      </ErrorNotice>}
    </div>;
  }

  const phase = FOCUS_PHASES.find(item => item.id === state.phase);
  const active = state.status !== 'ready';
  const disabled = focus.busy || focus.uncertain || focus.isError || focus.needsReadback;
  const duration = state.session?.duration_ms || state.remaining_ms;
  const progress = duration ? Math.max(0, Math.min(100, (1 - focus.remainingMs / duration) * 100)) : 0;
  const cycle = state.completed_focus_count % 4 || (state.phase === 'long_break' && state.completed_focus_count > 0 ? 4 : 0);
  const selectedOptions = selectedProject && !projects.some(project => project.id === selectedProject.id) ? [selectedProject, ...projects] : projects;

  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="label mb-1">Project focus</p><h1 className="text-2xl font-semibold text-text-primary">Make room for one thing.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">Choose an Atlas project, work a focused session, then take a real break.</p></div>
      <button type="button" className="btn-ghost min-h-11" disabled={focus.busy || focus.isFetching} onClick={focus.refresh}>Refresh timer</button>
    </header>
    {focus.isError && <ErrorNotice><p>{focus.error?.code === 'FOCUS_STORAGE_UNAVAILABLE' ? 'Focus storage is unavailable. Timer controls are paused until the server is ready.' : 'The timer could not sync. This is the last known timer; refresh before continuing.'}</p></ErrorNotice>}
    {focus.failure && <ErrorNotice><p>{focus.failure.message}</p>{focus.uncertain && <button type="button" className="btn-secondary mt-3 min-h-11" disabled={focus.busy} onClick={focus.retryCommand}>Retry previous command</button>}{focus.failure.automatic && <p className="mt-2">The expired session will retry with a delay.</p>}</ErrorNotice>}
    <p role="status" aria-live="polite" className={completionNotice ? 'text-sm text-success' : 'sr-only'}>{completionNotice}</p>

    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
      <section className="card min-w-0 overflow-hidden" aria-label="Project timer">
        <div className="flex gap-1 border-b border-border p-3" role="group" aria-label="Timer phase">
          {FOCUS_PHASES.map(item => <button key={item.id} type="button" aria-pressed={item.id === state.phase} disabled={active || disabled} className={`min-h-11 min-w-0 flex-1 rounded-lg px-2 text-xs font-semibold sm:text-sm ${item.id === state.phase ? 'bg-accent-muted text-accent' : 'text-text-secondary hover:bg-bg-elevated'} disabled:cursor-default disabled:opacity-60`} onClick={() => command('select_phase', { phase: item.id })}>{item.label}</button>)}
        </div>
        <div className="space-y-6 p-5 sm:p-8">
          <div className="text-center">
            <p className="inline-flex items-center gap-2 text-sm text-text-secondary">{state.phase === 'focus' ? <Timer className="h-4 w-4 text-accent" /> : <Coffee className="h-4 w-4 text-accent" />}{phase.label} · {label(state.status)}</p>
            <div role="timer" aria-label="Time remaining" aria-live="off" className="my-5 font-mono text-6xl font-medium tabular-nums tracking-tight text-text-primary sm:text-8xl">{formatCountdown(focus.remainingMs)}</div>
            <div role="progressbar" aria-label="Session elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="h-1.5 overflow-hidden rounded-full bg-bg-elevated"><div className="h-full bg-accent motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>
            {state.status === 'running' && focus.remainingMs === 0 && <p className="mt-3 text-sm text-text-secondary">Finishing on the server...</p>}
          </div>

          {active ? <div className="rounded-xl border border-accent/20 bg-accent-muted p-4">
            <p className="label mb-1">Session project</p><p className="break-words font-semibold text-text-primary">{state.session?.project_name || 'Break'}</p>
            {state.session?.business && <p className="mt-1 text-xs text-text-secondary">{businessName(state.session.business)}</p>}
            <p className="mt-2 text-xs text-text-secondary">Project context is locked until this session ends, is reset, or is skipped.</p>
          </div> : <div className="space-y-3">
            <label className="block"><span className="label mb-2 block">{state.phase === 'focus' ? 'Project for this session' : 'Project for your next focus session'}</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-text-muted" /><input aria-label="Search focus projects" type="search" className="input-field min-h-11 w-full pl-9" placeholder="Search active Atlas projects..." disabled={disabled} value={search} onChange={event => setSearch(event.target.value)} /></div></label>
            {projectsQuery.isLoading ? <p role="status" className="text-sm text-text-secondary">Loading projects...</p> : projectsQuery.isError ? <ErrorNotice><p>Projects could not be loaded.</p><button type="button" className="btn-ghost mt-2 min-h-11" onClick={() => projectsQuery.refetch()}>Retry projects</button></ErrorNotice> : <>
              <select aria-label="Focus project" className="input-field min-h-11 w-full" value={selectedProject?.id || ''} disabled={disabled} onChange={event => setSelectedProject(selectedOptions.find(project => project.id === event.target.value) || null)}><option value="">Choose a project</option>{selectedOptions.map(project => <option key={project.id} value={project.id}>{project.name}{project.business ? ` · ${businessName(project.business)}` : ''}</option>)}</select>
              {projects.length === 0 && <p className="text-sm text-text-secondary">{projectSearch ? 'No active projects match your search.' : 'No active projects yet. Create a project in Projects to begin.'}</p>}
            </>}
          </div>}

          <div className="flex flex-wrap justify-center gap-2">
            {state.status === 'running' ? <button type="button" className="btn-primary flex min-h-12 min-w-[140px] items-center justify-center gap-2" disabled={disabled} onClick={() => command('pause')}><Pause className="h-4 w-4" />Pause</button>
              : state.status === 'paused' ? <button type="button" className="btn-primary flex min-h-12 min-w-[140px] items-center justify-center gap-2" disabled={disabled} onClick={() => command('resume')}><Play className="h-4 w-4" />Resume</button>
                : <button type="button" className="btn-primary flex min-h-12 min-w-[140px] items-center justify-center gap-2" disabled={disabled || (state.phase === 'focus' && (!selectedProject || projectsQuery.isError || projectsQuery.isLoading))} onClick={() => command('start', state.phase === 'focus' ? { project_id: selectedProject.id } : {})}><Play className="h-4 w-4" />Start {phase.label.toLowerCase()}</button>}
            <button type="button" className="btn-secondary flex min-h-12 items-center justify-center gap-2" disabled={disabled} onClick={() => command('reset')}><RotateCcw className="h-4 w-4" />Reset</button>
            <button type="button" className="btn-secondary flex min-h-12 items-center justify-center gap-2" disabled={disabled} onClick={() => command('skip')}><SkipForward className="h-4 w-4" />Skip</button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-text-secondary" aria-label="Four session cycle"><span className="flex gap-1.5" aria-hidden="true">{[1, 2, 3, 4].map(value => <span key={value} className={`h-2.5 w-2.5 rounded-full ${value <= cycle ? 'bg-accent' : 'bg-bg-elevated'}`} />)}</span><span>{cycle} of 4 focus sessions · then a long break</span></div>
        </div>
      </section>

      <section className="card p-5 sm:p-6" aria-labelledby="focus-settings-heading">
        <h2 id="focus-settings-heading" className="font-semibold text-text-primary">Your rhythm</h2><p className="mt-2 text-sm leading-6 text-text-secondary">Whole minutes. Changes apply to the next fresh timer; an active session keeps its duration.</p>
        {settingsDraft && <form className="mt-5 space-y-4" onSubmit={saveSettings}><fieldset disabled={disabled} className="space-y-4">
          {FOCUS_PHASES.map(item => <label key={item.id} className="flex items-center justify-between gap-3 text-sm text-text-secondary"><span>{item.label} minutes</span><input type="number" required min={item.min} max={item.max} step={1} aria-label={`${item.label} minutes`} className="input-field min-h-11 w-24 text-right" value={settingsDraft[item.setting]} onChange={event => { setSettingsDirty(true); setSettingsDraft(current => ({ ...current, [item.setting]: event.target.value })); }} /></label>)}
          <label className="flex min-h-11 items-center gap-3 text-sm text-text-secondary"><input type="checkbox" className="h-5 w-5" checked={settingsDraft.chime_enabled} onChange={event => { setSettingsDirty(true); setSettingsDraft(current => ({ ...current, chime_enabled: event.target.checked })); if (event.target.checked) void chime.unlock(); }} />Completion chime</label>
          {settingsError && <p role="alert" className="text-sm text-danger">{settingsError}</p>}
          <button type="submit" className="btn-secondary min-h-11 w-full" disabled={!settingsDirty}>Save rhythm</button>
        </fieldset></form>}
        {state.settings.chime_enabled && !chime.unlocked && <button type="button" className="btn-ghost mt-3 flex min-h-11 w-full items-center justify-center gap-2" onClick={chime.unlock}><Volume2 className="h-4 w-4" />Enable sound on this device</button>}
        {chime.error && <p role="status" className="mt-2 text-xs text-text-secondary">{chime.error}</p>}
      </section>
    </div>

    <section className="space-y-4" aria-labelledby="focus-history-heading">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="label mb-1">Sessions, kept in Atlas</p><h2 id="focus-history-heading" className="flex items-center gap-2 text-xl font-semibold text-text-primary"><History className="h-5 w-5 text-accent" />Focus history</h2></div><label className="min-w-0 max-w-full"><span className="label mb-1 block">Project history</span><select aria-label="Filter focus history by project" className="input-field min-h-11 max-w-full" value={historyProject} onChange={event => { setHistoryProject(event.target.value); setCursor(null); setCursorStack([]); }}><option value="">All projects</option>{historyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      {history.isLoading ? <p role="status" className="card p-6 text-text-secondary">Loading focus history...</p> : history.isError ? <ErrorNotice><p>{history.error?.message || 'Focus history could not be loaded.'}</p><button type="button" className="btn-ghost mt-2 min-h-11" onClick={() => history.refetch()}>Retry history</button></ErrorNotice> : history.data && <>
        <div className="grid gap-3 sm:grid-cols-2"><div className="card p-4"><p className="label">Completed focus sessions</p><p className="mt-2 text-2xl font-semibold text-text-primary">{history.data.totals.completed_sessions}</p></div><div className="card p-4"><p className="label">Total focused time</p><p className="mt-2 text-2xl font-semibold text-text-primary">{formatFocusTime(history.data.totals.focus_ms)}</p></div></div>
        {history.data.projects?.length > 0 && <div className="card divide-y divide-border px-4" aria-label="Project focus totals">{history.data.projects.map(project => <div key={project.project_id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><p className="min-w-0 break-words font-medium text-text-primary">{project.project_name}</p><p className="text-text-secondary">{project.completed_sessions} completed · {formatFocusTime(project.focus_ms)}</p></div>)}</div>}
        {history.data.items.length ? <ol className="space-y-2" aria-label="Focus sessions">{history.data.items.map(session => <li key={session.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="break-words font-semibold text-text-primary">{session.project_name || 'Break'}</p><p className="mt-1 text-xs text-text-secondary">{label(session.phase)} · {label(session.outcome)}{session.business ? ` · ${businessName(session.business)}` : ''}</p><p className="mt-1 text-xs text-text-muted">{when(session.ended_at)}</p></div><p className="shrink-0 text-sm text-text-secondary">{formatFocusTime(session.focused_ms)} active</p></li>)}</ol> : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-secondary">No sessions yet{historyProject ? ' for this project' : ''}. Completed focus sessions will count toward your totals.</p>}
      </>}
      <nav className="flex items-center justify-between gap-3" aria-label="Focus history pages"><button type="button" className="btn-secondary min-h-11" disabled={cursorStack.length === 0 || history.isFetching} onClick={() => { setCursor(cursorStack.at(-1)); setCursorStack(current => current.slice(0, -1)); }}>Newer sessions</button><span className="text-xs text-text-muted">Page {cursorStack.length + 1}</span><button type="button" className="btn-secondary min-h-11" disabled={!history.data?.next_cursor || history.isFetching || history.isError} onClick={() => { setCursorStack(current => [...current, cursor]); setCursor(history.data.next_cursor); }}>Older sessions</button></nav>
    </section>
  </div>;
}
