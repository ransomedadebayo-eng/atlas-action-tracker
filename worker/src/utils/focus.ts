export const FOCUS_BODY_LIMIT = 8192;
export const FOCUS_PHASES = ['focus', 'short_break', 'long_break'] as const;
export const FOCUS_COMMANDS = ['start', 'pause', 'resume', 'reset', 'skip', 'settings', 'select_phase', 'reconcile'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETTING_KEYS = ['focus_minutes', 'short_break_minutes', 'long_break_minutes', 'chime_enabled'];
type Row = Record<string, unknown>;
export type FocusCursor = { ended_at: string; id: string };

export class FocusInputError extends Error {
  constructor(public code: string, message: string, public status: 400 | 413 | 415 = 400) { super(message); }
}
function invalid(message: string): never { throw new FocusInputError('FOCUS_INVALID_COMMAND', message); }
function isObject(value: unknown): value is Row { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Row, allowed: readonly string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function projectId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

export function validateFocusCommand(value: unknown): Row {
  if (!isObject(value)) invalid('A JSON command object is required.');
  const command = value.command;
  if (typeof command !== 'string' || !FOCUS_COMMANDS.includes(command as typeof FOCUS_COMMANDS[number])) invalid('Choose a supported focus command.');
  const extra = command === 'start' ? ['project_id'] : command === 'settings' ? ['settings'] : command === 'select_phase' ? ['phase'] : [];
  if (!exactKeys(value, ['operation_id', 'expected_revision', 'command', ...extra])) invalid('The command contains unsupported fields.');
  if (typeof value.operation_id !== 'string' || !UUID.test(value.operation_id)) invalid('operation_id must be a UUID.');
  if (!Number.isSafeInteger(value.expected_revision) || Number(value.expected_revision) < 0) invalid('expected_revision must be a non-negative safe integer.');
  const result: Row = { operation_id: value.operation_id.toLowerCase(), expected_revision: value.expected_revision, command };
  if (command === 'start' && Object.prototype.hasOwnProperty.call(value, 'project_id')) {
    if (!projectId(value.project_id)) invalid('project_id must be a bounded Atlas project ID.');
    result.project_id = value.project_id;
  }
  if (command === 'settings') {
    if (!isObject(value.settings) || !exactKeys(value.settings, SETTING_KEYS) || SETTING_KEYS.some(key => !Object.prototype.hasOwnProperty.call(value.settings, key))) invalid('Complete focus settings are required.');
    const settings = value.settings as Row;
    for (const [key, max] of [['focus_minutes', 180], ['short_break_minutes', 60], ['long_break_minutes', 120]] as const) {
      if (!Number.isSafeInteger(settings[key]) || Number(settings[key]) < 1 || Number(settings[key]) > max) invalid(`${key} must be a whole number from 1 to ${max}.`);
    }
    if (typeof settings.chime_enabled !== 'boolean') invalid('chime_enabled must be a boolean.');
    result.settings = Object.fromEntries(SETTING_KEYS.map(key => [key, settings[key]]));
  }
  if (command === 'select_phase') {
    if (!FOCUS_PHASES.includes(value.phase as typeof FOCUS_PHASES[number])) invalid('Choose focus, short_break or long_break.');
    result.phase = value.phase;
  }
  return result;
}

/** Consume a bounded stream rather than trusting content-length or allocating an unbounded body. */
export async function readFocusCommand(request: Request): Promise<Row> {
  if (!(request.headers.get('content-type') || '').toLowerCase().match(/^application\/json(?:\s*;|$)/)) {
    throw new FocusInputError('FOCUS_CONTENT_TYPE', 'Use application/json for focus commands.', 415);
  }
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > FOCUS_BODY_LIMIT) throw new FocusInputError('FOCUS_BODY_TOO_LARGE', 'Focus commands are limited to 8 KiB.', 413);
  const reader = request.body?.getReader();
  if (!reader) invalid('A JSON command object is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        length += value.byteLength;
        if (length > FOCUS_BODY_LIMIT) {
          await reader.cancel();
          throw new FocusInputError('FOCUS_BODY_TOO_LARGE', 'Focus commands are limited to 8 KiB.', 413);
        }
        chunks.push(value);
      }
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { invalid('A valid UTF-8 JSON command is required.'); }
  return validateFocusCommand(value);
}

function validCursor(value: unknown): value is FocusCursor {
  if (!isObject(value) || !exactKeys(value, ['ended_at', 'id']) || typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.ended_at !== 'string') return false;
  const time = value.ended_at;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(time) || !Number.isFinite(Date.parse(time))) return false;
  const date = new Date(`${time.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === time.slice(0, 10);
}

export function encodeFocusCursor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!validCursor(value)) throw new Error('Invalid focus storage cursor.');
  // Preserve PostgreSQL microseconds; Date.toISOString() would lose a pagination tie-breaker.
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseFocusHistoryQuery(params: URLSearchParams) {
  for (const key of params.keys()) {
    if (!['limit', 'cursor', 'project_id'].includes(key) || params.getAll(key).length !== 1) throw new FocusInputError('FOCUS_INVALID_HISTORY_QUERY', 'History accepts one limit, cursor and project_id.');
  }
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? 20 : /^[1-9]\d{0,2}$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new FocusInputError('FOCUS_INVALID_HISTORY_QUERY', 'limit must be an integer from 1 to 100.');
  const project = params.get('project_id');
  if (project !== null && !projectId(project)) throw new FocusInputError('FOCUS_INVALID_HISTORY_QUERY', 'project_id must be a bounded Atlas project ID.');
  const raw = params.get('cursor');
  let cursor: FocusCursor | null = null;
  if (raw !== null) {
    try {
      if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('format');
      const decoded = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(decoded, character => character.charCodeAt(0))));
      if (!validCursor(value)) throw new Error('shape');
      cursor = value;
    } catch { throw new FocusInputError('FOCUS_INVALID_HISTORY_QUERY', 'The history cursor is invalid.'); }
  }
  return { limit, project_id: project, cursor };
}
