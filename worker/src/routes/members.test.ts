import { describe, expect, it } from 'vitest';
import { computeActivePrincipalStats, isMutablePrincipal } from './members';

const livePrincipals = [
  { id: 'ransomed', principal_type: 'owner', is_active: true },
  { id: 'nicole', principal_type: 'human', is_active: true },
  { id: 'codex', principal_type: 'agent', is_active: true },
  { id: 'claude', principal_type: 'agent', is_active: true },
  { id: 'amara', principal_type: 'agent', is_active: true },
  { id: 'legacy', principal_type: 'historical', is_active: false },
];

describe('principal workload stats', () => {
  it('builds stats from live active members and ignores historical owners', () => {
    const result = computeActivePrincipalStats([
      { status: 'in_progress', due_date: '2026-07-01', owners: ['ransomed', 'nicole', 'legacy'] },
      { status: 'done', due_date: '2026-07-01', owners: ['codex'] },
      { status: 'waiting', owners: ['amara'] },
    ], '2026-07-09', livePrincipals);

    expect(result.map(item => item.member_id).sort()).toEqual(['amara', 'claude', 'codex', 'nicole', 'ransomed']);
    expect(result.find(item => item.member_id === 'ransomed')).toMatchObject({ active: 1, overdue: 1, total: 1 });
    expect(result.find(item => item.member_id === 'nicole')).toMatchObject({ active: 1, overdue: 1, total: 1 });
    expect(result.find(item => item.member_id === 'codex')).toMatchObject({ done: 1, active: 0, total: 1 });
    expect(result.find(item => item.member_id === 'amara')).toMatchObject({ waiting: 1, active: 1, total: 1 });
    expect(result.find(item => item.member_id === 'legacy')).toBeUndefined();
  });

  it('deduplicates repeated owners on an action', () => {
    const result = computeActivePrincipalStats([
      { status: 'blocked', owners: ['claude', 'claude'] },
    ], '2026-07-09', livePrincipals);

    expect(result.find(item => item.member_id === 'claude')).toMatchObject({ blocked: 1, active: 1, total: 1 });
  });
});

describe('principal write gate', () => {
  it('rejects reassignment of reserved identities and extra human identities', () => {
    for (const [id, principal_type] of [['ransomed', 'agent'], ['nicole', 'agent'], ['other', 'owner'], ['other', 'human']]) {
      expect(isMutablePrincipal({ id, principal_type, is_active: true })).toMatchObject({ ok: false, status: 403 });
    }
  });
  it('treats Nicole and active agents as editable and historical rows as immutable', () => {
    expect(isMutablePrincipal({ id: 'nicole', principal_type: 'human', is_active: true })).toEqual({ ok: true });
    expect(isMutablePrincipal({ id: 'amara', principal_type: 'agent', is_active: true })).toEqual({ ok: true });
    expect(isMutablePrincipal({ id: 'ransomed', principal_type: 'owner', is_active: true })).toEqual({ ok: true });
    expect(isMutablePrincipal({ id: 'legacy', principal_type: 'historical', is_active: false })).toMatchObject({
      status: 403,
      code: 'HISTORICAL_PRINCIPAL_IMMUTABLE',
    });
  });
});
