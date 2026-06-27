import React, { useMemo } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ClipboardCheck, Info } from 'lucide-react';
import { useTodayPlan } from '../hooks/useTodayPlan.js';
import { useActions } from '../hooks/useActions.js';
import { useMembers } from '../hooks/useMembers.js';
import { PriorityBadge, BusinessBadge, StatusBadge, WorkModeBadge } from './StatusBadge.jsx';
import OwnerAvatars from './OwnerAvatars.jsx';
import { formatRelativeDate, getISODate } from '../utils/dateUtils.js';
import { parseJsonArray } from '../utils/parseUtils.js';

const NON_DONE_STATUSES = 'not_started,in_progress,waiting,blocked,todo,open';

function getAction(item) {
  return item.action || item;
}

function todayDateString() {
  return getISODate();
}

function matchesScope(action, selectedBusiness, searchQuery) {
  if (!action?.id) return false;
  if (selectedBusiness && action.business !== selectedBusiness) return false;
  if (!searchQuery) return true;
  const haystack = `${action.title || ''} ${action.description || ''} ${action.next_action || ''}`.toLowerCase();
  return haystack.includes(searchQuery.toLowerCase());
}

function ActionRow({ action, members, onSelectAction }) {
  const owners = parseJsonArray(action.owners);

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-lg border border-border bg-bg-surface px-3 py-3 text-left transition-colors hover:border-border-hover"
      onClick={() => onSelectAction(action.id)}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={action.priority} />
          <StatusBadge status={action.status} />
          <BusinessBadge business={action.business} />
          <WorkModeBadge workMode={action.work_mode} />
        </div>
        <p className="text-sm font-semibold leading-snug text-text-primary">{action.title}</p>
        {(action.next_action || action.description) && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">
            {action.next_action || action.description}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
          {action.due_date && <span>{formatRelativeDate(action.due_date)}</span>}
          <OwnerAvatars owners={owners} members={members} max={3} size="xs" />
        </div>
      </div>
    </button>
  );
}

function ReviewSection({ icon: Icon, title, count, empty, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-surface px-3 py-4 text-sm text-text-muted">
          {empty}
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

export default function TodayReview({ selectedBusiness, onSelectAction, searchQuery = '' }) {
  const today = todayDateString();
  const { data: todayData } = useTodayPlan(today);
  const { data: rawMembers = [] } = useMembers();
  const { data: rawReviewActions = [] } = useActions({
    status: NON_DONE_STATUSES,
    work_mode: 'review_required',
    ...(selectedBusiness ? { business: selectedBusiness } : {}),
  });
  const { data: rawAssistantActions = [] } = useActions({
    status: NON_DONE_STATUSES,
    owner_id: 'codex',
    ...(selectedBusiness ? { business: selectedBusiness } : {}),
  });
  const { data: rawBlockedActions = [] } = useActions({
    status: 'blocked',
    ...(selectedBusiness ? { business: selectedBusiness } : {}),
  });

  const members = Array.isArray(rawMembers) ? rawMembers : [];

  const completedToday = useMemo(() => {
    const rawItems = Array.isArray(todayData?.items) ? todayData.items : [];
    return rawItems
      .map(getAction)
      .filter((action) => String(action?.status || '').toLowerCase() === 'done')
      .filter((action) => matchesScope(action, selectedBusiness, searchQuery));
  }, [todayData?.items, selectedBusiness, searchQuery]);

  const reviewActions = useMemo(() => (
    (Array.isArray(rawReviewActions) ? rawReviewActions : [])
      .filter((action) => matchesScope(action, selectedBusiness, searchQuery))
      .filter((action) => String(action.status || '').toLowerCase() !== 'blocked')
      .slice(0, 8)
  ), [rawReviewActions, selectedBusiness, searchQuery]);

  const assistantActions = useMemo(() => (
    (Array.isArray(rawAssistantActions) ? rawAssistantActions : [])
      .filter((action) => matchesScope(action, selectedBusiness, searchQuery))
      .filter((action) => String(action.status || '').toLowerCase() !== 'blocked')
      .filter((action) => action.work_mode !== 'review_required')
      .slice(0, 8)
  ), [rawAssistantActions, selectedBusiness, searchQuery]);

  const blockedActions = useMemo(() => (
    (Array.isArray(rawBlockedActions) ? rawBlockedActions : [])
      .filter((action) => matchesScope(action, selectedBusiness, searchQuery))
      .slice(0, 8)
  ), [rawBlockedActions, selectedBusiness, searchQuery]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="label mb-1">Nightly review</p>
          <h1 className="text-xl font-semibold text-text-primary">Review queue</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Completed plan items, owner decisions, assistant-owned work, and blocked work live here instead of Today.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-xs text-text-muted">
          Plan: {todayData?.plan ? 'daily plan loaded' : 'fallback or no daily plan'}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ReviewSection
          icon={CheckCircle2}
          title="Completed from Today"
          count={completedToday.length}
          empty="No completed Today items are waiting here."
        >
          {completedToday.map((action) => (
            <ActionRow key={action.id} action={action} members={members} onSelectAction={onSelectAction} />
          ))}
        </ReviewSection>

        <ReviewSection
          icon={ClipboardCheck}
          title="Needs your review"
          count={reviewActions.length}
          empty="No review-required actions match this scope."
        >
          {reviewActions.map((action) => (
            <ActionRow key={action.id} action={action} members={members} onSelectAction={onSelectAction} />
          ))}
        </ReviewSection>

        <ReviewSection
          icon={Bot}
          title="Assistant-owned"
          count={assistantActions.length}
          empty="No Codex-owned actions match this scope."
        >
          {assistantActions.map((action) => (
            <ActionRow key={action.id} action={action} members={members} onSelectAction={onSelectAction} />
          ))}
        </ReviewSection>

        <ReviewSection
          icon={AlertTriangle}
          title="Blocked"
          count={blockedActions.length}
          empty="No blocked actions match this scope."
        >
          {blockedActions.map((action) => (
            <ActionRow key={action.id} action={action} members={members} onSelectAction={onSelectAction} />
          ))}
        </ReviewSection>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-muted">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>Use All Tasks for the full backlog. This page is a bounded review surface.</span>
      </div>
    </div>
  );
}
