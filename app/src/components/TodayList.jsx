import React, { useMemo } from 'react';
import { Clock, Info, ListTodo } from 'lucide-react';
import { useTodayPlan } from '../hooks/useTodayPlan.js';
import { useMembers } from '../hooks/useMembers.js';
import { PriorityBadge, BusinessBadge, StatusBadge } from './StatusBadge.jsx';
import OwnerAvatars from './OwnerAvatars.jsx';
import { formatRelativeDate, getISODate } from '../utils/dateUtils.js';
import { parseJsonArray } from '../utils/parseUtils.js';

function todayDateString() {
  return getISODate();
}

const HIDDEN_TODAY_STATUSES = new Set(['done', 'closed', 'cancelled', 'archived']);

function getAction(item) {
  return item.action || item;
}

function taskReason(item, action) {
  if (item.reason) return item.reason;
  if (action.due_date === todayDateString()) return 'Due today.';
  if (action.due_date && action.due_date < todayDateString()) return 'Overdue and still open.';
  return 'Selected for today.';
}

function TodayTask({ item, members, onSelectAction }) {
  const action = getAction(item);
  const owners = parseJsonArray(action.owners);

  return (
    <div className="rounded-lg border border-border bg-bg-surface px-4 py-3 transition-colors hover:border-border-hover">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onSelectAction(action.id)}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <PriorityBadge priority={action.priority} />
            <StatusBadge status={action.status} />
            <BusinessBadge business={action.business} />
            {item.estimated_effort && (
              <span className="badge text-text-muted border-border bg-bg-primary">
                <Clock className="mr-1 h-3 w-3" />
                {item.estimated_effort}
              </span>
            )}
          </div>

          <p className="mt-2 text-sm font-semibold leading-snug text-text-primary">
            {item.title || action.title}
          </p>
          {(item.summary || action.next_action || action.description) && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">
              {item.summary || action.next_action || action.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
            {action.due_date && <span>{formatRelativeDate(action.due_date)}</span>}
            <span>{taskReason(item, action)}</span>
            <OwnerAvatars owners={owners} members={members} max={3} size="xs" />
          </div>
        </button>
      </div>
    </div>
  );
}

export default function TodayList({ selectedBusiness, onSelectAction, searchQuery = '' }) {
  const today = todayDateString();
  const { data, isLoading, isError, error } = useTodayPlan(today);
  const membersQuery = useMembers();
  const rawMembers = membersQuery.data || [];
  const members = Array.isArray(rawMembers) ? rawMembers : [];

  const items = useMemo(() => {
    const rawItems = Array.isArray(data?.items) ? data.items : [];
    return rawItems
      .filter((item) => {
        const action = getAction(item);
        if (!action?.id) return false;
        if (HIDDEN_TODAY_STATUSES.has(String(action.status || '').toLowerCase())) return false;
        if (selectedBusiness && action.business !== selectedBusiness) return false;
        if (!searchQuery) return true;
        const haystack = `${item.title || ''} ${item.summary || ''} ${action.title || ''} ${action.description || ''}`.toLowerCase();
        return haystack.includes(searchQuery.toLowerCase());
      })
      .slice(0, 5);
  }, [data?.items, selectedBusiness, searchQuery]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        {[1, 2, 3].map((key) => (
          <div key={key} className="h-24 animate-pulse rounded-lg bg-bg-surface" />
        ))}
      </div>
    );
  }

  if (isError || membersQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger" role="alert">
        {error?.message || membersQuery.error?.message || 'Today could not load.'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="label mb-1">Atlas Today</p>
          <h1 className="text-xl font-semibold text-text-primary">Today’s tasks</h1>
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
      </div>

      {data?.source === 'due_date_fallback' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-muted">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>No selected daily plan was available, so Atlas is showing open work due today or earlier.</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-surface p-8 text-center">
          <ListTodo className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="text-sm font-semibold text-text-primary">No tasks selected for today.</p>
          <p className="mt-1 text-sm text-text-muted">All Tasks and Kanban still hold the full backlog.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <TodayTask
              key={item.id || item.source_action_id}
              item={item}
              members={members}
              onSelectAction={onSelectAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
