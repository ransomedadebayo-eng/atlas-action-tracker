import { describe, expect, it } from 'vitest';
import { buildCompletionEvidence } from './evidence';

describe('completion evidence v2', () => {
  it('accepts a manual owner attestation and stamps trusted metadata', () => {
    const result = buildCompletionEvidence({
      version: 2,
      kind: 'manual_attestation',
      summary: 'I verified the household form was submitted.',
      actor: 'spoofed',
      captured_at: '2000-01-01T00:00:00.000Z',
    }, 'ransomed', 'owner_access', '2026-07-09T12:00:00.000Z');

    expect(result.error).toBeNull();
    expect(result.evidence).toMatchObject({
      actor: 'ransomed',
      captured_at: '2026-07-09T12:00:00.000Z',
      kind: 'manual_attestation',
    });
  });

  it('requires agents to submit verified evidence with sources and verification', () => {
    expect(buildCompletionEvidence({
      version: 2,
      kind: 'manual_attestation',
      summary: 'Done',
    }, 'codex', 'api_principal').error).toContain('must provide verified_execution');

    expect(buildCompletionEvidence({
      version: 2,
      kind: 'verified_execution',
      summary: 'Tests passed',
      sources: [],
      verification: { tests: 'passed' },
    }, 'codex', 'api_principal').error).toContain('at least one source');
  });

  it('accepts verified execution and rejects empty summaries', () => {
    const result = buildCompletionEvidence({
      version: 2,
      kind: 'verified_execution',
      summary: 'Worker typecheck and focused tests passed.',
      sources: [{ type: 'test', ref: 'worker:test' }],
      verification: { result: 'passed' },
    }, 'claude', 'api_principal');
    expect(result.error).toBeNull();
    expect(buildCompletionEvidence({ version: 2, kind: 'manual_attestation', summary: ' ' }, 'ransomed', 'owner_access').error)
      .toBe('Evidence summary is required.');
  });
});
