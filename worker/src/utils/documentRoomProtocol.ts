export type DocumentSelection = { start: number; end: number };
export type RoomAttachment = {
  documentId: string; actor: string; clientId: string; canEdit: boolean;
  selection: DocumentSelection | null; connectedAt: string;
  windowStartedAt: number; messageCount: number; abuseCount: number; lastRevision: number;
};

export type RoomMessage =
  | { type: 'ping'; request_id?: string }
  | { type: 'presence'; selection: DocumentSelection | null; revision?: number }
  | { type: 'edit'; operation_id: string; base_revision: number; base_content_sha256: string; title: string; content: string; selection: DocumentSelection | null };

export function validDocumentSelection(value: unknown, maxLength = 204800): value is DocumentSelection | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Number.isSafeInteger(row.start) && Number.isSafeInteger(row.end)
    && Number(row.start) >= 0 && Number(row.end) >= Number(row.start) && Number(row.end) <= maxLength;
}

export function parseDocumentRoomMessage(raw: string | ArrayBuffer): { message?: RoomMessage; error?: string } {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  if (new TextEncoder().encode(text).byteLength > 262144) return { error: 'MESSAGE_TOO_LARGE' };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: 'MESSAGE_JSON_INVALID' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'MESSAGE_INVALID' };
  const row = value as Record<string, unknown>;
  if (row.type === 'ping') return { message: { type: 'ping', request_id: typeof row.request_id === 'string' ? row.request_id.slice(0, 128) : undefined } };
  if (row.type === 'presence') {
    if (!validDocumentSelection(row.selection ?? null)) return { error: 'PRESENCE_SELECTION_INVALID' };
    return { message: { type: 'presence', selection: row.selection as DocumentSelection | null, revision: Number.isSafeInteger(row.revision) ? Number(row.revision) : undefined } };
  }
  if (row.type === 'edit') {
    if (typeof row.operation_id !== 'string' || !row.operation_id || row.operation_id.length > 128) return { error: 'OPERATION_ID_INVALID' };
    if (!Number.isSafeInteger(row.base_revision) || Number(row.base_revision) < 0) return { error: 'BASE_REVISION_INVALID' };
    if (typeof row.base_content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.base_content_sha256)) return { error: 'BASE_HASH_INVALID' };
    if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500) return { error: 'TITLE_INVALID' };
    if (typeof row.content !== 'string' || new TextEncoder().encode(row.content).byteLength > 204800) return { error: 'CONTENT_TOO_LARGE' };
    if (!validDocumentSelection(row.selection ?? null, row.content.length)) return { error: 'EDIT_SELECTION_INVALID' };
    return { message: { type: 'edit', operation_id: row.operation_id, base_revision: Number(row.base_revision), base_content_sha256: row.base_content_sha256, title: row.title, content: row.content, selection: row.selection as DocumentSelection | null } };
  }
  return { error: 'MESSAGE_TYPE_UNSUPPORTED' };
}

export function consumeRoomRateLimit(attachment: RoomAttachment, now = Date.now()) {
  const next = { ...attachment };
  if (now - next.windowStartedAt >= 1000) { next.windowStartedAt = now; next.messageCount = 0; }
  next.messageCount += 1;
  const allowed = next.messageCount <= 20;
  if (!allowed) next.abuseCount += 1;
  return { allowed, close: next.abuseCount >= 3, attachment: next };
}
