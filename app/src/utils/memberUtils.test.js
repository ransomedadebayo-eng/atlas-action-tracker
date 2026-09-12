import { describe, expect, it } from 'vitest'
import {
  ACTIVE_PRINCIPAL_IDS,
  activePrincipals,
  isActivePrincipal,
} from './memberUtils.js'

describe('active principal filtering', () => {
  it('keeps owner, human, and agent rows and hides historical principals', () => {
    const members = [
      { id: 'ransomed', name: 'Ransomed', principal_type: 'owner', is_active: true },
      { id: 'nicole', name: 'Nicole', principal_type: 'human', is_active: true },
      { id: 'amara', name: 'Amara', principal_type: 'agent', is_active: true },
      { id: 'engineering', name: 'Engineering', principal_type: 'agent', is_active: true },
      { id: 'legacy', name: 'Legacy', principal_type: 'historical', is_active: false },
      { id: 'retired-agent', name: 'Retired', principal_type: 'agent', is_active: false },
    ]

    expect(activePrincipals(members).map(member => member.id)).toEqual([
      'ransomed',
      'nicole',
      'amara',
      'engineering',
    ])
  })

  it('still recognizes the original owner and machine IDs without a type field', () => {
    expect(isActivePrincipal({ member_id: 'claude' })).toBe(true)
    expect(isActivePrincipal('codex')).toBe(true)
    expect(isActivePrincipal('nicole')).toBe(false)
    expect(ACTIVE_PRINCIPAL_IDS).toEqual(['ransomed', 'codex', 'claude'])
  })
})
