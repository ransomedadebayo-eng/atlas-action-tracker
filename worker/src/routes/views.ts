import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { serializeJsonObject } from '../utils/json';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';

const router = new Hono<{ Bindings: Env }>();
type Row = Record<string, unknown>;
const ENTITY_TYPES = new Set(['action', 'project', 'initiative']);
const LAYOUTS = new Set(['list', 'board', 'timeline']);
const GROUPS = new Set(['none', 'lead', 'owner', 'member', 'status', 'health', 'business', 'label', 'start_date', 'target_date', 'priority', 'project', 'initiative', 'cycle', 'parent']);
const ZOOMS = new Set(['week', 'month', 'quarter', 'year']);
const ACTION_SORTS = new Set(['manual', 'priority', 'status', 'updated_at', 'created_at', 'due_date', 'title']);
const PROJECT_SORTS = new Set(['manual', 'priority', 'status', 'updated_at', 'created_at', 'start_date', 'target_date', 'name']);
const INITIATIVE_SORTS = new Set(['manual', 'priority', 'status', 'health', 'updated_at', 'created_at', 'start_date', 'target_date', 'name']);

export function validateSavedView(body: Row, partial = false): string[] {
  const errors: string[] = [];
  const entityType = String(body.entity_type || 'action');
  if (!partial && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name is required');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200)) errors.push('name must be 1-200 characters');
  if (body.entity_type !== undefined && !ENTITY_TYPES.has(entityType)) errors.push('entity_type must be action, project, or initiative');
  if (body.layout !== undefined && !LAYOUTS.has(String(body.layout))) errors.push('layout must be list, board, or timeline');
  if (body.layout === 'timeline' && entityType === 'action') errors.push('timeline layout is available only for project or initiative views');
  if (body.layout === 'board' && entityType === 'initiative') errors.push('board layout is not available for initiative views');
  if (body.group_by !== undefined && body.group_by !== null && !GROUPS.has(String(body.group_by))) errors.push('group_by is invalid');
  if (body.subgroup_by !== undefined && body.subgroup_by !== null && !GROUPS.has(String(body.subgroup_by))) errors.push('subgroup_by is invalid');
  if (body.sort_dir !== undefined && !['asc', 'desc'].includes(String(body.sort_dir))) errors.push('sort_dir must be asc or desc');
  if (body.sort_by !== undefined) {
    const allowed = entityType === 'project' ? PROJECT_SORTS : entityType === 'initiative' ? INITIATIVE_SORTS : ACTION_SORTS;
    if (!allowed.has(String(body.sort_by))) errors.push('sort_by is invalid for the entity type');
  }
  if (body.filters !== undefined && (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters))) errors.push('filters must be an object');
  if (body.display_options !== undefined && (!body.display_options || typeof body.display_options !== 'object' || Array.isArray(body.display_options))) errors.push('display_options must be an object');
  if (body.display_options && typeof body.display_options === 'object' && !Array.isArray(body.display_options)) {
    const zoom = (body.display_options as Row).zoom;
    if (zoom !== undefined && !ZOOMS.has(String(zoom))) errors.push('display_options.zoom must be week, month, quarter, or year');
  }
  if (body.context_project_id && body.context_initiative_id) errors.push('a saved view can have only one context');
  return errors;
}

router.get('/', async (c) => {
  try {
    let query = getDb(c.env).from('atlas_saved_views').select('*');
    const entityType = c.req.query('entity_type');
    const contextProjectId = c.req.query('context_project_id');
    const contextInitiativeId = c.req.query('context_initiative_id');
    if (entityType) query = query.eq('entity_type', entityType);
    if (contextProjectId === '__null__') query = query.is('context_project_id', null);
    else if (contextProjectId) query = query.eq('context_project_id', contextProjectId);
    if (contextInitiativeId === '__null__') query = query.is('context_initiative_id', null);
    else if (contextInitiativeId) query = query.eq('context_initiative_id', contextInitiativeId);
    if (c.req.query('archived') === 'true') query = query.not('archived_at', 'is', null);
    else query = query.is('archived_at', null);
    if (c.req.query('favorite') === 'true') query = query.eq('is_favorite', true);
    const { data, error } = await query.order('is_favorite', { ascending: false }).order('name', { ascending: true });
    if (error) throw error;
    return c.json(data || []);
  } catch (error) {
    console.error(`[views] list error: ${(error as Error).message}`);
    return apiError(c, 500, 'VIEW_LIST_FAILED', 'Unable to load saved views.');
  }
});

router.post('/', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as Row;
    const errors = validateSavedView(body);
    if (errors.length > 0) return apiError(c, 400, 'INVALID_SAVED_VIEW', errors.join('; '));
    const actor = getActor(c);
    const now = new Date().toISOString();
    const entityType = String(body.entity_type || 'action');
    const { data, error } = await getDb(c.env).from('atlas_saved_views').insert({
      id: uuidv4(), name: String(body.name).trim(), entity_type: entityType,
      context_project_id: body.context_project_id || null,
      context_initiative_id: body.context_initiative_id || null,
      filters: serializeJsonObject(body.filters || {}),
      layout: body.layout || 'list', group_by: body.group_by || null,
      subgroup_by: body.subgroup_by || null,
      sort_by: body.sort_by || 'priority', sort_dir: body.sort_dir || 'asc',
      display_options: serializeJsonObject(body.display_options || {}),
      is_favorite: body.is_favorite === true, is_default: body.is_default === true,
      created_by: actor, updated_by: actor, created_at: now, updated_at: now,
    }).select().single();
    if (error?.code === '23505') return apiError(c, 409, 'VIEW_DEFAULT_CONFLICT', 'Only one active default view is allowed for this context.');
    if (error) throw error;
    return c.json(data, 201);
  } catch (error) {
    console.error(`[views] create error: ${(error as Error).message}`);
    return apiError(c, 500, 'VIEW_CREATE_FAILED', 'Unable to create the saved view.');
  }
});

router.put('/:id', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const supabase = getDb(c.env);
    const { data: existing, error: fetchError } = await supabase.from('atlas_saved_views').select('*').eq('id', c.req.param('id')).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return apiError(c, 404, 'VIEW_NOT_FOUND', 'Saved view not found.');
    if (existing.archived_at) return apiError(c, 409, 'VIEW_ARCHIVED', 'Restore the view before editing it.');
    if (!Number.isSafeInteger(body.expected_revision) || Number(body.expected_revision) !== Number(existing.revision)) return apiError(c, 409, 'REVISION_CONFLICT', 'The saved view changed. Refresh and retry.');
    const candidate = { ...existing, ...body } as Row;
    const errors = validateSavedView(candidate, true);
    if (errors.length > 0) return apiError(c, 400, 'INVALID_SAVED_VIEW', errors.join('; '));
    const updates: Row = {};
    for (const field of ['name', 'entity_type', 'context_project_id', 'context_initiative_id', 'layout', 'group_by', 'subgroup_by', 'sort_by', 'sort_dir', 'is_favorite', 'is_default']) {
      if (body[field] !== undefined) updates[field] = body[field] === '' ? null : body[field];
    }
    if (body.filters !== undefined) updates.filters = serializeJsonObject(body.filters);
    if (body.display_options !== undefined) updates.display_options = serializeJsonObject(body.display_options);
    updates.revision = Number(existing.revision || 0) + 1;
    updates.updated_by = getActor(c);
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('atlas_saved_views').update(updates).eq('id', existing.id).eq('revision', existing.revision).select().maybeSingle();
    if (error?.code === '23505') return apiError(c, 409, 'VIEW_DEFAULT_CONFLICT', 'Only one active default view is allowed for this context.');
    if (error) throw error;
    if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The saved view changed. Refresh and retry.');
    return c.json(data);
  } catch (error) {
    console.error(`[views] update error: ${(error as Error).message}`);
    return apiError(c, 500, 'VIEW_UPDATE_FAILED', 'Unable to update the saved view.');
  }
});

async function transitionView(c: any, archived: boolean) {
  try {
    const supabase = getDb(c.env);
    const body = await c.req.json().catch(() => ({})) as Row;
    const { data: existing, error: fetchError } = await supabase.from('atlas_saved_views').select('*').eq('id', c.req.param('id')).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return apiError(c, 404, 'VIEW_NOT_FOUND', 'Saved view not found.');
    if (!Number.isSafeInteger(body.expected_revision) || Number(body.expected_revision) !== Number(existing.revision)) return apiError(c, 409, 'REVISION_CONFLICT', 'The saved view changed. Refresh and retry.');
    const { data, error } = await supabase.from('atlas_saved_views').update({
      archived_at: archived ? new Date().toISOString() : null,
      is_default: archived ? false : existing.is_default,
      revision: Number(existing.revision || 0) + 1,
      updated_by: getActor(c), updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('revision', existing.revision).select().maybeSingle();
    if (error) throw error;
    if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The saved view changed. Refresh and retry.');
    return c.json(data);
  } catch (error) {
    console.error(`[views] transition error: ${(error as Error).message}`);
    return apiError(c, 500, 'VIEW_TRANSITION_FAILED', 'Unable to transition the saved view.');
  }
}

router.post('/:id/archive', c => transitionView(c, true));
router.post('/:id/restore', c => transitionView(c, false));
router.delete('/:id', c => {
  c.header('Allow', 'GET, POST, PUT');
  return apiError(c, 405, 'HARD_DELETE_DISABLED', 'Saved views cannot be deleted. Use the archive endpoint.');
});

export default router;
