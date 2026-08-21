import { describe, expect, it } from 'vitest';
import {
  buildWebhookPayload, buildWebhookSigningInput, containsCredentialLikeKey, hmacSha256Hex,
  integrationSecret, isFreshWebhookTimestamp, readBoundedText, retryDelayMs, sha256Hex,
  timingSafeHexEqual, validateIntegrationEndpoint, validWebhookHeaders,
} from './integrations';

describe('integration endpoint boundary', () => {
  it('accepts and normalizes a public HTTPS endpoint', () => {
    expect(validateIntegrationEndpoint('https://Hooks.Example.com/atlas#fragment')).toMatchObject({ valid: true, normalized_url: 'https://hooks.example.com/atlas', host: 'hooks.example.com' });
  });
  it('rejects HTTP, embedded credentials, and custom ports', () => {
    expect(validateIntegrationEndpoint('http://example.com/hook').valid).toBe(false);
    expect(validateIntegrationEndpoint('https://user:pass@example.com/hook').valid).toBe(false);
    expect(validateIntegrationEndpoint('https://example.com:8443/hook').valid).toBe(false);
  });
  it('rejects loopback, private, link-local, and metadata destinations', () => {
    for (const endpoint of ['https://localhost/hook','https://127.0.0.1/hook','https://10.1.2.3/hook','https://172.16.0.1/hook','https://192.168.1.2/hook','https://169.254.169.254/latest','https://metadata.google.internal/hook']) {
      expect(validateIntegrationEndpoint(endpoint).valid, endpoint).toBe(false);
    }
  });
  it('conservatively rejects IPv6 destinations', () => {
    expect(validateIntegrationEndpoint('https://[::1]/hook').valid).toBe(false);
  });
});

describe('integration signatures and receipts', () => {
  it('hashes and signs deterministically', async () => {
    expect(await sha256Hex('atlas')).toHaveLength(64);
    expect(await hmacSha256Hex('a-secure-test-secret-with-24-chars', '{"ok":true}')).toHaveLength(64);
    expect(await hmacSha256Hex('a-secure-test-secret-with-24-chars', '{"ok":true}')).toBe(await hmacSha256Hex('a-secure-test-secret-with-24-chars', '{"ok":true}'));
  });
  it('binds timestamp, delivery, event, and payload into a versioned signature', async () => {
    const secret = 'a-secure-test-secret-with-24-chars';
    const base = ['1787328000000', 'delivery-1', 'project', '{"id":"p1"}'] as const;
    const expected = await hmacSha256Hex(secret, buildWebhookSigningInput(...base));
    const variations: Array<[string, string, string, string]> = [
      ['1787328000001', base[1], base[2], base[3]],
      [base[0], 'delivery-2', base[2], base[3]],
      [base[0], base[1], 'initiative', base[3]],
      [base[0], base[1], base[2], '{"id":"p2"}'],
    ];
    for (const changed of variations) {
      await expect(hmacSha256Hex(secret, buildWebhookSigningInput(...changed))).resolves.not.toBe(expected);
    }
    expect(buildWebhookSigningInput(...base)).toContain('atlas-webhook-v1');
  });
  it('accepts only unambiguous bounded webhook headers', () => {
    expect(validWebhookHeaders('delivery-1', 'project_updated', '1787328000000')).toBe(true);
    expect(validWebhookHeaders('delivery\n2', 'project_updated', '1787328000000')).toBe(false);
    expect(validWebhookHeaders('delivery-1', 'Project Updated', '1787328000000')).toBe(false);
    expect(validWebhookHeaders('delivery-1', 'project_updated', 'not-a-timestamp')).toBe(false);
  });
  it('compares same-length hex values without early semantic shortcuts', () => {
    expect(timingSafeHexEqual('aabbcc', 'aabbcc')).toBe(true);
    expect(timingSafeHexEqual('aabbcc', 'aabbcd')).toBe(false);
    expect(timingSafeHexEqual('abc', 'abcd')).toBe(false);
  });
  it('accepts only timestamps inside the five-minute window', () => {
    const now = Date.parse('2026-08-20T20:00:00Z');
    expect(isFreshWebhookTimestamp(now - 299_999, now)).toBe(true);
    expect(isFreshWebhookTimestamp(now - 300_001, now)).toBe(false);
  });
  it('matches the documented retry schedule and stops after three retries', () => {
    expect([1,2,3,4].map(retryDelayMs)).toEqual([60_000,3_600_000,21_600_000,null]);
  });
  it('loads only exact, sufficiently long environment secret references', () => {
    const env = { ATLAS_INTEGRATION_SECRET_TEST: '123456789012345678901234' };
    expect(integrationSecret(env, 'ATLAS_INTEGRATION_SECRET_TEST')).toBe(env.ATLAS_INTEGRATION_SECRET_TEST);
    expect(integrationSecret(env, 'SUPABASE_SERVICE_ROLE_KEY')).toBeNull();
    expect(integrationSecret({ ATLAS_INTEGRATION_SECRET_TEST: 'short' }, 'ATLAS_INTEGRATION_SECRET_TEST')).toBeNull();
  });
  it('rejects credential-like keys anywhere in connection config', () => {
    expect(containsCredentialLikeKey({ channel: 'alerts', nested: { apiKey: 'secret' } })).toBe(true);
    expect(containsCredentialLikeKey({ channel: 'alerts', template: 'compact' })).toBe(false);
  });
  it('builds a bounded Linear-style change payload', () => {
    expect(buildWebhookPayload({ id:'e1',event_action:'updated',resource_type:'project',resource_id:'p1',actor:'ransomed',created_at:'2026-08-20T20:00:00Z',category:'project_updates',summary:'Project updated',urgency:'normal',target_url:'/projects/p1',payload:{project_id:'p1'} })).toMatchObject({ action:'updated',type:'project',actor:'ransomed',data:{id:'p1',project_id:'p1'},url:'/projects/p1',eventId:'e1' });
  });
  it('bounds verification response bodies before parsing', async () => {
    await expect(readBoundedText(new Response('{"challenge":"ok"}'), 64)).resolves.toBe('{"challenge":"ok"}');
    await expect(readBoundedText(new Response('x'.repeat(65)), 64)).rejects.toThrow('response_too_large');
  });
});
