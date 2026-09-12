import { describe, expect, it } from 'vitest'
import { ACTIVE_PRINCIPAL_IDS, activePrincipals, isActivePrincipal } from './memberUtils.js'

describe('active principal filtering', () => {
  it('allows the fixed owner, household human, and scoped agents', () => {
    const members = [
      { id: 'ransomed', name: 'Ransomed' },
      { id: 'codex', name: 'Codex' },
      { id: 'claude', name: 'Claude' },
      { id: 'nicole', name: 'Nicole' },
      { id: 'nicole-codex', name: 'Nicole Codex' },
      { id: 'historical', name: 'Historical' },
    ]

    expect(activePrincipals(members).map(member => member.id).sort()).toEqual([...ACTIVE_PRINCIPAL_IDS].sort())
    expect(isActivePrincipal({ member_id: 'claude' })).toBe(true)
    expect(isActivePrincipal('nicole')).toBe(true)
    expect(isActivePrincipal('historical')).toBe(false)
  })
})
