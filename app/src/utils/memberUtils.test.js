import { describe, expect, it } from 'vitest'
import { ACTIVE_PRINCIPAL_IDS, activePrincipals, isActivePrincipal } from './memberUtils.js'

describe('active principal filtering', () => {
  it('allows only Ransomed, Codex, and Claude', () => {
    const members = [
      { id: 'ransomed', name: 'Ransomed' },
      { id: 'codex', name: 'Codex' },
      { id: 'claude', name: 'Claude' },
      { id: 'nicole', name: 'Nicole' },
    ]

    expect(activePrincipals(members).map(member => member.id)).toEqual(ACTIVE_PRINCIPAL_IDS)
    expect(isActivePrincipal({ member_id: 'claude' })).toBe(true)
    expect(isActivePrincipal('nicole')).toBe(false)
  })
})
