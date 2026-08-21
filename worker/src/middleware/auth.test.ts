import { describe, expect, it } from 'vitest';
import { matchMachinePrincipal, parseApiPrincipals, parseOwnerEmails, safeTokenCompare, sha256Hex } from './auth';

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
      codex: { token: token('c'), scopes: ['actions:read', 'actions:read', 'weeks:request_review', 'bad scope', 'weeks:_invalid', 'weeks:invalid_'] },
      claude: { token: token('d'), scopes: ['transcripts:write'] },
      intruder: { token: token('i'), scopes: ['actions:read'] },
    }));

    expect(parsed).toEqual([
      { actor: 'codex', token: token('c'), scopes: ['actions:read', 'weeks:request_review'] },
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

describe('release pipeline key hashing', () => {
  it('produces a stable lowercase SHA-256 digest without retaining the raw key', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
