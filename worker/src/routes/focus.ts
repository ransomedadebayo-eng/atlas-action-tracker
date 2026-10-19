import { Hono } from 'hono';
import type { Context } from 'hono';
import { getDb, type Env } from '../db';
import { getActor, getAuthKind } from '../utils/actors';
import { apiError } from '../utils/http';
import { encodeFocusCursor, FocusInputError, parseFocusHistoryQuery, readFocusCommand } from '../utils/focus';

const router = new Hono<{ Bindings: Env }>();
type DbError = { code?: string; message?: string };

// Existing authorization denies unknown /api/focus scopes for machine principals.
// Keep this local guard as well, so re-mounting the router cannot expose owner history.
router.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (getAuthKind(c) !== 'owner_access' || getActor(c) !== 'ransomed') return apiError(c, 403, 'OWNER_REQUIRED', 'Focus is available only to the Atlas owner.');
  return next();
});

function focusError(c: Context<{ Bindings: Env }>, error: unknown, command = false) {
  if (error instanceof FocusInputError) return apiError(c, error.status, error.code, error.message);
  const failure = (error || {}) as DbError;
  const message = failure.message || '';
  if (message.includes('OPERATION_CONFLICT')) return apiError(c, 409, 'OPERATION_CONFLICT', 'This operation_id was already used for a different command.');
  if (message.includes('REVISION_CONFLICT')) return apiError(c, 409, 'REVISION_CONFLICT', 'The timer changed in another request. Refresh before issuing another command.');
  if (message.includes('FOCUS_OWNER_REQUIRED')) return apiError(c, 403, 'OWNER_REQUIRED', 'Focus is available only to the Atlas owner.');
  if (['PGRST202', 'PGRST205', '42P01', '42883', '3F000', '42501'].includes(failure.code || '')) {
    return apiError(c, 503, 'FOCUS_STORAGE_UNAVAILABLE', 'Focus storage is unavailable. The owner must approve and apply the reviewed Atlas focus schema proposal and its new-object access before this feature can save sessions.');
  }
  if (message.includes('FOCUS_PROJECT_NOT_FOUND')) return apiError(c, 404, 'FOCUS_PROJECT_NOT_FOUND', 'Choose an existing Atlas project.');
  if (message.includes('FOCUS_PROJECT_UNAVAILABLE')) return apiError(c, 409, 'FOCUS_PROJECT_UNAVAILABLE', 'Choose a project that is not archived, completed or canceled.');
  if (message.includes('FOCUS_INVALID_STATE')) return apiError(c, 409, 'FOCUS_INVALID_STATE', 'This timer command is not available in the current state. Refresh the timer.');
  if (failure.code === '22023') return apiError(c, 400, message.startsWith('FOCUS_') ? message : 'FOCUS_INVALID_COMMAND', 'The focus command or history query is invalid.');
  console.error(`[focus] ${command ? 'command outcome uncertain' : 'read failed'}: ${failure.code || 'unknown'} ${message}`);
  return command
    ? apiError(c, 503, 'FOCUS_COMMAND_UNCERTAIN', 'Unable to confirm this command. Retry the exact same operation_id and payload before issuing another command.')
    : apiError(c, 503, 'FOCUS_READ_FAILED', 'Unable to load focus data. Retry when the connection is available.');
}

router.get('/', async c => {
  try {
    const { data, error } = await getDb(c.env).rpc('atlas_focus_get_state', { p_owner: getActor(c) });
    if (error) throw error;
    if (!data) throw new Error('Empty focus state response.');
    return c.json(data);
  } catch (error) { return focusError(c, error); }
});

router.post('/commands', async c => {
  try {
    const request = await readFocusCommand(c.req.raw);
    // The DB fingerprints the entire canonical request, including expected_revision.
    // A receipt replay deliberately retains the original server_now/revision/result.
    // After acknowledging any success, clients GET /api/focus for current authoritative time/state.
    const { data, error } = await getDb(c.env).rpc('atlas_focus_command', { p_owner: getActor(c), p_request: request });
    if (error) throw error;
    if (!data) throw new Error('Empty focus command response.');
    return c.json(data);
  } catch (error) { return focusError(c, error, true); }
});

router.get('/history', async c => {
  try {
    const query = parseFocusHistoryQuery(new URL(c.req.url).searchParams);
    const { data, error } = await getDb(c.env).rpc('atlas_focus_history', {
      p_owner: getActor(c), p_limit: query.limit, p_project_id: query.project_id,
      p_cursor_ended_at: query.cursor?.ended_at || null, p_cursor_id: query.cursor?.id || null,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('Empty focus history response.');
    return c.json({ ...data, next_cursor: encodeFocusCursor(data.next_cursor) });
  } catch (error) { return focusError(c, error); }
});

export default router;
