import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Copy,
  Edit3,
  History,
  Lock,
  Plus,
  Save,
  Send,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { weeksApi } from '../api/client.js';
import { useActions } from '../hooks/useActions.js';
import { useWeekPlan, useForkWeekPlan, usePublishWeekPlan, useRequestWeekReview, useSaveWeekPlan } from '../hooks/useWeekPlan.js';
import { addISODate, formatDate, formatDateLong, getPacificWeekDates } from '../utils/dateUtils.js';
import { StatusBadge } from './StatusBadge.jsx';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const EDITABLE_KINDS = new Set(['must_win', 'day_focus', 'risk', 'deferred', 'carryover', 'context']);
const ACTION_REQUIRED_KINDS = new Set(['must_win', 'day_focus', 'deferred', 'carryover']);
const SUPPORTING_KINDS = ['risk', 'deferred', 'carryover', 'context'];

const KIND_LABELS = {
  must_win: 'Must win',
  day_focus: 'Day focus',
  risk: 'Risk',
  deferred: 'Deferred',
  carryover: 'Carryover',
  context: 'Context',
};

function statusLabel(status) {
  const labels = {
    draft: 'Draft',
    published: 'Published',
    review_requested: 'Ready for review',
    superseded: 'Superseded',
  };
  return labels[status] || status || 'No plan yet';
}

function cloneItems(items = []) {
  return items.map(item => ({
    id: item.id,
    kind: item.kind,
    plan_date: item.plan_date || '',
    rank: item.rank || 0,
    source_action_id: item.source_action_id || '',
    title: item.title || item.action?.title || '',
    notes: item.notes || '',
    rationale: item.rationale || '',
    action: item.action || null,
    action_snapshot: item.action_snapshot || null,
  }));
}

function ActionLink({ action, sourceActionId, onSelectAction }) {
  if (!sourceActionId) return null;
  if (!action) {
    return (
      <p className="mt-3 flex items-start gap-1.5 text-sm leading-5 text-danger" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        Source task unavailable. The saved weekly note is still shown.
      </p>
    );
  }
  return (
    <button
      type="button"
      className="mt-3 block max-w-full text-left text-sm leading-5 text-text-secondary underline decoration-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
      onClick={() => onSelectAction(action.id)}
      aria-label={`Open source task: ${action.title}`}
    >
      Source task: {action.title}
    </button>
  );
}

function CommitmentCard({ commitment }) {
  const start = commitment.starts_at ? new Date(commitment.starts_at) : null;
  const end = commitment.ends_at ? new Date(commitment.ends_at) : null;
  const timeFormat = { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' };
  const time = commitment.all_day
    ? 'All day'
    : start ? `${start.toLocaleTimeString([], timeFormat)}${end ? `–${end.toLocaleTimeString([], timeFormat)}` : ''}` : 'Time not set';
  return (
    <article className="rounded-lg border border-border bg-bg-primary px-4 py-3">
      <div className="flex items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-5 text-text-primary [overflow-wrap:anywhere]">{commitment.title}</p>
          <p className="mt-1 text-[13px] leading-5 text-text-secondary">{time} · {commitment.source_label || 'Calendar'}</p>
        </div>
      </div>
    </article>
  );
}

export function ItemCard({ item, editing, actions, onChange, onRemove, onSelectAction }) {
  const linkedAction = item.action || actions.find(action => action.id === item.source_action_id);
  const kindLabel = KIND_LABELS[item.kind] || item.kind.replace('_', ' ');
  if (!editing) {
    return (
      <article className="min-w-0 rounded-lg border border-border bg-bg-surface px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="badge border-border bg-bg-primary text-text-secondary">{kindLabel}</span>
          {linkedAction && <StatusBadge status={linkedAction.status} workflowStatus={linkedAction.workflow_status} />}
        </div>
        <h3 className="mt-3 text-base font-semibold leading-6 text-text-primary [overflow-wrap:anywhere]">
          {item.title || linkedAction?.title || 'Untitled weekly item'}
        </h3>
        {item.notes && <p className="mt-2 text-sm leading-6 text-text-secondary [overflow-wrap:anywhere]">{item.notes}</p>}
        <ActionLink action={linkedAction} sourceActionId={item.source_action_id} onSelectAction={onSelectAction} />
        {!linkedAction && item.source_action_id && item.action_snapshot?.title && (
          <p className="mt-2 text-xs leading-5 text-text-muted">Published source: {item.action_snapshot.title}</p>
        )}
      </article>
    );
  }

  const actionRequired = ACTION_REQUIRED_KINDS.has(item.kind);
  return (
    <div className="rounded-lg border border-border bg-bg-surface p-3">
      <div className="grid gap-2 md:grid-cols-[150px_1fr_150px_auto]">
        <select aria-label="Weekly item type" className="input-field min-h-11 text-sm" value={item.kind} onChange={event => onChange({ kind: event.target.value })}>
          {Array.from(EDITABLE_KINDS).map(kind => <option key={kind} value={kind}>{kind.replace('_', ' ')}</option>)}
        </select>
        <select aria-label="Linked Atlas action" className="input-field min-h-11 text-sm" value={item.source_action_id} onChange={event => {
          const action = actions.find(candidate => candidate.id === event.target.value);
          onChange({ source_action_id: event.target.value, title: action?.title || item.title, action: action || null });
        }}>
          <option value="">{actionRequired ? 'Choose linked action' : 'No linked action'}</option>
          {actions.map(action => <option key={action.id} value={action.id}>{action.title}</option>)}
        </select>
        <input aria-label="Plan date" className="input-field min-h-11 text-sm" type="date" value={item.plan_date} onChange={event => onChange({ plan_date: event.target.value })} />
        <button type="button" className="btn-ghost min-h-11 text-danger" onClick={onRemove} aria-label={`Remove ${item.title || 'weekly item'}`}>Remove</button>
      </div>
      <input aria-label="Weekly item title" className="input-field mt-2 min-h-11 w-full text-sm" value={item.title} onChange={event => onChange({ title: event.target.value })} placeholder="Outcome or note" />
      <textarea aria-label="Weekly item notes" className="input-field mt-2 min-h-24 w-full text-sm leading-6" value={item.notes} onChange={event => onChange({ notes: event.target.value })} placeholder="Notes or rationale" />
      {actionRequired && !item.source_action_id && <p className="mt-2 text-sm text-danger" role="alert">Choose an Atlas action before saving this item.</p>}
    </div>
  );
}

function SupportingSection({ kind, items, editing, actions, onChangeItem, onRemoveItem, onSelectAction }) {
  const [isOpen, setIsOpen] = useState(kind !== 'context');

  useEffect(() => {
    if (editing) setIsOpen(true);
  }, [editing]);

  return (
    <details
      className="card group overflow-hidden"
      open={editing || isOpen}
      onToggle={event => {
        if (!editing) setIsOpen(event.currentTarget.open);
      }}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-text-primary">{KIND_LABELS[kind] || kind}</span>
        <span className="text-sm text-text-muted">{items.length}</span>
        <ChevronDown className="ml-auto h-4 w-4 text-text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
        {items.map(item => (
          <ItemCard
            key={item.id || item.title}
            item={item}
            editing={editing}
            actions={actions}
            onChange={changes => onChangeItem(item, changes)}
            onRemove={() => onRemoveItem(item)}
            onSelectAction={onSelectAction}
          />
        ))}
      </div>
    </details>
  );
}

export default function WeekPage({ weekStart, onNavigateWeek, onSelectAction }) {
  const queryClient = useQueryClient();
  const [revisionId, setRevisionId] = useState(null);
  const { data, isLoading, isError, error } = useWeekPlan(weekStart, revisionId);
  const actionsQuery = useActions({ status: 'not_started,in_progress,waiting,blocked,todo,open', sort_by: 'priority', sort_dir: 'asc', limit: 200 });
  const saveMutation = useSaveWeekPlan(weekStart);
  const reviewMutation = useRequestWeekReview(weekStart);
  const publishMutation = usePublishWeekPlan(weekStart);
  const forkMutation = useForkWeekPlan(weekStart);
  const createMutation = useMutation({
    mutationFn: () => weeksApi.createDraft({ week_start: weekStart, title: `Week of ${formatDateLong(weekStart)}`, idempotency_key: `atlas-week-${weekStart}` }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['weekPlan', weekStart] }),
  });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [items, setItems] = useState([]);
  const [calendarAcknowledged, setCalendarAcknowledged] = useState(false);
  const [notice, setNotice] = useState('');

  const source = data?.selected_revision || data?.draft || data?.published;
  const activeDraft = data?.draft;
  const viewingHistory = Boolean(data?.selected_revision
    && data.selected_revision.id !== data?.published?.id
    && data.selected_revision.id !== data?.draft?.id);
  const editable = !viewingHistory && Boolean(activeDraft) && ['draft', 'review_requested'].includes(activeDraft.status);
  const actions = Array.isArray(actionsQuery.data) ? actionsQuery.data : [];
  const actionOptions = useMemo(() => {
    const byId = new Map(actions.map(action => [String(action.id), action]));
    items.forEach(item => { if (item.action?.id) byId.set(String(item.action.id), item.action); });
    return Array.from(byId.values());
  }, [actions, items]);
  const dates = useMemo(() => getPacificWeekDates(weekStart), [weekStart]);
  const isStaleCalendar = Boolean(data?.diagnostics?.stale_calendar);

  useEffect(() => {
    setRevisionId(null);
  }, [weekStart]);

  useEffect(() => {
    setEditing(false);
    setTitle(source?.title || '');
    setSummary(source?.summary || '');
    setItems(cloneItems(source?.items || []));
    setCalendarAcknowledged(Boolean(source?.calendar_acknowledged));
    setNotice('');
  }, [source?.id, source?.revision]);

  const dayBuckets = useMemo(() => dates.map(date => ({
    date,
    items: items.filter(item => item.plan_date === date),
    commitments: source?.commitments?.filter(commitment => {
      if (!commitment.starts_at) return false;
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(commitment.starts_at));
      const parsed = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${parsed.year}-${parsed.month}-${parsed.day}` === date;
    }) || [],
  })), [dates, items, source?.commitments]);
  const supportingSections = useMemo(() => SUPPORTING_KINDS.map(kind => ({
    kind,
    items: items.filter(item => item.kind === kind && !item.plan_date),
  })).filter(section => section.items.length > 0), [items]);

  function updateItem(index, changes) {
    setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
  }

  function addItem() {
    setItems(current => [...current, { kind: 'day_focus', plan_date: weekStart, rank: current.length, source_action_id: '', title: '', notes: '', rationale: '', action: null }]);
  }

  function startEditing() {
    if (viewingHistory) return;
    if (data?.published && !data?.draft) {
      forkMutation.mutate({ id: data.published.id }, {
        onSuccess: () => setNotice('A new editable draft is being prepared from the published version.'),
        onError: mutationError => setNotice(mutationError.message),
      });
      return;
    }
    setEditing(true);
  }

  function payload() {
    return {
      title,
      summary,
      expected_revision: source.revision,
      calendar_acknowledged: calendarAcknowledged,
      source_coverage: source.source_coverage || {},
      idempotency_key: crypto.randomUUID(),
      items: items.map(({ action, action_current_as_of, id, ...item }) => item),
      commitments: source.commitments || [],
    };
  }

  function save() {
    saveMutation.mutate({ id: source.id, ...payload() }, {
      onSuccess: () => { setEditing(false); setNotice('Draft saved.'); },
      onError: mutationError => setNotice(mutationError.message),
    });
  }

  function requestReview() {
    reviewMutation.mutate({ id: source.id, expected_revision: source.revision, idempotency_key: crypto.randomUUID() }, {
      onSuccess: () => { setEditing(false); setNotice('Weekly plan sent to Atlas Review.'); },
      onError: mutationError => setNotice(mutationError.message),
    });
  }

  function publish() {
    if (isStaleCalendar && !calendarAcknowledged && !window.confirm('Calendar coverage is stale or partial. Publish this reviewed plan anyway?')) return;
    if (!window.confirm(`Publish Week ${formatDateLong(weekStart)}? This freezes the reviewed arrangement as the canonical version.`)) return;
    publishMutation.mutate({ id: source.id, expected_revision: source.revision, calendar_acknowledged: calendarAcknowledged || isStaleCalendar, idempotency_key: crypto.randomUUID() }, {
      onSuccess: () => { setEditing(false); setNotice('Weekly plan published.'); },
      onError: mutationError => setNotice(mutationError.message),
    });
  }

  if (isLoading) return <div className="mx-auto max-w-7xl space-y-4" aria-label="Loading weekly plan"><div className="h-24 animate-pulse rounded-xl bg-bg-surface" /><div className="h-64 animate-pulse rounded-xl bg-bg-surface" /></div>;
  if (isError) return <div className="mx-auto max-w-3xl rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger" role="alert">{error?.message || 'The weekly plan could not be loaded.'}</div>;

  const status = source?.status;
  const reviewRequested = status === 'review_requested';
  const published = status === 'published';
  const noPlan = !source;
  const planSummary = summary || source?.summary || 'No weekly summary yet.';

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="label mb-1">Atlas Week · Pacific time</p>
          <h1 className="text-xl font-semibold leading-tight text-text-primary sm:text-2xl">{formatDateLong(weekStart)} – {formatDateLong(addISODate(weekStart, 6))}</h1>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Week navigation">
          <button type="button" className="btn-secondary flex min-h-11 items-center gap-2" onClick={() => onNavigateWeek(addISODate(weekStart, -7))} aria-label="Previous week"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Previous</button>
          <button type="button" className="btn-secondary min-h-11" onClick={() => onNavigateWeek(addISODate(weekStart, 7))}>Next<ArrowRight className="ml-2 inline h-4 w-4" aria-hidden="true" /></button>
          {source && <span className="badge border-border bg-bg-surface text-text-secondary">{statusLabel(status)}</span>}
        </nav>
      </header>

      {notice && <div className="rounded-lg border border-accent/30 bg-accent-muted px-4 py-3 text-sm text-text-primary" role="status">{notice}</div>}
      {data?.diagnostics?.missing_actions?.length > 0 && <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm leading-5 text-danger" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />Some source tasks are unavailable. Their saved weekly notes remain readable, but the links need repair.</div>}
      {isStaleCalendar && <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm leading-5 text-text-secondary"><Clock3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />Calendar coverage is partial or stale. Review the captured commitments before publishing.</div>}

      {noPlan ? (
        <div className="rounded-xl border border-dashed border-border bg-bg-surface p-10 text-center">
          <CalendarDays className="mx-auto mb-3 h-8 w-8 text-text-muted" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-text-primary">No weekly plan yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-text-secondary">Create a draft for this Monday, then add the outcomes and commitments that matter.</p>
          <button type="button" className="btn-primary mt-5 min-h-11" onClick={() => createMutation.mutate(undefined, { onError: mutationError => setNotice(mutationError.message) })} disabled={createMutation.isPending}><Plus className="mr-2 inline h-4 w-4" aria-hidden="true" />{createMutation.isPending ? 'Creating draft…' : 'Create weekly draft'}</button>
        </div>
      ) : (
        <>
          {data?.history?.length > 1 && (
            <details className="card group overflow-hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-text-secondary [&::-webkit-details-marker]:hidden">
                <History className="h-4 w-4 text-text-muted" aria-hidden="true" />
                <span className="font-semibold">Plan history</span>
                <span className="text-text-muted">v{source.version} · {statusLabel(source.status)}</span>
                <ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                {data.history.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={`min-h-10 rounded-full border px-3 py-2 text-sm ${String(entry.id) === String(source.id) ? 'border-accent/50 bg-accent-muted text-accent' : 'border-border text-text-secondary hover:text-text-primary'}`}
                    onClick={() => { setRevisionId(entry.id); setEditing(false); }}
                    aria-pressed={String(entry.id) === String(source.id)}
                  >
                    v{entry.version} · {statusLabel(entry.status)}
                  </button>
                ))}
                {viewingHistory && <button type="button" className="btn-ghost ml-auto min-h-10" onClick={() => setRevisionId(null)}>Return to current plan</button>}
              </div>
            </details>
          )}
          <section className="card p-4 sm:p-5" aria-labelledby="weekly-plan-heading">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                {editing ? <input id="weekly-plan-heading" aria-label="Weekly plan title" className="input-field min-h-11 w-full text-lg font-semibold" value={title} onChange={event => setTitle(event.target.value)} placeholder="Weekly plan title" /> : <h2 id="weekly-plan-heading" className="text-lg font-semibold leading-7 text-text-primary sm:text-xl">{title || source.title || 'Weekly operating plan'}</h2>}
                {editing ? <textarea aria-label="Weekly plan summary" className="input-field mt-3 min-h-28 w-full text-sm leading-6" value={summary} onChange={event => setSummary(event.target.value)} placeholder="What makes this week successful?" /> : <p className="mt-2 max-w-4xl text-sm leading-6 text-text-secondary">{planSummary}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!editing && editable && <button type="button" className="btn-secondary flex min-h-11 items-center gap-2" onClick={startEditing}><Edit3 className="h-4 w-4" aria-hidden="true" />Edit plan</button>}
                {!editing && published && !viewingHistory && <button type="button" className="btn-secondary flex min-h-11 items-center gap-2" onClick={startEditing} disabled={forkMutation.isPending}><Copy className="h-4 w-4" aria-hidden="true" />{forkMutation.isPending ? 'Preparing draft…' : 'Edit as draft'}</button>}
                {editing && <button type="button" className="btn-secondary flex min-h-11 items-center gap-2" onClick={() => setEditing(false)}><Lock className="h-4 w-4" aria-hidden="true" />Stop editing</button>}
                {editing && <button type="button" className="btn-primary flex min-h-11 items-center gap-2" onClick={save} disabled={saveMutation.isPending}><Save className="h-4 w-4" aria-hidden="true" />{saveMutation.isPending ? 'Saving draft…' : 'Save draft'}</button>}
                {!editing && status === 'draft' && !viewingHistory && <button type="button" className="btn-primary flex min-h-11 items-center gap-2" onClick={requestReview} disabled={reviewMutation.isPending}><Send className="h-4 w-4" aria-hidden="true" />{reviewMutation.isPending ? 'Requesting review…' : 'Request review'}</button>}
                {!editing && reviewRequested && !viewingHistory && <button type="button" className="btn-primary flex min-h-11 items-center gap-2" onClick={publish} disabled={publishMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{publishMutation.isPending ? 'Publishing…' : 'Publish plan'}</button>}
              </div>
            </div>
            {editing && <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between"><button type="button" className="btn-ghost flex min-h-11 items-center gap-2" onClick={addItem}><Plus className="h-4 w-4" aria-hidden="true" />Add weekly item</button>{isStaleCalendar && <label className="flex min-h-11 items-center gap-3 text-sm text-text-secondary"><input className="h-5 w-5" type="checkbox" checked={calendarAcknowledged} onChange={event => setCalendarAcknowledged(event.target.checked)} />I reviewed the calendar warning</label>}</div>}
          </section>

          <section aria-labelledby="must-wins-heading" className="card p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-accent" aria-hidden="true" /><h2 id="must-wins-heading" className="text-lg font-semibold text-text-primary">Must-win outcomes</h2></div>
            <div className="grid gap-4 lg:grid-cols-2">{items.filter(item => item.kind === 'must_win').map((item, index) => <ItemCard key={item.id || `must-${index}`} item={item} editing={editing} actions={actionOptions} onChange={changes => updateItem(items.indexOf(item), changes)} onRemove={() => setItems(current => current.filter(candidate => candidate !== item))} onSelectAction={onSelectAction} />)}{items.filter(item => item.kind === 'must_win').length === 0 && <p className="text-sm leading-6 text-text-muted">No must-win outcomes selected.</p>}</div>
          </section>

          <section aria-labelledby="week-lanes-heading">
            <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-accent" aria-hidden="true" /><h2 id="week-lanes-heading" className="text-lg font-semibold text-text-primary">Daily focus and commitments</h2></div><span className="text-sm text-text-muted">{dates.length} days</span></div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {dayBuckets.map((day, dayIndex) => (
                <section key={day.date} className="card min-w-0 p-4" aria-labelledby={`week-day-${day.date}`}>
                  <div className="mb-4 flex items-center justify-between gap-3"><div><h3 id={`week-day-${day.date}`} className="text-sm font-semibold text-text-primary">{DAY_NAMES[dayIndex]}</h3><p className="mt-0.5 text-sm text-text-muted">{formatDate(day.date)}</p></div>{day.date === addISODate(weekStart, 0) && <span className="badge border-accent/30 bg-accent-muted text-accent">Week start</span>}</div>
                  <div className="space-y-2">{day.items.map(item => <ItemCard key={item.id || `${day.date}-${item.rank}`} item={item} editing={editing} actions={actionOptions} onChange={changes => updateItem(items.indexOf(item), changes)} onRemove={() => setItems(current => current.filter(candidate => candidate !== item))} onSelectAction={onSelectAction} />)}{day.commitments.map(commitment => <CommitmentCard key={commitment.id || commitment.source_ref} commitment={commitment} />)}{day.items.length === 0 && day.commitments.length === 0 && <p className="py-5 text-center text-xs text-text-muted">Open</p>}</div>
                </section>
              ))}
            </div>
          </section>

          {supportingSections.length > 0 && (
            <section aria-labelledby="supporting-details-heading">
              <h2 id="supporting-details-heading" className="mb-4 text-lg font-semibold text-text-primary">Supporting details</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {supportingSections.map(({ kind, items: sectionItems }) => {
                  return (
                    <SupportingSection
                      key={kind}
                      kind={kind}
                      items={sectionItems}
                      editing={editing}
                      actions={actionOptions}
                      onChangeItem={(item, changes) => updateItem(items.indexOf(item), changes)}
                      onRemoveItem={item => setItems(current => current.filter(candidate => candidate !== item))}
                      onSelectAction={onSelectAction}
                    />
                  );
                })}
              </div>
            </section>
          )}

          <p className="flex items-center gap-2 text-sm text-text-muted"><History className="h-4 w-4" aria-hidden="true" />Version {source.version}. Published versions remain available in Plan history.</p>
        </>
      )}
    </div>
  );
}
