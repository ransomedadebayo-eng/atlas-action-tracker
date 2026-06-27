import React, { useMemo } from 'react'
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  Info,
  ListFilter,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useTodayPlan } from '../hooks/useTodayPlan.js'

function getTodayFormatted() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function labelize(value) {
  return String(value || 'unknown').replace(/_/g, ' ')
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function sourceCoverageEntries(plan) {
  const coverage = plan?.source_coverage && typeof plan.source_coverage === 'object'
    ? plan.source_coverage
    : {}

  return Object.entries(coverage).map(([key, value]) => ({
    key,
    value: String(value),
  }))
}

function toneForStatus(status) {
  switch (status) {
    case 'selected':
      return {
        icon: CheckCircle2,
        label: 'Do today',
        color: '#86efac',
        bg: 'rgba(22, 101, 52, 0.18)',
        border: 'rgba(134, 239, 172, 0.18)',
      }
    case 'review':
      return {
        icon: ShieldCheck,
        label: 'Review',
        color: '#fcd34d',
        bg: 'rgba(113, 63, 18, 0.22)',
        border: 'rgba(252, 211, 77, 0.18)',
      }
    case 'suppressed':
      return {
        icon: Eye,
        label: 'Hidden',
        color: '#94a3b8',
        bg: 'rgba(15, 23, 42, 0.32)',
        border: 'rgba(148, 163, 184, 0.14)',
      }
    default:
      return {
        icon: ListFilter,
        label: 'Not today',
        color: '#c4b5fd',
        bg: 'rgba(76, 29, 149, 0.18)',
        border: 'rgba(196, 181, 253, 0.14)',
      }
  }
}

function ItemBadge({ children, tone = 'neutral' }) {
  const classes = {
    neutral: 'border-white/10 bg-white/[0.04] text-white/60',
    good: 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100',
    warn: 'border-amber-300/20 bg-amber-500/10 text-amber-100',
    muted: 'border-white/10 bg-black/10 text-white/45',
  }

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium ${classes[tone] ?? classes.neutral}`}>
      {children}
    </span>
  )
}

function PlanItem({ item, onSelectAction }) {
  const tone = toneForStatus(item.item_status)
  const Icon = tone.icon
  const matchedRules = safeArray(item.matched_rules)
  const evidence = item.source_evidence && typeof item.source_evidence === 'object' ? item.source_evidence : {}
  const canOpenAction = Boolean(item.source_action_id && onSelectAction)

  return (
    <article
      className="rounded-lg border p-4 transition-colors hover:border-white/20"
      style={{ backgroundColor: tone.bg, borderColor: tone.border }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ItemBadge tone={item.item_status === 'selected' ? 'good' : item.item_status === 'review' ? 'warn' : 'muted'}>
              <Icon className="mr-1.5 h-3.5 w-3.5" style={{ color: tone.color }} />
              {tone.label}
            </ItemBadge>
            <ItemBadge>{item.estimated_effort || 'Effort not set'}</ItemBadge>
            <ItemBadge>{labelize(item.source_confidence)} confidence</ItemBadge>
            {item.review_gate ? <ItemBadge tone="warn">{labelize(item.review_gate)}</ItemBadge> : null}
          </div>

          <h2 className="mt-3 break-words text-base font-semibold leading-6 text-white">
            {item.title}
          </h2>
          {item.summary ? (
            <p className="mt-2 max-w-[78ch] break-words text-sm leading-6 text-white/62">
              {item.summary}
            </p>
          ) : null}

          <div className="mt-4 rounded-md border border-white/10 bg-black/10 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-white/75">
              <Info className="h-3.5 w-3.5 text-accent" />
              Why this is here
            </p>
            <p className="mt-2 break-words text-sm leading-6 text-white/58">{item.reason}</p>
          </div>

          {matchedRules.length ? (
            <details className="mt-3 rounded-md border border-white/10 bg-black/10 p-3">
              <summary className="cursor-pointer list-none text-xs font-semibold text-white/70">
                Matched rules
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {matchedRules.map((rule) => (
                  <ItemBadge key={rule} tone="muted">{rule}</ItemBadge>
                ))}
              </div>
            </details>
          ) : null}
        </div>

        <aside className="w-full shrink-0 rounded-md border border-white/10 bg-black/10 p-3 lg:w-64">
          <p className="text-xs font-semibold text-white/65">Score</p>
          <p className="mt-1 font-mono text-3xl font-semibold text-white">{item.score ?? 0}</p>
          <dl className="mt-4 space-y-2 text-xs">
            {Object.entries(evidence).slice(0, 5).map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3">
                <dt className="text-white/35">{labelize(key)}</dt>
                <dd className="min-w-0 break-words text-right text-white/65">{String(value ?? 'none')}</dd>
              </div>
            ))}
          </dl>
          {canOpenAction ? (
            <button
              className="btn-secondary mt-4 w-full"
              onClick={() => onSelectAction(item.source_action_id)}
            >
              Open action
            </button>
          ) : null}
        </aside>
      </div>
    </article>
  )
}

function Section({ title, description, items, empty, onSelectAction }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 max-w-[72ch] text-sm leading-6 text-white/45">{description}</p>
        </div>
        <ItemBadge>{items.length} items</ItemBadge>
      </div>
      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <PlanItem key={item.id ?? `${item.source_action_id}-${item.item_status}-${item.rank}`} item={item} onSelectAction={onSelectAction} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 p-5 text-sm text-white/45">
          {empty}
        </div>
      )}
    </section>
  )
}

function RulesPanel({ rules, ruleVersion }) {
  const snapshotRules = safeArray(ruleVersion?.rules_snapshot)
  const activeRules = safeArray(rules).length ? safeArray(rules) : snapshotRules

  return (
    <details className="rounded-lg border border-white/10 bg-bg-elevated/70 p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <SlidersHorizontal className="h-4 w-4 text-accent" />
          Rule explanation
        </span>
        <span className="text-xs text-white/40">
          {ruleVersion?.version_label ?? 'dry-run rules'}
        </span>
      </summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {activeRules.slice(0, 12).map((rule) => (
          <div key={rule.id ?? rule.rule_key} className="rounded-md border border-white/10 bg-black/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <ItemBadge>{labelize(rule.rule_type)}</ItemBadge>
              <ItemBadge tone="muted">{labelize(rule.category)}</ItemBadge>
              {typeof rule.weight === 'number' ? <ItemBadge tone="muted">weight {rule.weight}</ItemBadge> : null}
            </div>
            <p className="mt-3 text-sm font-semibold text-white">{rule.name ?? rule.rule_key}</p>
            <p className="mt-2 text-xs leading-5 text-white/48">{rule.rationale || rule.description || 'No rationale recorded.'}</p>
          </div>
        ))}
      </div>
    </details>
  )
}

export default function TodayDashboard({ onSelectAction }) {
  const { data, isLoading, error } = useTodayPlan()

  const groups = useMemo(() => {
    const items = safeArray(data?.items)
    return {
      selected: items.filter((item) => item.item_status === 'selected' && !item.review_gate),
      review: items.filter((item) => item.item_status === 'review' || item.review_gate),
      notToday: items.filter((item) => item.item_status === 'deferred' || item.item_status === 'suppressed'),
    }
  }, [data])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-2 py-6 md:px-6 md:py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded-lg bg-white/5" />
          <div className="h-20 rounded-lg bg-white/5" />
          <div className="h-32 rounded-lg bg-white/5" />
          <div className="h-32 rounded-lg bg-white/5" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-2 py-8 md:px-6">
        <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-red-300" />
            <div>
              <h1 className="text-base font-semibold text-white">Today plan could not load</h1>
              <p className="mt-2 text-sm leading-6 text-red-100/70">{error.message}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const plan = data?.plan ?? {}
  const coverage = sourceCoverageEntries(plan)
  const source = data?.source === 'daily_plan' ? 'Nightly plan' : 'Dry-run preview'
  const selectedCount = groups.selected.length

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-2 py-6 md:px-6 md:py-8">
      <header className="space-y-5">
        <div>
          <p className="text-sm text-white/42">{getGreeting()}</p>
          <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white md:text-3xl">
                {getTodayFormatted()}
              </h1>
              <p className="mt-2 max-w-[76ch] text-sm leading-6 text-white/52">
                {plan.summary || `${selectedCount} selected by the current Atlas Today rules.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ItemBadge tone={data?.source === 'daily_plan' ? 'good' : 'warn'}>{source}</ItemBadge>
              <ItemBadge>{labelize(plan.readiness_profile?.level ?? 'steady')}</ItemBadge>
              <ItemBadge>{plan.selected_capacity ?? selectedCount} capacity</ItemBadge>
            </div>
          </div>
        </div>

        {data?.warning ? (
          <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
            {data.warning}
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[1fr_0.72fr]">
          <div className="rounded-lg border border-white/10 bg-bg-elevated/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ClipboardList className="h-4 w-4 text-accent" />
              Why not everything
            </div>
            <p className="mt-2 text-sm leading-6 text-white/52">
              Today is a curated projection from Atlas, not the backlog. The rules select what fits the day and keep overflow in review context.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-bg-elevated/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <CalendarDays className="h-4 w-4 text-accent" />
              Source coverage
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {coverage.map((entry) => (
                <ItemBadge key={entry.key} tone={entry.value === 'unavailable' ? 'warn' : 'neutral'}>
                  {labelize(entry.key)}: {labelize(entry.value)}
                </ItemBadge>
              ))}
            </div>
          </div>
        </div>
      </header>

      <Section
        title="Do today"
        description="The owner-facing worklist selected by the active rule set and daily capacity cap."
        items={groups.selected}
        empty="No items were selected for today. Check rule coverage or run the nightly retriage."
        onSelectAction={onSelectAction}
      />

      <Section
        title="Review"
        description="Items with approval, finance, legal, identity, health, or other owner gates."
        items={groups.review}
        empty="No review-gated items are in the current plan."
        onSelectAction={onSelectAction}
      />

      <RulesPanel rules={data?.rules} ruleVersion={data?.rule_version} />

      <Section
        title="Not today"
        description="Deferred or suppressed work with the reason it stayed out of the owner worklist."
        items={groups.notToday}
        empty="Nothing was deferred or suppressed in the current plan."
        onSelectAction={onSelectAction}
      />
    </div>
  )
}
