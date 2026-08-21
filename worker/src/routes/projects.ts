import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, getDb } from '../db';
import { sanitizeBody, validateStringLengths, parsePagination } from '../middleware/validate';
import { validateKnownBusinessId, validateKnownMemberIds } from '../utils/referenceData';
import { serializeJsonArray } from '../utils/json';
import { buildSafeIlikePattern } from '../utils/search';
import { getActor } from '../utils/actors';
import { apiError } from '../utils/http';
import { validateConfiguredEstimate } from '../utils/estimates';

const router = new Hono<{ Bindings: Env }>();
const PROJECT_STATUSES = new Set(['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled', 'archived']);
const PROJECT_HEALTH = new Set(['on_track', 'at_risk', 'off_track', 'no_update']);
const PROJECT_PRIORITIES = new Set(['p0', 'p1', 'p2', 'p3']);
const UPDATE_FREQUENCIES = new Set(['weekly', 'biweekly', 'monthly', 'never']);
const MILESTONE_STATUSES = new Set(['planned', 'in_progress', 'completed', 'archived']);
const COMPLETED_ACTION_STATUSES = new Set(['done', 'completed', 'closed']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PROJECT_TEXT_FIELDS = ['name', 'summary', 'description', 'business', 'lead_id', 'color', 'icon', 'update_frequency'];
const PROJECT_MUTABLE_FIELDS = [
  'name', 'summary', 'description', 'business', 'status', 'health', 'priority', 'lead_id',
  'members', 'start_date', 'target_date', 'color', 'icon', 'update_frequency',
];

type Row = Record<string, unknown>;

function parseExpectedRevision(value: unknown): { value: number | null; error: string | null } {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return { value: null, error: 'expected_revision must be a non-negative integer.' };
  }
  return { value, error: null };
}

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateProjectBody(body: Row, partial = false): string[] {
  const errors: string[] = [];
  if (!partial && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name is required');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name must be a non-empty string');
  if (body.status !== undefined && !PROJECT_STATUSES.has(String(body.status))) errors.push('status is invalid');
  if (body.health !== undefined && !PROJECT_HEALTH.has(String(body.health))) errors.push('health is invalid');
  if (body.priority !== undefined && body.priority !== null && body.priority !== '' && !PROJECT_PRIORITIES.has(String(body.priority))) errors.push('priority is invalid');
  if (body.update_frequency !== undefined && !UPDATE_FREQUENCIES.has(String(body.update_frequency))) errors.push('update_frequency is invalid');
  if (body.members !== undefined && (!Array.isArray(body.members) || !body.members.every(member => typeof member === 'string' && member.trim()))) errors.push('members must be an array of member ids');
  if (body.lead_id !== undefined && body.lead_id !== null && (typeof body.lead_id !== 'string' || !body.lead_id.trim())) errors.push('lead_id must be a member id or null');
  for (const field of ['start_date', 'target_date']) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '' && !validDate(body[field])) errors.push(`${field} must be a valid YYYY-MM-DD date or null`);
  }
  if (validDate(body.start_date) && validDate(body.target_date) && String(body.start_date) > String(body.target_date)) errors.push('start_date must not be after target_date');
  return errors;
}

export function validateMilestoneBody(body: Row, partial = false): string[] {
  const errors: string[] = [];
  if (!partial && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name is required');
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) errors.push('name must be a non-empty string');
  if (body.status !== undefined && !MILESTONE_STATUSES.has(String(body.status))) errors.push('status is invalid');
  if (body.target_date !== undefined && body.target_date !== null && body.target_date !== '' && !validDate(body.target_date)) errors.push('target_date must be a valid YYYY-MM-DD date or null');
  if (body.sort_order !== undefined && (!Number.isSafeInteger(body.sort_order) || Number(body.sort_order) < 0)) errors.push('sort_order must be a non-negative integer');
  return errors;
}

export function calculateProjectProgress(actions: Row[], unestimatedValue = 1) {
  const totalIssues = actions.length;
  const completedIssues = actions.filter(action => COMPLETED_ACTION_STATUSES.has(String(action.status))).length;
  const blockedIssues = actions.filter(action => action.status === 'blocked').length;
  const totalEffort = actions.reduce((sum, action) => sum + (Number.isInteger(action.estimate_points) ? Number(action.estimate_points) : unestimatedValue), 0);
  const completedEffort = actions.reduce((sum, action) => {
    if (!COMPLETED_ACTION_STATUSES.has(String(action.status))) return sum;
    return sum + (Number.isInteger(action.estimate_points) ? Number(action.estimate_points) : unestimatedValue);
  }, 0);
  return {
    total_issues: totalIssues,
    completed_issues: completedIssues,
    blocked_issues: blockedIssues,
    active_issues: Math.max(0, totalIssues - completedIssues),
    total_effort: totalEffort,
    completed_effort: completedEffort,
    progress_percent: totalEffort === 0 ? 0 : Math.round((completedEffort / totalEffort) * 100),
  };
}

async function validateProjectReferences(supabase: ReturnType<typeof getDb>, body: Row): Promise<string[]> {
  const errors: string[] = [];
  const businessError = await validateKnownBusinessId(supabase, body.business);
  if (businessError) errors.push(businessError);
  errors.push(...await validateKnownMemberIds(supabase, body.members, 'members'));
  if (body.lead_id !== undefined && body.lead_id !== null) {
    const lead = [body.lead_id];
    errors.push(...await validateKnownMemberIds(supabase, lead, 'lead_id'));
    if (errors.length === 0) body.lead_id = lead[0];
  }
  return errors;
}

async function getProject(supabase: ReturnType<typeof getDb>, id: string): Promise<Row | null> {
  const { data, error } = await supabase.from('atlas_projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Row | null) || null;
}

function projectRpcError(c: Parameters<typeof apiError>[0], error: { code?: string; message?: string }, fallbackCode: string, fallbackMessage: string) {
  const message = error.message || '';
  if (error.code === '40001' || message.includes('REVISION_CONFLICT')) return apiError(c, 409, 'REVISION_CONFLICT', 'The project changed. Refresh and retry.');
  if (error.code === 'P0002' || message.includes('NOT_FOUND')) return apiError(c, 404, 'PROJECT_REFERENCE_NOT_FOUND', 'The project, action, or milestone was not found.');
  if (error.code === '22023' || error.code === '23503' || error.code === '23514') return apiError(c, 400, 'INVALID_PROJECT_OPERATION', message || fallbackMessage);
  if (error.code === '55000' || message.includes('ARCHIVED')) return apiError(c, 409, 'PROJECT_ARCHIVED', 'Restore the project before changing it.');
  console.error(`[projects] RPC error: ${message || error.code || 'unknown error'}`);
  return apiError(c, 500, fallbackCode, fallbackMessage);
}

export function isProjectDependencyViolated(blocking: Row, blocked: Row): boolean {
  const blockingEnd = typeof blocking.target_date === 'string' ? blocking.target_date : null;
  const blockedStart = typeof blocked.start_date === 'string' ? blocked.start_date : (typeof blocked.target_date === 'string' ? blocked.target_date : null);
  return Boolean(blockingEnd && blockedStart && blockingEnd > blockedStart);
}

function priorityRank(value: unknown) {
  return ({ p0: 0, p1: 1, p2: 2, p3: 3 } as Record<string, number>)[String(value)] ?? 4;
}

export function sortProjectsForView(projects: Row[], sortBy = 'updated_at', sortDir = 'desc') {
  const direction = sortDir === 'asc' ? 1 : -1;
  return [...projects].sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'priority') comparison = priorityRank(a.priority) - priorityRank(b.priority) || Number(a.sort_order || 0) - Number(b.sort_order || 0);
    else if (sortBy === 'manual') comparison = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    else comparison = String(a[sortBy] ?? 'zzzz').localeCompare(String(b[sortBy] ?? 'zzzz'));
    return comparison * direction;
  });
}

export function includeProjectByCompletedWindow(project: Row, window = 'month', now = new Date()) {
  if (project.status !== 'completed') return true;
  if (window === 'all') return true;
  if (window === 'none') return false;
  const days = window === 'week' ? 7 : window === 'year' ? 365 : 31;
  const completed = typeof project.completed_at === 'string' ? new Date(project.completed_at) : null;
  return Boolean(completed && !Number.isNaN(completed.valueOf()) && completed.valueOf() >= now.valueOf() - days * 86400000);
}

async function loadProjectAggregate(supabase: ReturnType<typeof getDb>, project: Row) {
  const projectId = String(project.id);
  const [actionsResult, milestonesResult, updatesResult, blockedResult, blockingResult, activityResult, estimateResult, initiativeMembershipResult] = await Promise.all([
    supabase.from('atlas_actions').select('*').eq('project_id', projectId).order('priority', { ascending: true }).order('due_date', { ascending: true, nullsFirst: false }),
    supabase.from('atlas_project_milestones').select('*').eq('project_id', projectId).order('sort_order', { ascending: true }).order('target_date', { ascending: true, nullsFirst: false }),
    supabase.from('atlas_project_updates').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('atlas_project_dependencies').select('*').eq('blocked_project_id', projectId).eq('status', 'active'),
    supabase.from('atlas_project_dependencies').select('*').eq('blocking_project_id', projectId).eq('status', 'active'),
    supabase.from('atlas_project_activity_log').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(100),
    supabase.from('atlas_config').select('value').eq('key', 'estimate_settings').maybeSingle(),
    supabase.from('atlas_initiative_projects').select('initiative_id').eq('project_id', projectId).eq('status', 'active'),
  ]);
  for (const result of [actionsResult, milestonesResult, updatesResult, blockedResult, blockingResult, activityResult, estimateResult, initiativeMembershipResult]) {
    if (result.error) throw result.error;
  }
  const dependencies: Row[] = [
    ...((blockedResult.data || []) as Row[]).map(row => ({ ...row, direction: 'blocked_by' })),
    ...((blockingResult.data || []) as Row[]).map(row => ({ ...row, direction: 'blocking' })),
  ];
  const relatedIds = Array.from(new Set(dependencies.flatMap(row => [String(row.blocked_project_id), String(row.blocking_project_id)]).filter(id => id !== projectId)));
  let relatedProjects: Row[] = [];
  if (relatedIds.length > 0) {
    const relatedResult = await supabase.from('atlas_projects').select('id,name,status,health,target_date').in('id', relatedIds);
    if (relatedResult.error) throw relatedResult.error;
    relatedProjects = (relatedResult.data || []) as Row[];
  }
  const relatedById = new Map(relatedProjects.map(row => [String(row.id), row]));
  const hydratedDependencies = dependencies.map(row => {
    const otherId = String(row.blocked_project_id) === projectId ? String(row.blocking_project_id) : String(row.blocked_project_id);
    return { ...row, related_project: relatedById.get(otherId) || null };
  });
  const actions = (actionsResult.data || []) as Row[];
  const initiativeIds = (initiativeMembershipResult.data || []).map(row => row.initiative_id);
  let initiatives: Row[] = [];
  if (initiativeIds.length > 0) {
    const initiativeResult = await supabase.from('atlas_initiatives').select('id,name,status,health,priority,target_date').in('id', initiativeIds);
    if (initiativeResult.error) throw initiativeResult.error;
    initiatives = (initiativeResult.data || []) as Row[];
  }
  const estimateValue = estimateResult.data?.value as Row | undefined;
  const unestimatedValue = Number.isSafeInteger(estimateValue?.unestimated_value) ? Number(estimateValue?.unestimated_value) : 1;
  return {
    ...project,
    progress: calculateProjectProgress(actions, unestimatedValue),
    actions,
    milestones: milestonesResult.data || [],
    updates: updatesResult.data || [],
    dependencies: hydratedDependencies,
    initiatives,
    activity: activityResult.data || [],
  };
}

async function optimisticProjectUpdate(
  supabase: ReturnType<typeof getDb>,
  project: Row,
  expectedRevision: number,
  updates: Row,
) {
  const nextRevision = Number(project.revision || 0) + 1;
  const { data, error } = await supabase
    .from('atlas_projects')
    .update({ ...updates, revision: nextRevision, updated_at: new Date().toISOString() })
    .eq('id', project.id)
    .eq('revision', expectedRevision)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

router.get('/', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { status, business, health, lead_id, search, sort_by, sort_dir, completed_window, dependency, milestone, initiative, template_id, start_before, target_after } = c.req.query() as Record<string, string>;
    let query = supabase.from('atlas_projects').select('*');
    if (status) query = query.in('status', status.split(',').filter(value => PROJECT_STATUSES.has(value)));
    else query = query.neq('status', 'archived');
    if (business) query = query.eq('business', business);
    if (health) query = query.in('health', health.split(',').filter(value => PROJECT_HEALTH.has(value)));
    if (lead_id) query = query.eq('lead_id', lead_id);
    if (start_before) query = query.lte('start_date', start_before);
    if (target_after) query = query.gte('target_date', target_after);
    if (template_id === '__null__') query = query.is('template_id', null);
    else if (template_id) query = query.eq('template_id', template_id);
    const searchTerm = buildSafeIlikePattern(search);
    if (searchTerm) query = query.or(`name.ilike.${searchTerm},summary.ilike.${searchTerm},description.ilike.${searchTerm}`);
    const { limit, offset } = parsePagination(c.req.query() as Record<string, string>);
    const { data, error } = await query;
    if (error) throw error;
    let projects = ((data || []) as Row[]).filter(project => includeProjectByCompletedWindow(project, completed_window || 'month'));
    const ids = projects.map(project => String(project.id));
    let actions: Row[] = [];
    let milestones: Row[] = [];
    let dependencies: Row[] = [];
    let initiativeMemberships: Row[] = [];
    let initiatives: Row[] = [];
    if (ids.length > 0) {
      const [actionsResult, milestonesResult, dependenciesResult, initiativeMembershipResult] = await Promise.all([
        supabase.from('atlas_actions').select('id,project_id,status,estimate_points').in('project_id', ids),
        supabase.from('atlas_project_milestones').select('*').in('project_id', ids).neq('status', 'archived').order('sort_order', { ascending: true }),
        supabase.from('atlas_project_dependencies').select('*').eq('status', 'active').or(`blocked_project_id.in.(${ids.join(',')}),blocking_project_id.in.(${ids.join(',')})`),
        supabase.from('atlas_initiative_projects').select('initiative_id,project_id').eq('status', 'active').in('project_id', ids),
      ]);
      if (actionsResult.error) throw actionsResult.error;
      if (milestonesResult.error) throw milestonesResult.error;
      if (dependenciesResult.error) throw dependenciesResult.error;
      if (initiativeMembershipResult.error) throw initiativeMembershipResult.error;
      actions = (actionsResult.data || []) as Row[];
      milestones = (milestonesResult.data || []) as Row[];
      dependencies = (dependenciesResult.data || []) as Row[];
      initiativeMemberships = (initiativeMembershipResult.data || []) as Row[];
      const initiativeIds = Array.from(new Set(initiativeMemberships.map(item => String(item.initiative_id))));
      if (initiativeIds.length > 0) {
        const initiativeResult = await supabase.from('atlas_initiatives').select('id,name,status,health,priority,target_date').in('id', initiativeIds);
        if (initiativeResult.error) throw initiativeResult.error;
        initiatives = (initiativeResult.data || []) as Row[];
      }
    }
    const estimateResult = await supabase.from('atlas_config').select('value').eq('key', 'estimate_settings').maybeSingle();
    if (estimateResult.error) throw estimateResult.error;
    const estimateValue = estimateResult.data?.value as Row | undefined;
    const unestimatedValue = Number.isSafeInteger(estimateValue?.unestimated_value) ? Number(estimateValue?.unestimated_value) : 1;
    const projectById = new Map(projects.map(project => [String(project.id), project]));
    projects = projects.map(project => {
      const projectDependencies = dependencies.filter(item => item.blocked_project_id === project.id || item.blocking_project_id === project.id).map(item => {
        const blockingProject = projectById.get(String(item.blocking_project_id));
        const blockedProject = projectById.get(String(item.blocked_project_id));
        return { ...item, violated: Boolean(blockingProject && blockedProject && isProjectDependencyViolated(blockingProject, blockedProject)) };
      });
      return {
        ...project,
        progress: calculateProjectProgress(actions.filter(action => action.project_id === project.id), unestimatedValue),
        milestones: milestones.filter(item => item.project_id === project.id),
        dependencies: projectDependencies,
        initiatives: initiativeMemberships.filter(item => item.project_id === project.id).map(item => initiatives.find(candidate => candidate.id === item.initiative_id)).filter(Boolean),
      };
    });
    if (initiative) projects = projects.filter(project => (project.initiatives as Row[]).some(item => item.id === initiative || String(item.name).toLowerCase().includes(initiative.toLowerCase())));
    if (milestone) projects = projects.filter(project => (project.milestones as Row[]).some(item => item.id === milestone || String(item.name).toLowerCase().includes(milestone.toLowerCase())));
    if (dependency === 'any') projects = projects.filter(project => (project.dependencies as Row[]).length > 0);
    if (dependency === 'blocking') projects = projects.filter(project => (project.dependencies as Row[]).some(item => item.blocking_project_id === project.id));
    if (dependency === 'blocked_by') projects = projects.filter(project => (project.dependencies as Row[]).some(item => item.blocked_project_id === project.id));
    if (dependency === 'violated') projects = projects.filter(project => (project.dependencies as Row[]).some(item => item.violated));
    if (dependency === 'none') projects = projects.filter(project => (project.dependencies as Row[]).length === 0);
    const sortFields = new Set(['name', 'status', 'health', 'priority', 'manual', 'start_date', 'target_date', 'created_at', 'updated_at']);
    const sorted = sortProjectsForView(projects, sortFields.has(sort_by) ? sort_by : 'updated_at', sort_dir || 'desc');
    const items = sorted.slice(offset, offset + limit);
    return c.json({
      items,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
      total: sorted.length,
      has_more: offset + items.length < sorted.length,
      as_of: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`[projects] list error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_LIST_FAILED', 'Unable to load projects.');
  }
});

router.post('/', async (c) => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    const body = sanitizeBody(raw, PROJECT_TEXT_FIELDS);
    const supabase = getDb(c.env);
    const errors = [...validateProjectBody(body), ...validateStringLengths(body), ...await validateProjectReferences(supabase, body)];
    if (errors.length > 0) return apiError(c, 400, 'INVALID_PROJECT', errors.join('; '));
    const actor = getActor(c);
    const now = new Date().toISOString();
    const project: Row = {
      id: uuidv4(),
      name: String(body.name).trim(),
      summary: typeof body.summary === 'string' ? body.summary : '',
      description: typeof body.description === 'string' ? body.description : '',
      business: body.business || null,
      status: body.status || 'planned',
      health: body.health || 'no_update',
      priority: body.priority || null,
      lead_id: body.lead_id || 'ransomed',
      members: serializeJsonArray(body.members === undefined ? ['ransomed'] : body.members),
      start_date: body.start_date || null,
      target_date: body.target_date || null,
      color: body.color || null,
      icon: body.icon || null,
      update_frequency: body.update_frequency || 'weekly',
      created_by: actor,
      updated_by: actor,
      created_at: now,
      updated_at: now,
    };
    const { data, error } = await supabase.from('atlas_projects').insert(project).select().single();
    if (error) throw error;
    return c.json(data, 201);
  } catch (error) {
    console.error(`[projects] create error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_CREATE_FAILED', 'Unable to create the project.');
  }
});

router.get('/:id', async (c) => {
  try {
    const supabase = getDb(c.env);
    const project = await getProject(supabase, c.req.param('id'));
    if (!project) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    return c.json(await loadProjectAggregate(supabase, project));
  } catch (error) {
    console.error(`[projects] detail error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_LOAD_FAILED', 'Unable to load the project.');
  }
});

router.put('/:id', async (c) => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    const revision = parseExpectedRevision(raw.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const body = sanitizeBody(raw, PROJECT_TEXT_FIELDS);
    if (body.status === 'archived') return apiError(c, 400, 'PROJECT_TRANSITION_REQUIRED', 'Use the archive endpoint.');
    const supabase = getDb(c.env);
    const project = await getProject(supabase, c.req.param('id'));
    if (!project) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    if (project.status === 'archived') return apiError(c, 409, 'PROJECT_ARCHIVED', 'Restore the project before editing it.');
    const errors = [...validateProjectBody(body, true), ...validateStringLengths(body), ...await validateProjectReferences(supabase, body)];
    if (errors.length > 0) return apiError(c, 400, 'INVALID_PROJECT', errors.join('; '));
    const updates: Row = {};
    for (const field of PROJECT_MUTABLE_FIELDS) {
      if (body[field] !== undefined) updates[field] = body[field] === '' ? null : body[field];
    }
    if (updates.members !== undefined) updates.members = serializeJsonArray(updates.members);
    if (Object.keys(updates).length === 0) return apiError(c, 400, 'NO_PROJECT_CHANGES', 'No project fields were provided.');
    const actor = getActor(c);
    updates.updated_by = actor;
    const saved = await optimisticProjectUpdate(supabase, project, revision.value as number, updates);
    if (!saved) return apiError(c, 409, 'REVISION_CONFLICT', 'The project changed since it was loaded. Refresh and retry.');
    return c.json(saved);
  } catch (error) {
    console.error(`[projects] update error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_UPDATE_FAILED', 'Unable to update the project.');
  }
});

router.post('/:id/archive', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const supabase = getDb(c.env);
    const project = await getProject(supabase, c.req.param('id'));
    if (!project) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    if (project.status === 'archived') return c.json(project);
    const actor = getActor(c);
    const saved = await optimisticProjectUpdate(supabase, project, revision.value as number, {
      status: 'archived', archived_from_status: project.status, updated_by: actor,
    });
    if (!saved) return apiError(c, 409, 'REVISION_CONFLICT', 'The project changed since it was loaded. Refresh and retry.');
    return c.json(saved);
  } catch (error) {
    console.error(`[projects] archive error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_ARCHIVE_FAILED', 'Unable to archive the project.');
  }
});

router.post('/:id/restore', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const supabase = getDb(c.env);
    const project = await getProject(supabase, c.req.param('id'));
    if (!project) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    if (project.status !== 'archived') return c.json(project);
    const actor = getActor(c);
    const restoredStatus = PROJECT_STATUSES.has(String(project.archived_from_status)) && project.archived_from_status !== 'archived'
      ? project.archived_from_status : 'planned';
    const saved = await optimisticProjectUpdate(supabase, project, revision.value as number, {
      status: restoredStatus, archived_from_status: null, updated_by: actor,
    });
    if (!saved) return apiError(c, 409, 'REVISION_CONFLICT', 'The project changed since it was loaded. Refresh and retry.');
    return c.json(saved);
  } catch (error) {
    console.error(`[projects] restore error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_RESTORE_FAILED', 'Unable to restore the project.');
  }
});

router.post('/:id/milestones', async (c) => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    const body = sanitizeBody(raw, ['name', 'description']);
    const errors = [...validateMilestoneBody(body), ...validateStringLengths(body)];
    if (errors.length > 0) return apiError(c, 400, 'INVALID_MILESTONE', errors.join('; '));
    const supabase = getDb(c.env);
    const project = await getProject(supabase, c.req.param('id'));
    if (!project) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    if (project.status === 'archived') return apiError(c, 409, 'PROJECT_ARCHIVED', 'Restore the project before adding a milestone.');
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_project_milestones').insert({
      id: uuidv4(), project_id: project.id, name: body.name, description: body.description || '',
      target_date: body.target_date || null, status: body.status || 'planned', sort_order: body.sort_order || 0,
      created_by: actor, updated_by: actor,
    }).select().single();
    if (error) throw error;
    return c.json(data, 201);
  } catch (error) {
    console.error(`[projects] milestone create error: ${(error as Error).message}`);
    return apiError(c, 500, 'MILESTONE_CREATE_FAILED', 'Unable to create the milestone.');
  }
});

router.put('/:id/milestones/:milestoneId', async (c) => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    const revision = parseExpectedRevision(raw.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const body = sanitizeBody(raw, ['name', 'description']);
    if (body.status === 'archived') return apiError(c, 400, 'MILESTONE_TRANSITION_REQUIRED', 'Use the milestone archive endpoint.');
    const errors = [...validateMilestoneBody(body, true), ...validateStringLengths(body)];
    if (errors.length > 0) return apiError(c, 400, 'INVALID_MILESTONE', errors.join('; '));
    const supabase = getDb(c.env);
    const { data: existing, error: fetchError } = await supabase.from('atlas_project_milestones').select('*').eq('id', c.req.param('milestoneId')).eq('project_id', c.req.param('id')).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return apiError(c, 404, 'MILESTONE_NOT_FOUND', 'Milestone not found.');
    if (existing.status === 'archived') return apiError(c, 409, 'MILESTONE_ARCHIVED', 'Archived milestones cannot be edited.');
    const updates: Row = {};
    for (const field of ['name', 'description', 'target_date', 'status', 'sort_order']) if (body[field] !== undefined) updates[field] = body[field] === '' ? null : body[field];
    if (Object.keys(updates).length === 0) return apiError(c, 400, 'NO_MILESTONE_CHANGES', 'No milestone fields were provided.');
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_project_milestones').update({
      ...updates, revision: Number(existing.revision || 0) + 1, updated_by: actor, updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('revision', revision.value).select().maybeSingle();
    if (error) throw error;
    if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The milestone changed since it was loaded. Refresh and retry.');
    return c.json(data);
  } catch (error) {
    console.error(`[projects] milestone update error: ${(error as Error).message}`);
    return apiError(c, 500, 'MILESTONE_UPDATE_FAILED', 'Unable to update the milestone.');
  }
});

router.post('/:id/milestones/:milestoneId/archive', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    const supabase = getDb(c.env);
    const { data: existing, error: fetchError } = await supabase.from('atlas_project_milestones').select('*').eq('id', c.req.param('milestoneId')).eq('project_id', c.req.param('id')).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return apiError(c, 404, 'MILESTONE_NOT_FOUND', 'Milestone not found.');
    if (existing.status === 'archived') return c.json(existing);
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_project_milestones').update({
      status: 'archived', archived_from_status: existing.status, revision: Number(existing.revision || 0) + 1,
      updated_by: actor, updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('revision', revision.value).select().maybeSingle();
    if (error) throw error;
    if (!data) return apiError(c, 409, 'REVISION_CONFLICT', 'The milestone changed since it was loaded. Refresh and retry.');
    return c.json(data);
  } catch (error) {
    console.error(`[projects] milestone archive error: ${(error as Error).message}`);
    return apiError(c, 500, 'MILESTONE_ARCHIVE_FAILED', 'Unable to archive the milestone.');
  }
});

router.post('/:id/updates', async (c) => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    const body = sanitizeBody(raw, ['body']);
    if (!['on_track', 'at_risk', 'off_track'].includes(String(body.health))) return apiError(c, 400, 'INVALID_PROJECT_UPDATE', 'health must be on_track, at_risk, or off_track.');
    if (typeof body.body !== 'string' || !body.body.trim()) return apiError(c, 400, 'INVALID_PROJECT_UPDATE', 'body is required.');
    if (body.body.length > 10000) return apiError(c, 400, 'INVALID_PROJECT_UPDATE', 'body exceeds maximum length of 10000 characters.');
    const supabase = getDb(c.env);
    const project = await getProject(supabase, c.req.param('id'));
    if (!project) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    if (project.status === 'archived') return apiError(c, 409, 'PROJECT_ARCHIVED', 'Restore the project before posting an update.');
    const actor = getActor(c);
    const { data, error } = await supabase.rpc('post_atlas_project_update', {
      p_project_id: project.id,
      p_update_id: uuidv4(),
      p_health: body.health,
      p_body: body.body,
      p_actor: actor,
    });
    if (error) return projectRpcError(c, error, 'PROJECT_UPDATE_POST_FAILED', 'Unable to post the project update.');
    return c.json(data, 201);
  } catch (error) {
    console.error(`[projects] update post error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_UPDATE_POST_FAILED', 'Unable to post the project update.');
  }
});

router.post('/:id/dependencies', async (c) => {
  try {
    const raw = await c.req.json<Row>().catch(() => ({} as Row));
    const body = sanitizeBody(raw, ['note']);
    if (typeof body.blocking_project_id !== 'string' || !body.blocking_project_id) return apiError(c, 400, 'INVALID_PROJECT_DEPENDENCY', 'blocking_project_id is required.');
    if (body.blocking_project_id === c.req.param('id')) return apiError(c, 400, 'INVALID_PROJECT_DEPENDENCY', 'A project cannot block itself.');
    const supabase = getDb(c.env);
    const [blocked, blocking] = await Promise.all([getProject(supabase, c.req.param('id')), getProject(supabase, String(body.blocking_project_id))]);
    if (!blocked || !blocking) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Both projects must exist.');
    const actor = getActor(c);
    const dependency = {
      id: uuidv4(), blocked_project_id: blocked.id, blocking_project_id: blocking.id,
      status: 'active', note: body.note || '', created_by: actor, updated_by: actor,
    };
    const { data, error } = await supabase.from('atlas_project_dependencies').insert(dependency).select().single();
    if (error?.code === '23505') return apiError(c, 409, 'DEPENDENCY_EXISTS', 'This active dependency already exists.');
    if (error) throw error;
    return c.json(data, 201);
  } catch (error) {
    console.error(`[projects] dependency create error: ${(error as Error).message}`);
    return apiError(c, 500, 'DEPENDENCY_CREATE_FAILED', 'Unable to create the project dependency.');
  }
});

router.post('/:id/dependencies/:dependencyId/resolve', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data: existing, error: fetchError } = await supabase.from('atlas_project_dependencies').select('*').eq('id', c.req.param('dependencyId')).eq('blocked_project_id', c.req.param('id')).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return apiError(c, 404, 'DEPENDENCY_NOT_FOUND', 'Dependency not found.');
    if (existing.status !== 'active') return c.json(existing);
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_project_dependencies').update({ status: 'resolved', updated_by: actor, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
    if (error) throw error;
    return c.json(data);
  } catch (error) {
    console.error(`[projects] dependency resolve error: ${(error as Error).message}`);
    return apiError(c, 500, 'DEPENDENCY_RESOLVE_FAILED', 'Unable to resolve the project dependency.');
  }
});

router.post('/:id/dependencies/:dependencyId/archive', async (c) => {
  try {
    const supabase = getDb(c.env);
    const { data: existing, error: fetchError } = await supabase.from('atlas_project_dependencies').select('*').eq('id', c.req.param('dependencyId')).eq('blocked_project_id', c.req.param('id')).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return apiError(c, 404, 'DEPENDENCY_NOT_FOUND', 'Dependency not found.');
    if (existing.status === 'archived') return c.json(existing);
    const actor = getActor(c);
    const { data, error } = await supabase.from('atlas_project_dependencies').update({ status: 'archived', updated_by: actor, updated_at: new Date().toISOString() }).eq('id', existing.id).select().single();
    if (error) throw error;
    return c.json(data);
  } catch (error) {
    console.error(`[projects] dependency archive error: ${(error as Error).message}`);
    return apiError(c, 500, 'DEPENDENCY_ARCHIVE_FAILED', 'Unable to archive the project dependency.');
  }
});

router.post('/:id/actions/:actionId/assign', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const estimate = body.estimate_points;
    if (estimate !== undefined && estimate !== null && (!Number.isSafeInteger(estimate) || Number(estimate) < 0 || Number(estimate) > 100000)) {
      return apiError(c, 400, 'INVALID_ESTIMATE', 'estimate_points must be a non-negative integer up to 100000.');
    }
    const supabase = getDb(c.env);
    const estimateError = await validateConfiguredEstimate(supabase, estimate);
    if (estimateError) return apiError(c, 400, 'INVALID_ESTIMATE', estimateError);
    const project = await getProject(supabase, c.req.param('id'));
    if (!project) return apiError(c, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
    if (project.status === 'archived') return apiError(c, 409, 'PROJECT_ARCHIVED', 'Restore the project before assigning actions.');
    if (body.milestone_id) {
      const { data: milestone, error } = await supabase.from('atlas_project_milestones').select('id').eq('id', body.milestone_id).eq('project_id', project.id).neq('status', 'archived').maybeSingle();
      if (error) throw error;
      if (!milestone) return apiError(c, 400, 'INVALID_MILESTONE', 'The milestone must be active and belong to this project.');
    }
    const actor = getActor(c);
    const { data, error } = await supabase.rpc('assign_atlas_action_to_project', {
      p_project_id: project.id,
      p_action_id: c.req.param('actionId'),
      p_milestone_id: body.milestone_id || null,
      p_estimate_points: estimate === undefined ? null : estimate,
      p_actor: actor,
    });
    if (error) return projectRpcError(c, error, 'PROJECT_ACTION_ASSIGN_FAILED', 'Unable to assign the action to the project.');
    return c.json(data);
  } catch (error) {
    console.error(`[projects] action assign error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_ACTION_ASSIGN_FAILED', 'Unable to assign the action to the project.');
  }
});

router.post('/:id/actions/:actionId/remove', async (c) => {
  try {
    const actor = getActor(c);
    const { data, error } = await getDb(c.env).rpc('remove_atlas_action_from_project', {
      p_project_id: c.req.param('id'),
      p_action_id: c.req.param('actionId'),
      p_actor: actor,
    });
    if (error) return projectRpcError(c, error, 'PROJECT_ACTION_REMOVE_FAILED', 'Unable to remove the action from the project.');
    return c.json(data);
  } catch (error) {
    console.error(`[projects] action remove error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_ACTION_REMOVE_FAILED', 'Unable to remove the action from the project.');
  }
});

router.post('/:id/reorder', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    if (body.before_project_id !== null && body.before_project_id !== undefined && typeof body.before_project_id !== 'string') {
      return apiError(c, 400, 'INVALID_PROJECT_ORDER', 'before_project_id must be a project id or null.');
    }
    const { data, error } = await getDb(c.env).rpc('move_atlas_project_order', {
      p_project_id: c.req.param('id'), p_before_project_id: body.before_project_id || null,
      p_actor: getActor(c), p_expected_revision: revision.value,
    });
    if (error) return projectRpcError(c, error, 'PROJECT_REORDER_FAILED', 'Unable to reorder the project.');
    return c.json(data);
  } catch (error) {
    console.error(`[projects] reorder error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_REORDER_FAILED', 'Unable to reorder the project.');
  }
});

router.post('/:id/move-timeline', async (c) => {
  try {
    const body = await c.req.json<Row>().catch(() => ({} as Row));
    const revision = parseExpectedRevision(body.expected_revision);
    if (revision.error) return apiError(c, 400, 'INVALID_REVISION', revision.error);
    for (const field of ['start_date', 'target_date']) {
      if (body[field] !== null && body[field] !== undefined && !validDate(body[field])) return apiError(c, 400, 'INVALID_PROJECT_TIMEFRAME', `${field} must be YYYY-MM-DD or null.`);
    }
    if (body.start_date && body.target_date && String(body.start_date) > String(body.target_date)) return apiError(c, 400, 'INVALID_PROJECT_TIMEFRAME', 'start_date must not be after target_date.');
    const { data, error } = await getDb(c.env).rpc('move_atlas_project_timeline', {
      p_project_id: c.req.param('id'), p_start_date: body.start_date || null,
      p_target_date: body.target_date || null, p_shift_dependency_chain: body.shift_dependency_chain === true,
      p_actor: getActor(c), p_expected_revision: revision.value,
    });
    if (error) return projectRpcError(c, error, 'PROJECT_TIMELINE_MOVE_FAILED', 'Unable to move the project timeframe.');
    return c.json(data);
  } catch (error) {
    console.error(`[projects] timeline move error: ${(error as Error).message}`);
    return apiError(c, 500, 'PROJECT_TIMELINE_MOVE_FAILED', 'Unable to move the project timeframe.');
  }
});

router.delete('/:id', (c) => {
  c.header('Allow', 'GET, PUT, POST');
  return apiError(c, 405, 'HARD_DELETE_DISABLED', 'Projects cannot be deleted. Use POST /api/projects/:id/archive.');
});

export default router;
