import { describe, expect, it } from 'vitest';
import { matchMachinePrincipal, parseApiPrincipals, parseOwnerEmails, safeTokenCompare } from './auth';

const token = (character: string) => character.repeat(32);

describe('ATLAS authentication configuration', () => {
  it('normalizes the exact owner email allowlist', () => {
    expect([...parseOwnerEmails(' Owner@Example.com,second@example.com ,,')]).toEqual([
      'owner@example.com',
      'second@example.com',
    ]);
  });

  it('accepts only distinct Codex and Claude principal definitions', () => {
    const parsed = parseApiPrincipals(JSON.stringify({
      codex: { token: token('c'), scopes: ['actions:read', 'actions:read', 'bad scope'] },
      claude: { token: token('d'), scopes: ['transcripts:write'] },
      intruder: { token: token('i'), scopes: ['actions:read'] },
    }));

    expect(parsed).toEqual([
      { actor: 'codex', token: token('c'), scopes: ['actions:read'] },
      { actor: 'claude', token: token('d'), scopes: ['transcripts:write'] },
    ]);
    expect(parseApiPrincipals(JSON.stringify({
      codex: { token: token('x'), scopes: [] },
      claude: { token: token('x'), scopes: [] },
    }))).toEqual([]);
  });

  it('matches bearer principals without accepting neighboring tokens', async () => {
    const config = JSON.stringify({
      codex: { token: token('c'), scopes: ['actions:read'] },
      claude: { token: token('d'), scopes: ['actions:complete'] },
    });

    await expect(matchMachinePrincipal(token('d'), config)).resolves.toMatchObject({ actor: 'claude' });
    await expect(matchMachinePrincipal(`${token('d')}x`, config)).resolves.toBeNull();
    await expect(safeTokenCompare(token('c'), token('c'))).resolves.toBe(true);
    await expect(safeTokenCompare(token('c'), token('d'))).resolves.toBe(false);
  });
});
