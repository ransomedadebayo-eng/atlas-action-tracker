import { describe, expect, it } from 'vitest'
import { activePrincipals, isActivePrincipal } from './memberUtils.js'

describe('active principal filtering', () => {
  it('shows active owner, human, and agent principals and hides historical rows', () => {
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
    expect(isActivePrincipal({ id: 'nicole', principal_type: 'human', is_active: true })).toBe(true)
    expect(isActivePrincipal({ id: 'amara', principal_type: 'agent', is_active: true })).toBe(true)
    expect(isActivePrincipal({ id: 'legacy', principal_type: 'historical', is_active: false })).toBe(false)
    expect(isActivePrincipal('nicole')).toBe(false)
  })
})
