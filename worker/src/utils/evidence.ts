export type EvidenceKind = 'manual_attestation' | 'verified_execution';

export type CompletionEvidenceV2 = {
  version: 2;
  kind: EvidenceKind;
  summary: string;
  captured_at: string;
  actor: string;
  sources: unknown[];
  verification: Record<string, unknown>;
};

export type EvidenceValidationResult =
  | { evidence: CompletionEvidenceV2; error: null }
  | { evidence: null; error: string };

function meaningfulSource(source: unknown): boolean {
  if (typeof source === 'string') return source.trim().length > 0;
  return !!source && typeof source === 'object' && !Array.isArray(source) && Object.keys(source).length > 0;
}

export function buildCompletionEvidence(
  input: unknown,
  actor: string,
  authKind: string,
  capturedAt = new Date().toISOString(),
): EvidenceValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { evidence: null, error: 'Evidence must be an object.' };
  }

  const raw = input as Record<string, unknown>;
  if (raw.version !== 2) return { evidence: null, error: 'Evidence version must be 2.' };
  if (raw.kind !== 'manual_attestation' && raw.kind !== 'verified_execution') {
    return { evidence: null, error: 'Evidence kind must be manual_attestation or verified_execution.' };
  }

  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (!summary) return { evidence: null, error: 'Evidence summary is required.' };
  if (summary.length > 5000) return { evidence: null, error: 'Evidence summary exceeds 5000 characters.' };

  if (authKind === 'api_principal' && raw.kind !== 'verified_execution') {
    return { evidence: null, error: 'Agent principals must provide verified_execution evidence.' };
  }

  const sources = Array.isArray(raw.sources) ? raw.sources.filter(meaningfulSource) : [];
  const verification = raw.verification && typeof raw.verification === 'object' && !Array.isArray(raw.verification)
    ? raw.verification as Record<string, unknown>
    : {};

  if (raw.kind === 'verified_execution' && sources.length === 0) {
    return { evidence: null, error: 'Verified execution requires at least one source, artifact, test, or readback.' };
  }
  if (raw.kind === 'verified_execution' && Object.keys(verification).length === 0) {
    return { evidence: null, error: 'Verified execution requires verification details.' };
  }

  return {
    evidence: {
      version: 2,
      kind: raw.kind,
      summary,
      captured_at: capturedAt,
      actor,
      sources,
      verification: raw.kind === 'manual_attestation'
        ? { state: 'manual_attestation' }
        : verification,
    },
    error: null,
  };
}
