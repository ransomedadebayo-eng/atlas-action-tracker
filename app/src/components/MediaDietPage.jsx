import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clock3,
  ExternalLink,
  Headphones,
  Music2,
  Podcast,
  RotateCcw,
  SkipForward,
  ThumbsDown,
  ThumbsUp,
  Youtube,
} from 'lucide-react'
import {
  useMediaPlan,
  useRecordMediaFeedback,
  useStartTwitterAllowance,
  useUpdateMediaStatus,
} from '../hooks/useMediaPlan.js'
import { addISODate, formatDateLong } from '../utils/dateUtils.js'

const PLATFORM_LABELS = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  apple_podcasts: 'Apple Podcasts',
  apple_music: 'Apple Music',
  other: 'Topic',
}

const TRIGGER_LABELS = {
  weekday_morning: 'Morning',
  daytime_transition_1: 'Around lunch',
  daytime_transition_2: 'Later afternoon',
  saturday_walk: 'Walk or drive',
  sunday_faith: 'Sunday quiet time',
  sunday_restoration: 'Sunday afternoon',
  flex: 'When it fits',
}

const FEEDBACK_LABELS = {
  helpful: 'Helpful',
  not_for_me: 'Not for me',
  led_to_drift: 'Led to drift',
}

function PlatformIcon({ platform, className = 'h-4 w-4' }) {
  if (platform === 'youtube') return <Youtube className={className} aria-hidden="true" />
  if (platform === 'apple_podcasts') return <Podcast className={className} aria-hidden="true" />
  if (platform === 'spotify' || platform === 'apple_music') return <Music2 className={className} aria-hidden="true" />
  return <Headphones className={className} aria-hidden="true" />
}

function dayLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}

function suggestedTime(item) {
  if (item?.eligible_from) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Los_Angeles',
    }).format(new Date(item.eligible_from))
  }
  return TRIGGER_LABELS[item?.trigger_kind] || 'When it fits'
}

function SourceLink({ item, compact = false }) {
  if (!item?.source_url) return null
  return (
    <a
      className={`${compact ? 'btn-ghost px-3' : 'btn-primary'} inline-flex min-h-11 items-center justify-center gap-2`}
      href={item.source_url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open source: ${item.title}`}
    >
      <ExternalLink className="h-4 w-4" aria-hidden="true" />
      {compact ? 'Open' : 'Open source'}
    </a>
  )
}

function ItemActions({ item, onStatus, isPending }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SourceLink item={item} />
      <button
        type="button"
        className="btn-secondary min-h-11"
        onClick={() => onStatus(item, 'done')}
        disabled={isPending}
        aria-label={`Mark done: ${item.title}`}
      >
        <Check className="mr-2 inline h-4 w-4" aria-hidden="true" />
        Done
      </button>
      <button
        type="button"
        className="btn-ghost min-h-11"
        onClick={() => onStatus(item, 'later')}
        disabled={isPending}
        aria-label={`Move later: ${item.title}`}
      >
        <Clock3 className="mr-2 inline h-4 w-4" aria-hidden="true" />
        Later
      </button>
      <button
        type="button"
        className="btn-ghost min-h-11 text-text-muted"
        onClick={() => onStatus(item, 'skipped')}
        disabled={isPending}
        aria-label={`Skip item: ${item.title}`}
      >
        <SkipForward className="mr-2 inline h-4 w-4" aria-hidden="true" />
        Skip
      </button>
    </div>
  )
}

function TodayPanel({ guidance, onStatus, isPending }) {
  const item = guidance?.item
  return (
    <section className="border-b border-border pb-7" aria-label="Today">
      <p className="text-sm font-medium text-accent">{guidance?.date ? dayLabel(guidance.date) : 'Today'}</p>
      <h1 className="mt-2 text-3xl font-semibold leading-10 text-text-primary">Today</h1>
      {guidance?.kind === 'item' && item ? (
        <div className="mt-6 max-w-3xl">
          <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
            <span className="inline-flex items-center gap-2">
              <PlatformIcon platform={item.platform} />
              {PLATFORM_LABELS[item.platform] || 'Media'}
            </span>
            {item.duration_minutes ? <span>{item.duration_minutes} min</span> : null}
            <span>Suggested: {suggestedTime(item)}</span>
          </div>
          <h2 className="mt-4 text-2xl font-semibold leading-8 text-text-primary [overflow-wrap:anywhere]">{item.title}</h2>
          {item.creator ? <p className="mt-1 text-sm text-text-secondary">{item.creator}</p> : null}
          <p className="mt-4 max-w-2xl text-base leading-7 text-text-secondary">{item.purpose}</p>
          <div className="mt-5 grid max-w-3xl gap-3 text-sm leading-6 sm:grid-cols-2">
            <p className="text-text-secondary"><span className="font-medium text-text-primary">Why:</span> {item.selection_reason}</p>
            <p className="text-text-secondary"><span className="font-medium text-text-primary">Stop:</span> {item.stop_rule}</p>
          </div>
          <div className="mt-6"><ItemActions item={item} onStatus={onStatus} isPending={isPending} /></div>
        </div>
      ) : guidance?.kind === 'complete' ? (
        <div className="mt-6 max-w-2xl">
          <h2 className="text-2xl font-semibold text-text-primary">Today’s choice is complete</h2>
          <p className="mt-2 text-base leading-7 text-text-secondary">Nothing else replaces it. The rest of the day stays open.</p>
        </div>
      ) : (
        <div className="mt-6 max-w-2xl">
          <h2 className="text-2xl font-semibold text-text-primary">No planned media today</h2>
          <p className="mt-2 text-base leading-7 text-text-secondary">Use the time for projects, family, or rest. Reset is available if you need it.</p>
        </div>
      )}
    </section>
  )
}

function DayRow({ day }) {
  const item = day.item
  const state = item?.status === 'done' ? 'Done' : item?.status === 'later' ? 'Later' : item?.status === 'skipped' ? 'Skipped' : day.is_today ? 'Today' : null
  return (
    <li className={`flex min-w-0 flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${day.is_today ? 'bg-accent-muted' : ''}`}>
      <div className="flex min-w-0 gap-3">
        <div className="w-24 flex-shrink-0">
          <p className="text-sm font-medium text-text-primary">{dayLabel(day.date).split(',')[0]}</p>
          <p className="mt-0.5 text-xs text-text-muted">{dayLabel(day.date).split(',').slice(1).join(',').trim()}</p>
        </div>
        {item ? (
          <div className="flex min-w-0 gap-2">
            <PlatformIcon platform={item.platform} className="mt-1 h-4 w-4 flex-shrink-0 text-text-muted" />
            <div className="min-w-0">
              <p className="font-medium leading-6 text-text-primary [overflow-wrap:anywhere]">{item.title}</p>
              <p className="mt-0.5 text-sm text-text-secondary">{item.creator || PLATFORM_LABELS[item.platform]}{item.duration_minutes ? ` · ${item.duration_minutes} min` : ''} · {suggestedTime(item)}</p>
            </div>
          </div>
        ) : (
          <div>
            <p className="font-medium leading-6 text-text-primary">{day.title}</p>
            <p className="mt-0.5 text-sm text-text-secondary">{day.reason}</p>
          </div>
        )}
      </div>
      <div className="flex min-h-11 flex-shrink-0 items-center gap-2 pl-0 sm:pl-3">
        {state ? <span className="badge border-border bg-bg-primary text-text-secondary">{state}</span> : null}
        {item && item.status === 'queued' ? <SourceLink item={item} compact /> : null}
      </div>
    </li>
  )
}

function ResetBar({ item }) {
  return (
    <section className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between" aria-label="Reset">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-muted text-accent">
          <RotateCcw className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-text-primary">Reset</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">{item?.purpose || 'Use one familiar screen-off choice when you need to settle.'}</p>
        </div>
      </div>
      <SourceLink item={item} compact />
    </section>
  )
}

function FeedbackPrompt({ item, mutation, onDone }) {
  function record(outcome) { mutation.mutate({ id: item.id, outcome }, { onSuccess: onDone }) }
  return (
    <section className="rounded-xl bg-accent-muted px-5 py-5" aria-label="Media usefulness feedback">
      <h2 className="font-semibold text-text-primary">Was that useful?</h2>
      <p className="mt-1 text-sm leading-6 text-text-secondary">One answer improves next Sunday’s choices.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary min-h-11" onClick={() => record('helpful')} disabled={mutation.isPending}><ThumbsUp className="mr-2 inline h-4 w-4" aria-hidden="true" />Helpful</button>
        <button type="button" className="btn-ghost min-h-11" onClick={() => record('not_for_me')} disabled={mutation.isPending}><ThumbsDown className="mr-2 inline h-4 w-4" aria-hidden="true" />Not for me</button>
        <button type="button" className="btn-ghost min-h-11" onClick={() => record('led_to_drift')} disabled={mutation.isPending}>Led to drift</button>
      </div>
    </section>
  )
}

function TwitterAllowance({ allowance, date, startMutation }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (allowance?.state !== 'active') return undefined
    const id = setInterval(() => setTick(value => value + 1), 30000)
    return () => clearInterval(id)
  }, [allowance?.state])
  if (!allowance || allowance.state === 'closed') return null
  const minutes = allowance.expires_at ? Math.max(0, Math.ceil((new Date(allowance.expires_at).valueOf() - Date.now()) / 60000)) : 0
  function startWindow() { startMutation.mutate({ date }, { onSuccess: () => window.open('https://x.com/home', '_blank', 'noopener,noreferrer') }) }
  return (
    <div className="border-t border-border pt-4">
      <p className="text-sm font-medium text-text-primary">X allowance</p>
      {allowance.state === 'available' ? <button type="button" className="btn-secondary mt-3 min-h-11" onClick={startWindow} disabled={startMutation.isPending}>Start 15-minute window</button> : allowance.state === 'active' ? <p className="mt-2 text-sm text-accent" role="timer">{minutes} minutes left</p> : <p className="mt-2 text-sm text-text-muted">Today’s window is complete.</p>}
    </div>
  )
}

function Loading() {
  return <div className="mx-auto max-w-5xl space-y-5" aria-label="Loading media plan"><div className="h-64 animate-pulse rounded-xl bg-bg-surface motion-reduce:animate-none" /><div className="h-96 animate-pulse rounded-xl bg-bg-surface motion-reduce:animate-none" /></div>
}

export default function MediaDietPage() {
  const query = useMediaPlan()
  const updateStatus = useUpdateMediaStatus()
  const feedbackMutation = useRecordMediaFeedback()
  const startTwitter = useStartTwitterAllowance()
  const [notice, setNotice] = useState('')
  const [feedbackItem, setFeedbackItem] = useState(null)
  const data = query.data
  const week = useMemo(() => data?.daily_map || [], [data?.daily_map])

  function setStatus(item, status) {
    setNotice('')
    updateStatus.mutate({ id: item.id, expected_revision: item.revision, status }, {
      onSuccess: () => {
        setNotice(status === 'done' ? 'Today’s choice is complete.' : status === 'later' ? 'Moved to Later.' : 'Skipped for this week.')
        if (status === 'done') setFeedbackItem(item)
      },
      onError: error => setNotice(error.message),
    })
  }

  if (query.isLoading) return <Loading />
  if (query.isError) return <div className="mx-auto max-w-3xl rounded-xl bg-danger/10 p-5 text-sm text-danger" role="alert">{query.error?.message || 'The media plan could not be loaded.'}</div>
  if (!data?.plan) return <div className="mx-auto max-w-3xl border-y border-border py-12 text-center"><Headphones className="mx-auto h-8 w-8 text-text-muted" aria-hidden="true" /><h1 className="mt-4 text-xl font-semibold text-text-primary">No weekly media map yet</h1><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-secondary">Sunday curation will prepare all seven days. Until then, choose projects, family, or rest.</p></div>

  return (
    <div className="mx-auto max-w-5xl space-y-6 view-transition">
      <header>
        <p className="text-sm font-medium text-accent">{formatDateLong(data.week_start)} to {formatDateLong(addISODate(data.week_start, 6))}</p>
      </header>

      <TodayPanel guidance={data.today_guidance} onStatus={setStatus} isPending={updateStatus.isPending} />

      {notice ? <div className="rounded-lg bg-accent-muted px-4 py-3 text-sm text-text-primary" role="status">{notice}</div> : null}
      {feedbackItem ? <FeedbackPrompt item={feedbackItem} mutation={feedbackMutation} onDone={() => { setFeedbackItem(null); setNotice('Thanks. Next Sunday’s choices will use that signal.') }} /> : null}

      <ResetBar item={data.reset_item} />

      <section className="overflow-hidden rounded-xl border border-border bg-bg-surface" aria-label="Your week">
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h2 className="text-lg font-semibold text-text-primary">Your week</h2>
          <p className="mt-1 text-sm text-text-secondary">One clear choice or one intentional open day.</p>
        </div>
        <ol>{week.map(day => <DayRow key={day.date} day={day} />)}</ol>
      </section>

      <details className="rounded-xl border border-border bg-bg-surface">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
          <span>Plan details</span>
          <span className="text-text-muted">Sources and boundaries</span>
        </summary>
        <div className="space-y-5 border-t border-border px-4 py-5 text-sm leading-6 text-text-secondary">
          <p>{data.plan.intent_summary}</p>
          <ul className="space-y-1"><li>No automatic next item.</li><li>Missed choices do not move to tomorrow.</li><li>No feeds or video after 10:30 PM.</li></ul>
          {data.source_warning ? <p className="flex gap-2"><AlertTriangle className="mt-1 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />{data.source_warning}</p> : null}
          {data.input_review ? <div><p className="font-medium text-text-primary">What last week taught us</p><p className="mt-1">{data.input_review.summary}</p></div> : null}
          <TwitterAllowance allowance={data.twitter_allowance} date={data.today} startMutation={startTwitter} />
        </div>
      </details>
    </div>
  )
}
