import { describe, expect, it } from 'vitest';
import { computeActivePrincipalStats } from './members';

describe('principal workload stats', () => {
  it('returns exactly the three active principals and ignores historical owners', () => {
    const result = computeActivePrincipalStats([
      { status: 'in_progress', due_date: '2026-07-01', owners: ['ransomed', 'nicole'] },
      { status: 'done', due_date: '2026-07-01', owners: ['codex'] },
    ], '2026-07-09');

    expect(result.map(item => item.member_id).sort()).toEqual(['claude', 'codex', 'ransomed']);
    expect(result.find(item => item.member_id === 'ransomed')).toMatchObject({ active: 1, overdue: 1, total: 1 });
    expect(result.find(item => item.member_id === 'codex')).toMatchObject({ done: 1, active: 0, total: 1 });
  });

  it('deduplicates repeated owners on an action', () => {
    const result = computeActivePrincipalStats([
      { status: 'blocked', owners: ['claude', 'claude'] },
    ], '2026-07-09');

    expect(result.find(item => item.member_id === 'claude')).toMatchObject({ blocked: 1, active: 1, total: 1 });
  });
});
