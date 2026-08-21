import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Flag, GripVertical } from 'lucide-react';
import { formatDateLong } from '../utils/dateUtils.js';

const STATUS_ORDER = ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled'];
function label(value) { return String(value || 'None').replace(/_/g, ' '); }

export function projectGroupValue(project, groupBy) {
  if (!groupBy || groupBy === 'none') return 'All projects';
  if (groupBy === 'lead') return project.lead_id || 'No lead';
  if (groupBy === 'member') return Array.isArray(project.members) && project.members.length ? project.members.join(', ') : 'No members';
  if (groupBy === 'start_date') return project.start_date ? project.start_date.slice(0, 7) : 'No start date';
  if (groupBy === 'target_date') return project.target_date ? project.target_date.slice(0, 7) : 'No target date';
  if (groupBy === 'initiative') return Array.isArray(project.initiatives) && project.initiatives.length ? project.initiatives.map(item => item.name).join(', ') : 'No initiative';
  return project[groupBy] || `No ${label(groupBy)}`;
}

export function groupProjects(projects, groupBy) {
  const groups = new Map();
  for (const project of projects) {
    const key = projectGroupValue(project, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (groupBy === 'status') return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b);
    return String(a).localeCompare(String(b));
  });
}

function dateValue(value) { return new Date(`${value}T12:00:00Z`).valueOf(); }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10); }

export function timelineGeometry(projects, zoom = 'quarter') {
  const dated = projects.filter(project => project.start_date || project.target_date);
  const values = dated.flatMap(project => [project.start_date, project.target_date].filter(Boolean).map(dateValue));
  const today = dateValue(new Date().toISOString().slice(0, 10));
  const unitDays = zoom === 'week' ? 7 : zoom === 'month' ? 30 : zoom === 'year' ? 365 : 91;
  const min = (values.length ? Math.min(...values) : today) - unitDays * 86400000;
  const max = (values.length ? Math.max(...values) : today) + unitDays * 86400000;
  const span = Math.max(86400000, max - min);
  const x = value => ((dateValue(value) - min) / span) * 100;
  return { dated, min, max, span, x, unitDays, minWidth: zoom === 'week' ? 1200 : zoom === 'month' ? 1000 : zoom === 'quarter' ? 840 : 700 };
}

function ProjectSummary({ project }) {
  return <><div className="flex flex-wrap items-center gap-2"><span className="badge border-border text-text-muted">{label(project.status)}</span>{project.health && <span className="text-[10px] uppercase tracking-wider text-text-muted">{label(project.health)}</span>}</div><p className="mt-2 truncate text-sm font-semibold text-text-primary">{project.name}</p><p className="mt-1 text-xs text-text-muted">{project.progress?.progress_percent || 0}% · {project.target_date ? formatDateLong(project.target_date) : 'No target'}</p></>;
}

export function ProjectListLayout({ projects, groupBy, manualOrder, onOpenProject, onMoveBefore }) {
  return <div className="space-y-4">{groupProjects(projects, groupBy).map(([group, rows]) => <section key={group} className="card overflow-hidden"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-surface px-4 py-3"><h2 className="text-sm font-semibold capitalize text-text-primary">{label(group)}</h2><span className="text-xs text-text-muted">{rows.length}</span></div><div className="divide-y divide-border">{rows.map((project, index) => <div key={project.id} className="flex items-center gap-2 p-3 sm:p-4">{manualOrder && <GripVertical className="h-4 w-4 flex-shrink-0 text-text-muted" />}<button type="button" className="min-w-0 flex-1 text-left" aria-label={`Open project: ${project.name}`} onClick={() => onOpenProject(project.id)}><ProjectSummary project={project} /></button>{manualOrder && <div className="flex flex-col"><button type="button" className="btn-ghost min-h-9 px-2" aria-label={`Move ${project.name} up`} disabled={index === 0} onClick={() => onMoveBefore(project, rows[index - 1])}><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" className="btn-ghost min-h-9 px-2" aria-label={`Move ${project.name} down`} disabled={index === rows.length - 1} onClick={() => onMoveBefore(project, rows[index + 2] || null)}><ArrowDown className="h-3.5 w-3.5" /></button></div>}</div>)}</div></section>)}</div>;
}

export function ProjectBoardLayout({ projects, groupBy, onOpenProject, onStatusChange }) {
  const [draggedId, setDraggedId] = useState(null);
  const groups = groupProjects(projects, groupBy || 'status');
  return <div className="flex gap-4 overflow-x-auto pb-4" aria-label="Project board">{groups.map(([group, rows]) => <section key={group} className="w-[290px] flex-shrink-0 rounded-xl border border-border bg-bg-elevated p-3" onDragOver={event => { if (groupBy === 'status') event.preventDefault(); }} onDrop={() => { if (groupBy === 'status' && draggedId) onStatusChange(projects.find(project => project.id === draggedId), group); setDraggedId(null); }}><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold capitalize text-text-primary">{label(group)}</h2><span className="badge border-border text-text-muted">{rows.length}</span></div><div className="space-y-2">{rows.map(project => <button draggable={groupBy === 'status'} onDragStart={() => setDraggedId(project.id)} onDragEnd={() => setDraggedId(null)} key={project.id} type="button" className="card w-full p-3 text-left hover:border-border-hover" aria-label={`Open project: ${project.name}`} onClick={() => onOpenProject(project.id)}><ProjectSummary project={project} /></button>)}</div></section>)}</div>;
}

export function ProjectTimelineLayout({ projects, zoom, onOpenProject, onShiftProject, shiftChain }) {
  const geometry = useMemo(() => timelineGeometry(projects, zoom), [projects, zoom]);
  const rows = geometry.dated;
  const rowHeight = 66;
  const ticks = [];
  for (let value = geometry.min; value <= geometry.max; value += geometry.unitDays * 86400000) ticks.push(value);
  const indexById = new Map(rows.map((project, index) => [String(project.id), index]));
  const edges = [];
  const seen = new Set();
  for (const project of rows) for (const dependency of project.dependencies || []) {
    if (seen.has(dependency.id) || !indexById.has(String(dependency.blocking_project_id)) || !indexById.has(String(dependency.blocked_project_id))) continue;
    seen.add(dependency.id);
    const blocking = rows[indexById.get(String(dependency.blocking_project_id))];
    const blocked = rows[indexById.get(String(dependency.blocked_project_id))];
    edges.push({ ...dependency, x1: geometry.x(blocking.target_date || blocking.start_date), y1: indexById.get(String(blocking.id)) * rowHeight + rowHeight / 2, x2: geometry.x(blocked.start_date || blocked.target_date), y2: indexById.get(String(blocked.id)) * rowHeight + rowHeight / 2 });
  }
  return <div className="overflow-x-auto rounded-xl border border-border bg-bg-surface" aria-label="Project timeline"><div className="grid" style={{ gridTemplateColumns: `220px minmax(${geometry.minWidth}px, 1fr)`, minWidth: geometry.minWidth + 220 }}><div className="border-b border-r border-border p-3 text-xs text-text-muted">Project</div><div className="relative h-12 border-b border-border">{ticks.map(value => <div key={value} className="absolute inset-y-0 border-l border-border" style={{ left: `${((value - geometry.min) / geometry.span) * 100}%` }}><span className="ml-1 whitespace-nowrap text-[10px] text-text-muted">{formatDateLong(isoDate(value))}</span></div>)}</div><div className="divide-y divide-border border-r border-border">{rows.map(project => <div key={project.id} className="flex h-[66px] items-center gap-2 px-3"><button type="button" className="min-w-0 flex-1 text-left" aria-label={`Open project: ${project.name}`} onClick={() => onOpenProject(project.id)}><p className="truncate text-sm font-semibold text-text-primary">{project.name}</p><p className="text-[10px] text-text-muted">{label(project.status)} · {project.lead_id || 'No lead'}</p></button><div className="flex"><button type="button" className="btn-ghost min-h-9 px-1.5" aria-label={`Move ${project.name} earlier`} onClick={() => onShiftProject(project, -geometry.unitDays, shiftChain)}><ArrowLeft className="h-3.5 w-3.5" /></button><button type="button" className="btn-ghost min-h-9 px-1.5" aria-label={`Move ${project.name} later`} onClick={() => onShiftProject(project, geometry.unitDays, shiftChain)}><ArrowRight className="h-3.5 w-3.5" /></button></div></div>)}</div><div className="relative" style={{ height: rows.length * rowHeight }}><svg className="pointer-events-none absolute inset-0 z-20 h-full w-full" preserveAspectRatio="none" viewBox={`0 0 100 ${Math.max(1, rows.length * rowHeight)}`} aria-label="Project dependency lines">{edges.map(edge => <g key={edge.id}><line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} stroke={edge.violated ? '#ef4444' : '#3b82f6'} strokeWidth="0.5" vectorEffect="non-scaling-stroke" /><circle cx={edge.x2} cy={edge.y2} r="1" fill={edge.violated ? '#ef4444' : '#3b82f6'} /></g>)}</svg>{ticks.map(value => <div key={value} className="absolute inset-y-0 border-l border-border/60" style={{ left: `${((value - geometry.min) / geometry.span) * 100}%` }} />)}{rows.map((project, index) => { const left = geometry.x(project.start_date || project.target_date); const right = geometry.x(project.target_date || project.start_date); return <div key={project.id} className="absolute left-0 right-0 border-b border-border" style={{ top: index * rowHeight, height: rowHeight }}><button type="button" className="absolute top-4 z-10 h-8 rounded-lg bg-accent px-2 text-left text-xs font-semibold text-bg-primary shadow" style={{ left: `${Math.min(left,right)}%`, width: `${Math.max(2, Math.abs(right-left))}%` }} onClick={() => onOpenProject(project.id)} aria-label={`Open timeline project: ${project.name}`}><span className="block truncate">{project.name}</span></button>{(project.milestones || []).filter(milestone => milestone.target_date).map(milestone => <span key={milestone.id} className="absolute top-3 z-30 text-accent" style={{ left: `${geometry.x(milestone.target_date)}%` }} title={milestone.name}><Flag className="h-4 w-4" /></span>)}</div>; })}</div></div>{projects.some(project => !project.start_date && !project.target_date) && <div className="border-t border-border p-3 text-xs text-text-muted"><CalendarDays className="mr-1 inline h-4 w-4" />{projects.filter(project => !project.start_date && !project.target_date).length} project(s) have no timeframe and are omitted.</div>}</div>;
}

export default function ProjectViewLayouts(props) {
  if (props.layout === 'board') return <ProjectBoardLayout {...props} />;
  if (props.layout === 'timeline') return <ProjectTimelineLayout {...props} />;
  return <ProjectListLayout {...props} />;
}
