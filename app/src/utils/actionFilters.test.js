import { describe, expect, it } from 'vitest'
import {
  OFFICE_DIGEST_VIEW_FILTERS,
  actionListQueryFromFilters,
  groupOfficeDigest,
  hasNonEmptyBlockedBy,
  matchesActionFilters,
  parseCompletedWithin,
  resolveSavedViewFilters,
} from './actionFilters.js'

const now = new Date('2026-09-12T22:00:00.000Z')

describe('office digest filter helpers', () => {
  it('parses a completed_within hour window', () => {
    expect(parseCompletedWithin('48h', now)?.toISOString()).toBe('2026-09-10T22:00:00.000Z')
    expect(hasNonEmptyBlockedBy(['x'])).toBe(true)
    expect(hasNonEmptyBlockedBy('[]')).toBe(false)
  })

  it('keeps saved-view filters aligned to atlas_office_digest_v1 buckets', () => {
    const recentDone = { status: 'done', completed_at: '2026-09-12T12:00:00.000Z', archived_at: null, approval_state: 'not_required', blocked_by: [] }
    const staleDone = { ...recentDone, completed_at: '2026-09-09T12:00:00.000Z' }
    const waiting = { status: 'in_progress', archived_at: null, approval_state: 'needs_review', blocked_by: ['blocker'], completed_at: null }
    const blocked = { status: 'waiting', archived_at: null, approval_state: 'not_required', blocked_by: ['blocker'], completed_at: null }

    expect(matchesActionFilters(recentDone, OFFICE_DIGEST_VIEW_FILTERS['office-digest-done'], now)).toBe(true)
    expect(matchesActionFilters(staleDone, OFFICE_DIGEST_VIEW_FILTERS['office-digest-done'], now)).toBe(false)
    expect(matchesActionFilters(waiting, OFFICE_DIGEST_VIEW_FILTERS['office-digest-waiting-on-owner'], now)).toBe(true)
    expect(matchesActionFilters(blocked, OFFICE_DIGEST_VIEW_FILTERS['office-digest-blocked-by-office'], now)).toBe(true)
    expect(matchesActionFilters(waiting, OFFICE_DIGEST_VIEW_FILTERS['office-digest-blocked-by-office'], now)).toBe(false)
  })

  it('overlays exact office-digest filters over approximate stored views', () => {
    expect(resolveSavedViewFilters({
      id: 'office-digest-done',
      filters: { status: 'done' },
    })).toEqual({ status: 'done', completed_within: '48h' })
    expect(resolveSavedViewFilters({
      id: 'office-digest-blocked-by-office',
      filters: { show_blocked: 'true' },
    })).toEqual({
      open: 'true',
      has_blocked_by: 'true',
      exclude_approval_state: 'needs_review',
    })
  })

  it('builds action-list query params for the exact buckets', () => {
    expect(actionListQueryFromFilters(OFFICE_DIGEST_VIEW_FILTERS['office-digest-done'], { hideDone: true })).toMatchObject({
      status: 'done',
      completed_within: '48h',
      show_blocked: 'true',
    })
    expect(actionListQueryFromFilters(OFFICE_DIGEST_VIEW_FILTERS['office-digest-waiting-on-owner'], { hideDone: true })).toMatchObject({
      open: 'true',
      approval_state: 'needs_review',
    })
    expect(actionListQueryFromFilters(OFFICE_DIGEST_VIEW_FILTERS['office-digest-waiting-on-owner'], { hideDone: true }).status).toBeUndefined()
  })

  it('groups digest rows by bucket then office', () => {
    const sections = groupOfficeDigest([
      { id: 'd1', digest_bucket: 'done', business: 'personal', title: 'Closed lease', identifier: 'ATLAS-1' },
      { id: 'w1', digest_bucket: 'waiting_on_owner', business: 'riddim_exchange', title: 'Needs review', identifier: 'ATLAS-2' },
      { id: 'w2', digest_bucket: 'waiting_on_owner', business: 'personal', title: 'Owner call', identifier: 'ATLAS-3' },
    ], { businessLabels: { personal: 'Personal', riddim_exchange: 'Riddim Exchange' } })

    expect(sections.map(section => [section.id, section.count])).toEqual([
      ['done', 1],
      ['waiting_on_owner', 2],
      ['blocked_by_office', 0],
    ])
    expect(sections[1].offices.map(office => office.label)).toEqual(['Riddim Exchange', 'Personal'])
  })
})
