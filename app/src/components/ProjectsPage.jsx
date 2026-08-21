import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive, ArchiveRestore, ArrowLeft, CalendarDays, CheckCircle2,
  CircleDot, Columns3, Flag, FolderKanban, GanttChart, GitBranch, HeartPulse, LayoutList, Link2,
  ListChecks, Plus, Save, Star, Unlink, X,
} from 'lucide-react';
import { useActions } from '../hooks/useActions.js';
import { useMembers } from '../hooks/useMembers.js';
import { useBusinessContext } from '../hooks/useBusinesses.js';
import MemberSelector from './MemberSelector.jsx';
import { useEstimateSettings } from '../hooks/useEstimateSettings.js';
import {
  useArchiveProject, useArchiveProjectMilestone, useAssignProjectAction,
  useCreateProject, useCreateProjectDependency, useCreateProjectMilestone,
  usePostProjectUpdate, useProject, useProjects, useRemoveProjectAction,
  useResolveProjectDependency, useRestoreProject, useUpdateProject, useReorderProject, useMoveProjectTimeline,
} from '../hooks/useProjects.js';
import { useArchiveView, useCreateView, useUpdateView, useViews } from '../hooks/useViews.js';
import { useInitiatives } from '../hooks/useInitiatives.js';
import { useInstantiateTemplate, useTemplates } from '../hooks/useTemplates.js';
import ProjectViewLayouts from './ProjectViewLayouts.jsx';
import DiscussionThread from './LazyDiscussionThread.jsx';
import { addISODate } from '../utils/dateUtils.js';

const PROJECT_STATUSES = [
  ['backlog', 'Backlog'], ['planned', 'Planned'], ['in_progress', 'In progress'],
  ['paused', 'Paused'], ['completed', 'Completed'], ['canceled', 'Canceled'], ['archived', 'Archived'],
];
const HEALTH = [
  ['no_update', 'No update'], ['on_track', 'On track'], ['at_risk', 'At risk'], ['off_track', 'Off track'],
];
const UPDATE_HEALTH = HEALTH.filter(([id]) => id !== 'no_update');
const PRIORITIES = [['', 'No priority'], ['p0', 'P0 Urgent'], ['p1', 'P1 High'], ['p2', 'P2 Medium'], ['p3', 'P3 Low']];

function labelFor(options, value) {
  return options.find(([id]) => id === value)?.[1] || String(value || 'None').replace(/_/g, ' ');
}

function healthClasses(health) {
  if (health === 'on_track') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
  if (health === 'at_risk') return 'border-amber-500/30 bg-amber-500/10 text-amber-400';
  if (health === 'off_track') return 'border-red-500/30 bg-red-500/10 text-red-400';
  return 'border-border bg-bg-elevated text-text-muted';
}

function formatDate(value) {
  if (!value) return 'No date';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

function formatTimestamp(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function ProjectProgress({ progress, compact = false }) {
  const value = Number(progress?.progress_percent || 0);
  return (
    <div className={compact ? 'min-w-[120px]' : ''} aria-label={`${value}% project progress`}>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-text-muted">
        <span>{progress?.completed_issues || 0}/{progress?.total_issues || 0} actions</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function ProjectForm({ selectedBusiness, members, onCancel, onCreated }) {
  const { BUSINESS_LIST } = useBusinessContext();
  const mutation = useCreateProject();
  const [form, setForm] = useState({
    name: '', summary: '', business: selectedBusiness || '', status: 'planned', priority: '',
    lead_id: 'ransomed', members: ['ransomed'], start_date: '', target_date: '', update_frequency: 'weekly',
  });
  const [error, setError] = useState('');
  const [templateId, setTemplateId] = useState('');
  const { data: templates = [] } = useTemplates({ template_type: 'project', business: form.business || undefined });
  const instantiate = useInstantiateTemplate();

  useEffect(() => {
    if (templateId || templates.length === 0) return;
    const selected = templates.find(template => template.is_default && template.scope === 'business' && template.business === form.business)
      || templates.find(template => template.is_default && template.scope === 'workspace');
    if (selected) applyTemplate(selected);
  }, [templates, form.business, templateId]);

  function applyTemplate(template) {
    setTemplateId(template?.id || '');
    if (!template) return;
    const blueprint = template.blueprint || {};
    setForm(current => ({
      ...current, name: blueprint.name || current.name, summary: blueprint.summary || '',
      business: blueprint.business || current.business, status: blueprint.status || 'planned',
      priority: blueprint.priority || '', lead_id: blueprint.lead_id || 'ransomed',
      members: Array.isArray(blueprint.members) ? blueprint.members : ['ransomed'],
      start_date: blueprint.start_date || '', target_date: blueprint.target_date || '',
      update_frequency: blueprint.update_frequency || 'weekly',
    }));
  }

  function patch(key, value) {
    setForm(current => ({ ...current, [key]: value }));
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) return setError('Project name is required.');
    try {
      const payload = {
        ...form,
        priority: form.priority || null,
        business: form.business || null,
        start_date: form.start_date || null,
        target_date: form.target_date || null,
      };
      if (templateId) {
        const result = await instantiate.mutateAsync({ id: templateId, title_override: form.name, business: form.business || null, form_values: {}, overrides: payload });
        onCreated({ id: result.result_entity_id });
      } else {
        const project = await mutation.mutateAsync(payload);
        onCreated(project);
      }
    } catch (mutationError) {
      setError(mutationError.message || 'Unable to create the project.');
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-4 sm:p-5" aria-label="Create project">
      <div className="flex items-center justify-between gap-3">
        <div><p className="label">New project</p><h2 className="mt-1 text-lg font-semibold text-text-primary">Define the outcome</h2></div>
        <button type="button" className="btn-ghost min-h-11" onClick={onCancel} aria-label="Cancel project creation"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {templates.length > 0 && <label className="md:col-span-2"><span className="label mb-1 block">Project template</span><select aria-label="Project template" className="input-field min-h-11 w-full" value={templateId} onChange={event => applyTemplate(templates.find(template => template.id === event.target.value) || null)}><option value="">No template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.is_default ? 'Default · ' : ''}{template.name}</option>)}</select></label>}
        <label className="md:col-span-2"><span className="label mb-1 block">Name</span><input autoFocus className="input-field min-h-11 w-full" value={form.name} onChange={event => patch('name', event.target.value)} /></label>
        <label className="md:col-span-2"><span className="label mb-1 block">Summary</span><textarea className="input-field min-h-24 w-full" value={form.summary} onChange={event => patch('summary', event.target.value)} placeholder="What outcome will this project produce?" /></label>
        <label><span className="label mb-1 block">Business</span><select className="input-field min-h-11 w-full" value={form.business} onChange={event => patch('business', event.target.value)}><option value="">No business lane</option>{BUSINESS_LIST.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span className="label mb-1 block">Lead</span><select className="input-field min-h-11 w-full" value={form.lead_id} onChange={event => patch('lead_id', event.target.value)}>{members.map(member => <option key={member.id} value={member.id}>{member.name || member.id}</option>)}</select></label>
        <label><span className="label mb-1 block">Status</span><select className="input-field min-h-11 w-full" value={form.status} onChange={event => patch('status', event.target.value)}>{PROJECT_STATUSES.filter(([id]) => id !== 'archived').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label><span className="label mb-1 block">Priority</span><select className="input-field min-h-11 w-full" value={form.priority} onChange={event => patch('priority', event.target.value)}>{PRIORITIES.map(([id, label]) => <option key={id || 'none'} value={id}>{label}</option>)}</select></label>
        <label><span className="label mb-1 block">Start date</span><input type="date" className="input-field min-h-11 w-full" value={form.start_date} onChange={event => patch('start_date', event.target.value)} /></label>
        <label><span className="label mb-1 block">Target date</span><input type="date" className="input-field min-h-11 w-full" value={form.target_date} onChange={event => patch('target_date', event.target.value)} /></label>
        <label><span className="label mb-1 block">Update cadence</span><select className="input-field min-h-11 w-full" value={form.update_frequency} onChange={event => patch('update_frequency', event.target.value)}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option><option value="never">No reminders</option></select></label>
        <div className="md:col-span-2"><span className="label mb-1 block">Project members</span><MemberSelector members={members} selectedIds={form.members} onChange={value => patch('members', value)} placeholder="Add project members…" /></div>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary min-h-11" onClick={onCancel}>Cancel</button><button type="submit" className="btn-primary min-h-11" disabled={mutation.isPending}>{mutation.isPending ? 'Creating…' : 'Create project'}</button></div>
    </form>
  );
}

function ProjectPortfolio({ selectedBusiness, searchQuery, onOpenProject }) {
  const { data: members = [] } = useMembers();
  const [creating, setCreating] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSave, setShowSave] = useState(false);
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [selectedViewId, setSelectedViewId] = useState(initialParams.get('project_view') || '');
  const [config, setConfig] = useState({
    layout: initialParams.get('layout') || 'list', group_by: initialParams.get('group') || 'status',
    sort_by: initialParams.get('order') || 'priority', sort_dir: initialParams.get('dir') || 'asc',
    zoom: initialParams.get('zoom') || 'quarter', completed_window: initialParams.get('completed') || 'month',
    status: '', health: '', lead_id: '', initiative: '', dependency: '', shift_chain: true,
  });
  const { data: savedViews = [] } = useViews({ entity_type: 'project', context_project_id: '__null__' });
  const { data: initiatives = [] } = useInitiatives({ limit: 200, sort_by: 'name', sort_dir: 'asc' });
  const createView = useCreateView();
  const updateView = useUpdateView();
  const archiveView = useArchiveView();
  const updateProject = useUpdateProject();
  const reorderProject = useReorderProject();
  const moveTimeline = useMoveProjectTimeline();
  const selectedView = savedViews.find(view => view.id === selectedViewId) || null;

  useEffect(() => {
    if (!selectedView) return;
    const filters = selectedView.filters && typeof selectedView.filters === 'object' ? selectedView.filters : {};
    const display = selectedView.display_options && typeof selectedView.display_options === 'object' ? selectedView.display_options : {};
    setConfig(current => ({
      ...current, ...filters, layout: selectedView.layout || 'list', group_by: selectedView.group_by || 'none',
      sort_by: selectedView.sort_by || 'priority', sort_dir: selectedView.sort_dir || 'asc',
      zoom: display.zoom || 'quarter', completed_window: display.completed_window || 'month',
    }));
  }, [selectedView?.id, selectedView?.revision]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const values = { project_view: selectedViewId, layout: config.layout, group: config.group_by, order: config.sort_by, dir: config.sort_dir, zoom: config.zoom, completed: config.completed_window };
    for (const [key, value] of Object.entries(values)) value ? params.set(key, value) : params.delete(key);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
  }, [selectedViewId, config.layout, config.group_by, config.sort_by, config.sort_dir, config.zoom, config.completed_window]);

  const { data: projects = [], isLoading, isError, error } = useProjects({
    business: selectedBusiness || undefined,
    search: searchQuery || undefined,
    status: config.status || undefined, health: config.health || undefined, lead_id: config.lead_id || undefined,
    dependency: config.dependency || undefined, initiative: config.initiative || undefined, completed_window: config.completed_window,
    sort_by: config.sort_by, sort_dir: config.sort_dir,
    limit: 200,
  });

  function patchConfig(key, value) { setSelectedViewId(''); setConfig(current => ({ ...current, [key]: value })); }

  function viewPayload() {
    return {
      entity_type: 'project', context_project_id: null,
      filters: { status: config.status || undefined, health: config.health || undefined, lead_id: config.lead_id || undefined, initiative: config.initiative || undefined, dependency: config.dependency || undefined },
      layout: config.layout, group_by: config.group_by === 'none' ? null : config.group_by,
      sort_by: config.sort_by, sort_dir: config.sort_dir,
      display_options: { zoom: config.zoom, completed_window: config.completed_window },
    };
  }

  async function saveNewView(event) {
    event.preventDefault();
    if (!saveName.trim()) return;
    const view = await createView.mutateAsync({ name: saveName.trim(), ...viewPayload(), is_favorite: true });
    setSelectedViewId(view.id); setSaveName(''); setShowSave(false);
  }

  async function moveBefore(project, beforeProject) {
    await reorderProject.mutateAsync({ id: project.id, before_project_id: beforeProject?.id || null, expected_revision: project.revision });
  }

  async function shiftProject(project, days, shiftChain) {
    const start = project.start_date ? addISODate(project.start_date, days) : null;
    const target = project.target_date ? addISODate(project.target_date, days) : null;
    await moveTimeline.mutateAsync({ id: project.id, start_date: start, target_date: target, shift_dependency_chain: shiftChain, expected_revision: project.revision });
  }

  if (isLoading) return <div className="space-y-3" aria-label="Loading projects"><div className="h-24 animate-pulse rounded-xl bg-bg-surface" /><div className="h-24 animate-pulse rounded-xl bg-bg-surface" /></div>;
  if (isError) return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-400" role="alert">{error?.message || 'Projects could not be loaded.'}</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="label mb-1">Portfolio</p><h1 className="text-2xl font-semibold text-text-primary">Projects</h1><p className="mt-1 text-sm text-text-secondary">Outcome-level work, progress, health, and dependencies.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary min-h-11" onClick={() => setShowSave(true)}><Save className="mr-2 inline h-4 w-4" />Save view</button><button type="button" className="btn-primary flex min-h-11 items-center justify-center gap-2" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New project</button></div>
      </header>
      {creating && <ProjectForm selectedBusiness={selectedBusiness} members={members} onCancel={() => setCreating(false)} onCreated={project => onOpenProject(project.id)} />}
      {showSave && <form className="card flex flex-col gap-2 p-3 sm:flex-row" onSubmit={saveNewView}><input autoFocus aria-label="Saved project view name" className="input-field min-h-11 flex-1" placeholder="View name" value={saveName} onChange={event => setSaveName(event.target.value)} /><button type="button" className="btn-secondary min-h-11" onClick={() => setShowSave(false)}>Cancel</button><button type="submit" className="btn-primary min-h-11" disabled={createView.isPending}>Save project view</button></form>}
      <div className="card space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2"><select aria-label="Saved project view" className="input-field min-h-11 min-w-[180px]" value={selectedViewId} onChange={event => setSelectedViewId(event.target.value)}><option value="">Unsaved view</option>{savedViews.map(view => <option key={view.id} value={view.id}>{view.is_favorite ? '★ ' : ''}{view.name}</option>)}</select>{selectedView && <><button type="button" className="btn-ghost min-h-11" onClick={() => updateView.mutate({ id: selectedView.id, expected_revision: selectedView.revision, ...viewPayload() })}>Update view</button><button type="button" className="btn-ghost min-h-11" aria-label={selectedView.is_favorite ? 'Unfavorite view' : 'Favorite view'} onClick={() => updateView.mutate({ id: selectedView.id, expected_revision: selectedView.revision, is_favorite: !selectedView.is_favorite })}><Star className={`h-4 w-4 ${selectedView.is_favorite ? 'fill-accent text-accent' : ''}`} /></button><button type="button" className="btn-ghost min-h-11 text-red-400" onClick={() => archiveView.mutate({ id: selectedView.id, expected_revision: selectedView.revision }, { onSuccess: () => setSelectedViewId('') })}>Archive view</button></>}<span className="ml-auto text-sm text-text-muted">{projects.length} project{projects.length === 1 ? '' : 's'}</span></div>
        <div className="flex flex-wrap gap-2"><div className="flex rounded-lg border border-border p-1" aria-label="Project layout"><button type="button" className={`btn-ghost min-h-9 px-2 ${config.layout === 'list' ? 'bg-accent-muted text-accent' : ''}`} aria-label="List layout" onClick={() => patchConfig('layout','list')}><LayoutList className="h-4 w-4" /></button><button type="button" className={`btn-ghost min-h-9 px-2 ${config.layout === 'board' ? 'bg-accent-muted text-accent' : ''}`} aria-label="Board layout" onClick={() => patchConfig('layout','board')}><Columns3 className="h-4 w-4" /></button><button type="button" className={`btn-ghost min-h-9 px-2 ${config.layout === 'timeline' ? 'bg-accent-muted text-accent' : ''}`} aria-label="Timeline layout" onClick={() => patchConfig('layout','timeline')}><GanttChart className="h-4 w-4" /></button></div><select aria-label="Group projects by" className="input-field min-h-11" value={config.group_by} onChange={event => patchConfig('group_by', event.target.value)}><option value="none">No grouping</option><option value="status">Status</option><option value="health">Health</option><option value="lead">Lead</option><option value="member">Members</option><option value="business">Business</option><option value="initiative">Initiative</option><option value="priority">Priority</option><option value="start_date">Start month</option><option value="target_date">Target month</option></select><select aria-label="Order projects by" className="input-field min-h-11" value={config.sort_by} onChange={event => patchConfig('sort_by', event.target.value)}><option value="priority">Priority</option><option value="manual">Manual</option><option value="status">Status</option><option value="target_date">Target date</option><option value="start_date">Start date</option><option value="updated_at">Updated</option><option value="created_at">Created</option><option value="name">Name</option></select><select aria-label="Project sort direction" className="input-field min-h-11" value={config.sort_dir} onChange={event => patchConfig('sort_dir', event.target.value)} disabled={config.sort_by === 'manual'}><option value="asc">Ascending</option><option value="desc">Descending</option></select><select aria-label="Completed projects window" className="input-field min-h-11" value={config.completed_window} onChange={event => patchConfig('completed_window', event.target.value)}><option value="none">No completed</option><option value="week">Completed last week</option><option value="month">Completed last month</option><option value="year">Completed last year</option><option value="all">All completed</option></select>{config.layout === 'timeline' && <><select aria-label="Timeline zoom" className="input-field min-h-11" value={config.zoom} onChange={event => patchConfig('zoom', event.target.value)}><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option></select><label className="flex min-h-11 items-center gap-2 text-sm text-text-secondary"><input type="checkbox" className="h-5 w-5" checked={config.shift_chain} onChange={event => patchConfig('shift_chain', event.target.checked)} />Shift planned dependency chain</label></>}</div>
        <div className="flex flex-wrap gap-2"><select aria-label="Filter projects by status" className="input-field min-h-11" value={config.status} onChange={event => patchConfig('status', event.target.value)}><option value="">All active statuses</option>{PROJECT_STATUSES.filter(([id]) => id !== 'archived').map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="Filter projects by health" className="input-field min-h-11" value={config.health} onChange={event => patchConfig('health', event.target.value)}><option value="">All health</option>{HEALTH.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select><select aria-label="Filter projects by lead" className="input-field min-h-11" value={config.lead_id} onChange={event => patchConfig('lead_id', event.target.value)}><option value="">All leads</option>{members.map(member => <option key={member.id} value={member.id}>{member.name || member.id}</option>)}</select><select aria-label="Filter projects by initiative" className="input-field min-h-11" value={config.initiative} onChange={event => patchConfig('initiative', event.target.value)}><option value="">All initiatives</option>{initiatives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filter projects by dependency" className="input-field min-h-11" value={config.dependency} onChange={event => patchConfig('dependency', event.target.value)}><option value="">All dependencies</option><option value="any">Has dependencies</option><option value="blocking">Blocking</option><option value="blocked_by">Blocked by</option><option value="violated">Violated</option><option value="none">No dependencies</option></select></div>
      </div>
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-bg-surface p-10 text-center"><FolderKanban className="mx-auto h-8 w-8 text-text-muted" /><h2 className="mt-3 text-lg font-semibold text-text-primary">No projects in this view</h2><p className="mt-2 text-sm text-text-secondary">Create a bounded outcome or change the status and business filters.</p></div>
      ) : (
        <ProjectViewLayouts projects={projects} layout={config.layout} groupBy={config.group_by} zoom={config.zoom} manualOrder={config.sort_by === 'manual'} shiftChain={config.shift_chain} onOpenProject={onOpenProject} onMoveBefore={moveBefore} onStatusChange={(project,statusValue) => project && updateProject.mutate({ id: project.id, expected_revision: project.revision, status: statusValue })} onShiftProject={shiftProject} />
      )}
    </div>
  );
}

function ProjectDetail({ projectId, onBack, onOpenProject, onOpenInitiative, onSelectAction }) {
  const { BUSINESS_LIST } = useBusinessContext();
  const { data: members = [] } = useMembers();
  const { data: project, isLoading, isError, error } = useProject(projectId);
  const { data: portfolio = [] } = useProjects({ status: 'backlog,planned,in_progress,paused', limit: 200, sort_by: 'name', sort_dir: 'asc' });
  const actionsQuery = useActions({ status: 'not_started,in_progress,waiting,blocked,todo,open', limit: 200, sort_by: 'priority' });
  const actionViewsQuery = useViews({ entity_type: 'action', context_project_id: projectId });
  const { data: estimateSettings } = useEstimateSettings();
  const updateProject = useUpdateProject();
  const archiveProject = useArchiveProject();
  const restoreProject = useRestoreProject();
  const createMilestone = useCreateProjectMilestone();
  const archiveMilestone = useArchiveProjectMilestone();
  const postUpdate = usePostProjectUpdate();
  const createDependency = useCreateProjectDependency();
  const resolveDependency = useResolveProjectDependency();
  const assignAction = useAssignProjectAction();
  const removeAction = useRemoveProjectAction();
  const createActionView = useCreateView();
  const updateActionView = useUpdateView();
  const archiveActionView = useArchiveView();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState('');
  const [milestoneForm, setMilestoneForm] = useState({ name: '', target_date: '' });
  const [updateForm, setUpdateForm] = useState({ health: 'on_track', body: '' });
  const [assignment, setAssignment] = useState({ action_id: '', milestone_id: '', estimate_points: '' });
  const [dependencyId, setDependencyId] = useState('');
  const [selectedActionViewId, setSelectedActionViewId] = useState('');
  const [showActionViewForm, setShowActionViewForm] = useState(false);
  const [actionViewForm, setActionViewForm] = useState({ name: '', status: '', priority: '', layout: 'list' });

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name || '', summary: project.summary || '', description: project.description || '',
      business: project.business || '', status: project.status || 'planned', health: project.health || 'no_update',
      priority: project.priority || '', lead_id: project.lead_id || '', members: Array.isArray(project.members) ? project.members : [],
      start_date: project.start_date || '', target_date: project.target_date || '', update_frequency: project.update_frequency || 'weekly',
    });
  }, [project?.id, project?.revision]);

  const availableActions = useMemo(() => (actionsQuery.data || []).filter(action => !action.project_id || action.project_id === projectId), [actionsQuery.data, projectId]);
  const dependencyOptions = useMemo(() => portfolio.filter(item => item.id !== projectId), [portfolio, projectId]);
  const actionViews = actionViewsQuery.data || [];
  const selectedActionView = actionViews.find(view => view.id === selectedActionViewId) || null;
  const contextualActions = useMemo(() => {
    const filters = selectedActionView?.filters || {};
    const statusSet = new Set(String(filters.status || '').split(',').filter(Boolean));
    const rows = (project?.actions || []).filter(action => (!statusSet.size || statusSet.has(action.status)) && (!filters.priority || action.priority === filters.priority));
    return [...rows].sort((a, b) => selectedActionView?.sort_by === 'title' ? String(a.title).localeCompare(String(b.title)) : String(a.priority || 'p9').localeCompare(String(b.priority || 'p9')));
  }, [project?.actions, selectedActionView]);

  async function saveActionView(event) {
    event.preventDefault();
    const result = await mutationNotice(createActionView.mutateAsync({
      name: actionViewForm.name, entity_type: 'action', context_project_id: projectId,
      filters: { ...(actionViewForm.status ? { status: actionViewForm.status } : {}), ...(actionViewForm.priority ? { priority: actionViewForm.priority } : {}) },
      layout: actionViewForm.layout, group_by: actionViewForm.layout === 'board' ? 'status' : 'none', sort_by: 'priority', sort_dir: 'asc', display_options: {},
    }), 'Project action view saved.');
    if (result) { setSelectedActionViewId(result.id); setShowActionViewForm(false); setActionViewForm({ name: '', status: '', priority: '', layout: 'list' }); }
  }

  function mutationNotice(promise, success) {
    setNotice('');
    return promise.then(result => { setNotice(success); return result; }).catch(mutationError => { setNotice(mutationError.message || 'The change could not be saved.'); return null; });
  }

  if (isLoading) return <div className="mx-auto max-w-7xl space-y-4" aria-label="Loading project"><div className="h-28 animate-pulse rounded-xl bg-bg-surface" /><div className="h-64 animate-pulse rounded-xl bg-bg-surface" /></div>;
  if (isError || !project) return <div className="mx-auto max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-400" role="alert">{error?.message || 'Project could not be loaded.'}<button type="button" className="btn-ghost ml-3" onClick={onBack}>Back to projects</button></div>;

  async function saveProject() {
    const saved = await mutationNotice(updateProject.mutateAsync({
      id: project.id, expected_revision: project.revision, ...form,
      priority: form.priority || null, business: form.business || null, lead_id: form.lead_id || null,
      start_date: form.start_date || null, target_date: form.target_date || null,
    }), 'Project saved.');
    if (saved) setEditing(false);
  }

  async function addMilestone(event) {
    event.preventDefault();
    if (!milestoneForm.name.trim()) return setNotice('Milestone name is required.');
    await mutationNotice(createMilestone.mutateAsync({ id: project.id, name: milestoneForm.name, target_date: milestoneForm.target_date || null }), 'Milestone added.');
    setMilestoneForm({ name: '', target_date: '' });
  }

  async function addUpdate(event) {
    event.preventDefault();
    if (!updateForm.body.trim()) return setNotice('Write a project update first.');
    await mutationNotice(postUpdate.mutateAsync({ id: project.id, ...updateForm }), 'Project update posted.');
    setUpdateForm(current => ({ ...current, body: '' }));
  }

  async function addAction(event) {
    event.preventDefault();
    if (!assignment.action_id) return setNotice('Choose an action to add.');
    await mutationNotice(assignAction.mutateAsync({
      id: project.id, actionId: assignment.action_id, milestone_id: assignment.milestone_id || null,
      estimate_points: assignment.estimate_points === '' ? null : Number(assignment.estimate_points),
    }), 'Action added to project.');
    setAssignment({ action_id: '', milestone_id: '', estimate_points: '' });
  }

  async function addDependency(event) {
    event.preventDefault();
    if (!dependencyId) return setNotice('Choose a blocking project.');
    await mutationNotice(createDependency.mutateAsync({ id: project.id, blocking_project_id: dependencyId }), 'Project dependency added.');
    setDependencyId('');
  }

  const activeMilestones = (project.milestones || []).filter(milestone => milestone.status !== 'archived');
  const isArchived = project.status === 'archived';

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0"><button type="button" className="btn-ghost -ml-3 mb-2 flex min-h-11 items-center gap-2" onClick={onBack}><ArrowLeft className="h-4 w-4" />Projects</button><div className="flex flex-wrap items-center gap-2"><p className="label">Project overview</p><span className={`badge ${healthClasses(project.health)}`}>{labelFor(HEALTH, project.health)}</span></div><h1 className="mt-2 text-2xl font-semibold text-text-primary sm:text-3xl">{project.name}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">{project.summary || 'No project summary yet.'}</p></div>
        <div className="flex flex-wrap gap-2">
          {!isArchived && <button type="button" className="btn-secondary min-h-11" onClick={() => setEditing(value => !value)}>{editing ? 'Stop editing' : 'Edit project'}</button>}
          {!isArchived && <button type="button" className="btn-secondary flex min-h-11 items-center gap-2" onClick={() => window.confirm('Archive this project? Its actions and history will remain available.') && mutationNotice(archiveProject.mutateAsync({ id: project.id, expected_revision: project.revision }), 'Project archived.')}><Archive className="h-4 w-4" />Archive</button>}
          {isArchived && <button type="button" className="btn-primary flex min-h-11 items-center gap-2" onClick={() => mutationNotice(restoreProject.mutateAsync({ id: project.id, expected_revision: project.revision }), 'Project restored.')}><ArchiveRestore className="h-4 w-4" />Restore</button>}
        </div>
      </header>

      {notice && <div className="rounded-lg border border-accent/30 bg-accent-muted px-4 py-3 text-sm text-text-primary" role="status">{notice}</div>}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Project status summary">
        <div className="card p-4"><div className="flex items-center gap-2 text-text-muted"><ListChecks className="h-4 w-4" /><span className="label">Progress</span></div><div className="mt-4"><ProjectProgress progress={project.progress} /></div><p className="mt-2 text-xs text-text-muted">{project.progress?.completed_effort || 0}/{project.progress?.total_effort || 0} effort points</p></div>
        <div className="card p-4"><div className="flex items-center gap-2 text-text-muted"><CircleDot className="h-4 w-4" /><span className="label">Status</span></div><p className="mt-3 text-lg font-semibold text-text-primary">{labelFor(PROJECT_STATUSES, project.status)}</p><p className="mt-1 text-xs text-text-muted">{project.progress?.blocked_issues || 0} blocked action{project.progress?.blocked_issues === 1 ? '' : 's'}</p></div>
        <div className="card p-4"><div className="flex items-center gap-2 text-text-muted"><CalendarDays className="h-4 w-4" /><span className="label">Target</span></div><p className="mt-3 text-lg font-semibold text-text-primary">{formatDate(project.target_date)}</p><p className="mt-1 text-xs text-text-muted">Starts {formatDate(project.start_date)}</p></div>
        <div className="card p-4"><div className="flex items-center gap-2 text-text-muted"><HeartPulse className="h-4 w-4" /><span className="label">Health</span></div><p className="mt-3 text-lg font-semibold text-text-primary">{labelFor(HEALTH, project.health)}</p><p className="mt-1 text-xs text-text-muted">Updates {project.update_frequency || 'weekly'}{project.template_id ? ' · from template' : ''}</p></div>
      </section>

      {editing && form && (
        <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="edit-project-heading">
          <div className="flex items-center justify-between"><h2 id="edit-project-heading" className="text-lg font-semibold text-text-primary">Project properties</h2><button type="button" className="btn-primary flex min-h-11 items-center gap-2" onClick={saveProject} disabled={updateProject.isPending}><Save className="h-4 w-4" />{updateProject.isPending ? 'Saving…' : 'Save project'}</button></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="md:col-span-2"><span className="label mb-1 block">Name</span><input className="input-field min-h-11 w-full" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label>
            <label><span className="label mb-1 block">Status</span><select className="input-field min-h-11 w-full" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}>{PROJECT_STATUSES.filter(([id]) => id !== 'archived').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label><span className="label mb-1 block">Priority</span><select className="input-field min-h-11 w-full" value={form.priority} onChange={event => setForm(current => ({ ...current, priority: event.target.value }))}>{PRIORITIES.map(([id, label]) => <option key={id || 'none'} value={id}>{label}</option>)}</select></label>
            <label className="md:col-span-2 xl:col-span-4"><span className="label mb-1 block">Summary</span><textarea className="input-field min-h-24 w-full" value={form.summary} onChange={event => setForm(current => ({ ...current, summary: event.target.value }))} /></label>
            <label className="md:col-span-2 xl:col-span-4"><span className="label mb-1 block">Description</span><textarea className="input-field min-h-32 w-full" value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} /></label>
            <label><span className="label mb-1 block">Business</span><select className="input-field min-h-11 w-full" value={form.business} onChange={event => setForm(current => ({ ...current, business: event.target.value }))}><option value="">None</option>{BUSINESS_LIST.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label><span className="label mb-1 block">Lead</span><select className="input-field min-h-11 w-full" value={form.lead_id} onChange={event => setForm(current => ({ ...current, lead_id: event.target.value }))}><option value="">None</option>{members.map(member => <option key={member.id} value={member.id}>{member.name || member.id}</option>)}</select></label>
            <label><span className="label mb-1 block">Start date</span><input type="date" className="input-field min-h-11 w-full" value={form.start_date} onChange={event => setForm(current => ({ ...current, start_date: event.target.value }))} /></label>
            <label><span className="label mb-1 block">Target date</span><input type="date" className="input-field min-h-11 w-full" value={form.target_date} onChange={event => setForm(current => ({ ...current, target_date: event.target.value }))} /></label>
            <label><span className="label mb-1 block">Update cadence</span><select className="input-field min-h-11 w-full" value={form.update_frequency} onChange={event => setForm(current => ({ ...current, update_frequency: event.target.value }))}><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option><option value="never">No reminders</option></select></label>
            <div className="md:col-span-2 xl:col-span-4"><span className="label mb-1 block">Project members</span><MemberSelector members={members} selectedIds={form.members} onChange={value => setForm(current => ({ ...current, members: value }))} placeholder="Add project members…" /></div>
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="space-y-5">
          <section className="card p-4 sm:p-5" aria-labelledby="project-actions-heading">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="label">Execution</p><h2 id="project-actions-heading" className="mt-1 text-lg font-semibold text-text-primary">Project actions</h2></div><div className="flex items-center gap-2"><span className="text-sm text-text-muted">{contextualActions.length} shown</span>{!isArchived && <button type="button" className="btn-ghost min-h-10" onClick={() => setShowActionViewForm(value => !value)}><Plus className="mr-1 inline h-4 w-4" />View</button>}</div></div>
            <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Project action views"><button type="button" role="tab" aria-selected={!selectedActionView} className={`min-h-10 rounded-lg px-3 text-sm ${!selectedActionView ? 'bg-accent text-black' : 'border border-border text-text-secondary'}`} onClick={() => setSelectedActionViewId('')}>All actions</button>{actionViews.map(view => <div key={view.id} className="flex items-center rounded-lg border border-border"><button type="button" role="tab" aria-selected={selectedActionViewId === view.id} className={`min-h-10 px-3 text-sm ${selectedActionViewId === view.id ? 'bg-accent text-black' : 'text-text-secondary'}`} onClick={() => setSelectedActionViewId(view.id)}>{view.is_favorite ? '★ ' : ''}{view.name}</button>{selectedActionViewId === view.id && <><button type="button" className="btn-ghost min-h-10 px-2" aria-label={view.is_favorite ? 'Unfavorite project action view' : 'Favorite project action view'} onClick={() => updateActionView.mutate({ id: view.id, expected_revision: view.revision, is_favorite: !view.is_favorite })}><Star className={`h-3.5 w-3.5 ${view.is_favorite ? 'fill-accent text-accent' : ''}`} /></button><button type="button" className="btn-ghost min-h-10 px-2 text-red-400" aria-label="Archive project action view" onClick={() => archiveActionView.mutate({ id: view.id, expected_revision: view.revision }, { onSuccess: () => setSelectedActionViewId('') })}><X className="h-3.5 w-3.5" /></button></>}</div>)}</div>
            {showActionViewForm && <form className="mt-3 grid gap-2 rounded-xl border border-border bg-bg-elevated p-3 sm:grid-cols-2" onSubmit={saveActionView}><input required aria-label="Project action view name" className="input-field min-h-11" placeholder="View name" value={actionViewForm.name} onChange={event => setActionViewForm(current => ({ ...current, name: event.target.value }))} /><select aria-label="Project action view status" className="input-field min-h-11" value={actionViewForm.status} onChange={event => setActionViewForm(current => ({ ...current, status: event.target.value }))}><option value="">All statuses</option><option value="not_started,todo,open">Unstarted</option><option value="in_progress,waiting,blocked">Started</option><option value="done,completed,closed">Completed</option></select><select aria-label="Project action view priority" className="input-field min-h-11" value={actionViewForm.priority} onChange={event => setActionViewForm(current => ({ ...current, priority: event.target.value }))}><option value="">All priorities</option>{PRIORITIES.filter(([id]) => id).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select><div className="flex gap-2"><select aria-label="Project action view layout" className="input-field min-h-11 flex-1" value={actionViewForm.layout} onChange={event => setActionViewForm(current => ({ ...current, layout: event.target.value }))}><option value="list">List</option><option value="board">Board</option></select><button type="submit" className="btn-primary min-h-11" disabled={createActionView.isPending}>Save</button></div></form>}
            {!isArchived && <form onSubmit={addAction} className="mt-4 grid gap-2 rounded-xl border border-border bg-bg-elevated p-3 md:grid-cols-[minmax(0,1fr)_minmax(160px,0.5fr)_130px_auto]"><select aria-label="Action to add" className="input-field min-h-11" value={assignment.action_id} onChange={event => setAssignment(current => ({ ...current, action_id: event.target.value }))}><option value="">Choose an active action…</option>{availableActions.map(action => <option key={action.id} value={action.id}>{action.title}</option>)}</select><select aria-label="Project milestone" className="input-field min-h-11" value={assignment.milestone_id} onChange={event => setAssignment(current => ({ ...current, milestone_id: event.target.value }))}><option value="">No milestone</option>{activeMilestones.map(milestone => <option key={milestone.id} value={milestone.id}>{milestone.name}</option>)}</select><select aria-label="Estimate points" className="input-field min-h-11" value={assignment.estimate_points} onChange={event => setAssignment(current => ({ ...current, estimate_points: event.target.value }))}><option value="">Unestimated</option>{(estimateSettings?.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button className="btn-secondary min-h-11" type="submit">Add</button></form>}
            {selectedActionView?.layout === 'board' ? <div className="mt-4 grid gap-3 md:grid-cols-3">{[['unstarted',['not_started','todo','open']],['started',['in_progress','waiting','blocked']],['completed',['done','completed','closed']]].map(([label,statuses]) => <div key={label} className="rounded-xl border border-border bg-bg-elevated p-3"><p className="label mb-2">{label}</p><div className="space-y-2">{contextualActions.filter(action => statuses.includes(action.status)).map(action => <button key={action.id} type="button" className="block min-h-11 w-full rounded-lg border border-border bg-bg-surface p-2 text-left" onClick={() => onSelectAction(action.id)}><span className="block truncate text-sm font-semibold text-text-primary">{action.title}</span><span className="text-xs text-text-muted">{action.identifier || action.id}</span></button>)}</div></div>)}</div> : <div className="mt-4 space-y-2">{contextualActions.map(action => <div key={action.id} className="flex flex-col gap-3 rounded-xl border border-border bg-bg-surface p-3 sm:flex-row sm:items-center"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectAction(action.id)}><p className="truncate text-sm font-semibold text-text-primary">{action.title}</p><p className="mt-1 text-xs text-text-muted">{action.identifier ? `${action.identifier} · ` : ''}{labelFor(PROJECT_STATUSES, action.status)}{action.estimate_points !== null && action.estimate_points !== undefined ? ` · ${action.estimate_points} pts` : ' · unestimated'}{action.project_milestone_id ? ` · ${activeMilestones.find(item => item.id === action.project_milestone_id)?.name || 'Milestone'}` : ''}</p></button>{!isArchived && <button type="button" className="btn-ghost flex min-h-11 items-center gap-2 text-red-400" onClick={() => mutationNotice(removeAction.mutateAsync({ id: project.id, actionId: action.id }), 'Action removed from project.')}><Unlink className="h-4 w-4" />Remove</button>}</div>)}{contextualActions.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No actions match this project view.</p>}</div>}
          </section>

          <section className="card p-4 sm:p-5" aria-labelledby="milestones-heading">
            <div><p className="label">Stages</p><h2 id="milestones-heading" className="mt-1 text-lg font-semibold text-text-primary">Milestones</h2></div>
            {!isArchived && <form className="mt-4 grid gap-2 rounded-xl border border-border bg-bg-elevated p-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={addMilestone}><input aria-label="Milestone name" className="input-field min-h-11" placeholder="Milestone name" value={milestoneForm.name} onChange={event => setMilestoneForm(current => ({ ...current, name: event.target.value }))} /><input aria-label="Milestone target date" type="date" className="input-field min-h-11" value={milestoneForm.target_date} onChange={event => setMilestoneForm(current => ({ ...current, target_date: event.target.value }))} /><button type="submit" className="btn-secondary min-h-11">Add milestone</button></form>}
            <div className="mt-4 space-y-2">{activeMilestones.map(milestone => { const milestoneActions = (project.actions || []).filter(action => action.project_milestone_id === milestone.id); const complete = milestoneActions.filter(action => ['done', 'completed', 'closed'].includes(action.status)).length; return <div key={milestone.id} className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface p-3"><Flag className="h-4 w-4 flex-shrink-0 text-accent" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-text-primary">{milestone.name}</p><p className="mt-1 text-xs text-text-muted">{formatDate(milestone.target_date)} · {complete}/{milestoneActions.length} complete</p></div>{!isArchived && <button type="button" className="btn-ghost min-h-11" aria-label={`Archive milestone ${milestone.name}`} onClick={() => mutationNotice(archiveMilestone.mutateAsync({ id: project.id, milestoneId: milestone.id, expected_revision: milestone.revision }), 'Milestone archived.')}><Archive className="h-4 w-4" /></button>}</div>; })}{activeMilestones.length === 0 && <p className="py-6 text-center text-sm text-text-muted">No milestones yet.</p>}</div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card p-4 sm:p-5" aria-labelledby="updates-heading">
            <div><p className="label">Reporting</p><h2 id="updates-heading" className="mt-1 text-lg font-semibold text-text-primary">Health updates</h2></div>
            {!isArchived && <form className="mt-4 space-y-2" onSubmit={addUpdate}><select aria-label="Update health" className="input-field min-h-11 w-full" value={updateForm.health} onChange={event => setUpdateForm(current => ({ ...current, health: event.target.value }))}>{UPDATE_HEALTH.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><textarea aria-label="Project update" className="input-field min-h-28 w-full" placeholder="Progress, risks, and next steps…" value={updateForm.body} onChange={event => setUpdateForm(current => ({ ...current, body: event.target.value }))} /><button type="submit" className="btn-primary min-h-11 w-full" disabled={postUpdate.isPending}>{postUpdate.isPending ? 'Posting…' : 'Post update'}</button></form>}
            <div className="mt-4 space-y-3">{(project.updates || []).map(update => <article key={update.id} className="rounded-xl border border-border bg-bg-surface p-3"><div className="flex flex-wrap items-center gap-2"><span className={`badge ${healthClasses(update.health)}`}>{labelFor(HEALTH, update.health)}</span><span className="text-xs text-text-muted">{formatTimestamp(update.created_at)} · {update.created_by}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{update.body}</p><DiscussionThread targetType="project_update" targetId={update.id} compact /></article>)}{(project.updates || []).length === 0 && <p className="py-6 text-center text-sm text-text-muted">No project updates yet.</p>}</div>
          </section>

          <section className="card p-4 sm:p-5" aria-labelledby="dependencies-heading">
            <div className="flex items-center gap-2"><GitBranch className="h-5 w-5 text-accent" /><h2 id="dependencies-heading" className="text-lg font-semibold text-text-primary">Dependencies</h2></div>
            {!isArchived && <form className="mt-4 flex gap-2" onSubmit={addDependency}><select aria-label="Blocking project" className="input-field min-h-11 min-w-0 flex-1" value={dependencyId} onChange={event => setDependencyId(event.target.value)}><option value="">Blocked by project…</option>{dependencyOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="submit" className="btn-secondary min-h-11">Add</button></form>}
            <div className="mt-4 space-y-2">{(project.dependencies || []).map(dependency => <div key={dependency.id} className="rounded-xl border border-border bg-bg-surface p-3"><div className="flex items-start gap-2"><Link2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => dependency.related_project && onOpenProject(dependency.related_project.id)}><p className="text-sm font-semibold text-text-primary">{dependency.direction === 'blocked_by' ? 'Blocked by' : 'Blocking'} {dependency.related_project?.name || 'Unknown project'}</p><p className="mt-1 text-xs text-text-muted">{dependency.note || 'End-to-start dependency'}</p></button>{dependency.direction === 'blocked_by' && !isArchived && <button type="button" className="btn-ghost min-h-11" aria-label={`Resolve dependency on ${dependency.related_project?.name || 'project'}`} onClick={() => mutationNotice(resolveDependency.mutateAsync({ id: project.id, dependencyId: dependency.id }), 'Dependency resolved.')}><CheckCircle2 className="h-4 w-4" /></button>}</div></div>)}{(project.dependencies || []).length === 0 && <p className="py-6 text-center text-sm text-text-muted">No active project dependencies.</p>}</div>
          </section>

          <section className="card p-4 sm:p-5" aria-labelledby="project-initiatives-heading">
            <div className="flex items-center gap-2"><Flag className="h-5 w-5 text-accent" /><h2 id="project-initiatives-heading" className="text-lg font-semibold text-text-primary">Initiatives</h2></div>
            <div className="mt-4 space-y-2">{(project.initiatives || []).map(initiative => <button type="button" key={initiative.id} className="block min-h-11 w-full rounded-xl border border-border bg-bg-surface p-3 text-left" onClick={() => onOpenInitiative?.(initiative.id)}><p className="text-sm font-semibold text-text-primary">{initiative.name}</p><p className="mt-1 text-xs text-text-muted">{labelFor(HEALTH, initiative.health)} · {initiative.priority?.toUpperCase() || 'No priority'}</p></button>)}{(project.initiatives || []).length === 0 && <p className="py-5 text-center text-sm text-text-muted">This project is not attached to an initiative.</p>}</div>
          </section>

          {project.description && <section className="card p-4 sm:p-5"><p className="label">Description</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{project.description}</p></section>}
        </div>
      </div>
      <DiscussionThread targetType="project" targetId={project.id} />
    </div>
  );
}

export default function ProjectsPage({ projectId, selectedBusiness, searchQuery, onOpenProject, onOpenInitiative, onBack, onSelectAction }) {
  if (projectId) return <ProjectDetail projectId={projectId} onBack={onBack} onOpenProject={onOpenProject} onOpenInitiative={onOpenInitiative} onSelectAction={onSelectAction} />;
  return <ProjectPortfolio selectedBusiness={selectedBusiness} searchQuery={searchQuery} onOpenProject={onOpenProject} />;
}
