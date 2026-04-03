const MAX_LENGTHS: Record<string, number> = {
  title: 500,
  description: 5000,
  notes: 10000,
  append_note: 10000,
  raw_text: 500000,
  summary: 10000,
  name: 200,
  full_name: 200,
  email: 254,
  role: 200,
  source_label: 500,
  summary_file: 500,
};

export function validateStringLengths(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const val = body[field];
    if (val !== undefined && typeof val === 'string' && val.length > max) {
      errors.push(`${field} exceeds maximum length of ${max} characters`);
    }
  }
  return errors;
}

export function sanitizeText(str: unknown): unknown {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

export function sanitizeBody(body: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const cleaned = { ...body };
  for (const field of fields) {
    if (cleaned[field] !== undefined && typeof cleaned[field] === 'string') {
      cleaned[field] = sanitizeText(cleaned[field]);
    }
  }
  return cleaned;
}

const VALID_TRANSCRIPT_STATUSES = ['pending', 'reviewed', 'archived'];

export function validateTranscriptStatus(status: unknown): string | null {
  if (status !== undefined && !VALID_TRANSCRIPT_STATUSES.includes(status as string)) {
    return `status must be one of: ${VALID_TRANSCRIPT_STATUSES.join(', ')}`;
  }
  return null;
}

const MEMBER_ID_PATTERN = /^[a-z0-9_-]{2,50}$/;

export function validateMemberId(id: string): string | null {
  if (!MEMBER_ID_PATTERN.test(id)) {
    return 'id must be 2-50 lowercase alphanumeric characters, hyphens, or underscores';
  }
  return null;
}

export function parsePagination(query: Record<string, string | undefined>): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(query.limit ?? '') || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset ?? '') || 0, 0);
  return { limit, offset };
}
