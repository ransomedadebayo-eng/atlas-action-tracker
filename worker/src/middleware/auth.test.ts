import { describe, expect, it } from 'vitest';
import { matchMachinePrincipal, parseApiPrincipals, parseHumanAccessPrincipals, parseOwnerEmails, resolveVerifiedAccessIdentity, safeTokenCompare, sha256Hex } from './auth';
import { app } from '../index';
import type { Env } from '../db';
import { defaultOwnerForActor } from '../utils/principals';

const token = (character: string) => character.repeat(32);

describe('ATLAS authentication configuration', () => {
  it('keeps original caller defaults while self-attributing the new household principals', () => {
    expect(defaultOwnerForActor('ransomed')).toBe('ransomed');
    expect(defaultOwnerForActor('codex')).toBe('ransomed');
    expect(defaultOwnerForActor('claude')).toBe('ransomed');
    expect(defaultOwnerForActor('nicole')).toBe('nicole');
    expect(defaultOwnerForActor('nicole-codex')).toBe('nicole-codex');
  });
  it('normalizes the exact owner email allowlist', () => {
    expect([...parseOwnerEmails(' Owner@Example.com,second@example.com ,,')]).toEqual([
      'owner@example.com',
      'second@example.com',
    ]);
  });

  it('accepts only the fixed machine-principal definitions', () => {
    const parsed = parseApiPrincipals(JSON.stringify({
      codex: { token: token('c'), scopes: ['actions:read', 'actions:read', 'weeks:request_review', 'bad scope', 'weeks:_invalid', 'weeks:invalid_'] },
      claude: { token: token('d'), scopes: ['transcripts:write'] },
      'nicole-codex': { token: token('n'), scopes: ['actions:read', 'comments:write'] },
      intruder: { token: token('i'), scopes: ['actions:read'] },
    }));

    expect(parsed).toEqual([
      { actor: 'codex', token: token('c'), scopes: ['actions:read', 'weeks:request_review'] },
      { actor: 'claude', token: token('d'), scopes: ['transcripts:write'] },
      { actor: 'nicole-codex', token: token('n'), scopes: ['actions:read', 'comments:write'] },
    ]);
    expect(parseApiPrincipals(JSON.stringify({
      codex: { token: token('x'), scopes: [] },
      claude: { token: token('x'), scopes: [] },
    }))).toEqual([]);
  });

  it('maps a verified Nicole email to a distinct scoped human while leaving the owner unchanged', () => {
    const config = JSON.stringify({
      ' Nicole.Verified@example.com ': { actor: 'nicole', scopes: ['actions:read', 'actions:write', 'bad scope'] },
      'intruder@example.com': { actor: 'intruder', scopes: ['actions:read'] },
    });

    expect(parseHumanAccessPrincipals(config)).toEqual([
      { email: 'nicole.verified@example.com', actor: 'nicole', scopes: ['actions:read', 'actions:write'] },
    ]);
    expect(resolveVerifiedAccessIdentity('OWNER@example.com', {
      ATLAS_OWNER_EMAILS: 'owner@example.com',
      ATLAS_HUMAN_ACCESS_JSON: config,
    })).toEqual({ actor: 'ransomed', authKind: 'owner_access', scopes: ['*'] });
    expect(resolveVerifiedAccessIdentity('nicole.verified@example.com', {
      ATLAS_OWNER_EMAILS: 'owner@example.com',
      ATLAS_HUMAN_ACCESS_JSON: config,
    })).toEqual({ actor: 'nicole', authKind: 'human_access', scopes: ['actions:read', 'actions:write'] });
  });

  it('fails closed when the human mapping is missing, malformed, duplicated, or guessed', () => {
    expect(parseHumanAccessPrincipals(JSON.stringify({
      'one@example.com': { actor: 'nicole', scopes: ['actions:read'] },
      'two@example.com': { actor: 'nicole', scopes: ['actions:read'] },
    }))).toEqual([]);
    expect(resolveVerifiedAccessIdentity('nicole@example.com', {
      ATLAS_OWNER_EMAILS: 'owner@example.com',
    })).toBeNull();
    expect(resolveVerifiedAccessIdentity('nicole@example.com', {
      ATLAS_OWNER_EMAILS: 'owner@example.com',
      ATLAS_HUMAN_ACCESS_JSON: '{bad json',
    })).toBeNull();
    expect(resolveVerifiedAccessIdentity('OWNER@example.com', {
      ATLAS_OWNER_EMAILS: 'owner@example.com',
      ATLAS_HUMAN_ACCESS_JSON: JSON.stringify({
        ' owner@example.com ': { actor: 'nicole', scopes: ['actions:read'] },
      }),
    })).toBeNull();
    expect(resolveVerifiedAccessIdentity('owner@example.com', {
      ATLAS_OWNER_EMAILS: 'owner@example.com',
      ATLAS_HUMAN_ACCESS_JSON: JSON.stringify({
        'owner@example.com': { actor: 'wrong', scopes: [] },
        'nicole@example.com': { actor: 'nicole', scopes: ['actions:read'] },
      }),
    })).toBeNull();
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

describe('Nicole principal HTTP boundary', () => {
  const nicoleCodexToken = 'nicole-codex-http-token-0001';
  const env: Env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    NODE_ENV: 'production',
    ATLAS_API_PRINCIPALS_JSON: JSON.stringify({
      'nicole-codex': { token: nicoleCodexToken, scopes: ['actions:read', 'principals:read'] },
    }),
  };

  it('does not trust an unverified email header as a human identity', async () => {
    const response = await app.request('/api/members', {
      headers: { 'cf-access-authenticated-user-email': 'nicole@example.com' },
    }, env);
    expect(response.status).toBe(401);
  });

  it('authenticates Nicole Codex only with its configured token and scopes', async () => {
    const neighboring = await app.request('/api/members', {
      headers: { authorization: `Bearer ${nicoleCodexToken}x` },
    }, env);
    const insufficient = await app.request('/api/comments?target_type=action&target_id=a1', {
      headers: { authorization: `Bearer ${nicoleCodexToken}` },
    }, env);
    expect(neighboring.status).toBe(401);
    expect(insufficient.status).toBe(403);
    await expect(insufficient.json()).resolves.toMatchObject({ details: { required_scope: 'comments:read' } });
  });

  it('keeps roster mutation owner-only for Nicole Codex', async () => {
    const response = await app.request('/api/members/nicole', {
      method: 'PUT',
      headers: { authorization: `Bearer ${nicoleCodexToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'Owner' }),
    }, env);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'OWNER_REQUIRED' });
  });
});
