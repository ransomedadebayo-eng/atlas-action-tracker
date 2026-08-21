import { describe, expect, it } from 'vitest';
import { requiredScopeForRequest } from './authorize';

describe('machine principal scope routing', () => {
  it('separates read, write, completion, and assignment scopes', () => {
    expect(requiredScopeForRequest('/api/actions', 'GET')).toBe('actions:read');
    expect(requiredScopeForRequest('/api/actions/123', 'PUT')).toBe('actions:write');
    expect(requiredScopeForRequest('/api/actions/123/complete', 'POST')).toBe('actions:complete');
    expect(requiredScopeForRequest('/api/actions/123/agent-assignment', 'POST')).toBe('actions:assign');
    expect(requiredScopeForRequest('/api/actions/123/duplicate', 'POST')).toBe('actions:complete');
    expect(requiredScopeForRequest('/api/actions/123/sub-actions', 'POST')).toBe('actions:write');
    expect(requiredScopeForRequest('/api/actions/123/convert-to-project', 'POST')).toBe('actions:write');
  });

  it('keeps the automation API read-only', () => {
    expect(requiredScopeForRequest('/api/automations/registry', 'GET')).toBe('automations:read');
    expect(requiredScopeForRequest('/api/automations/job/run', 'POST')).toBeNull();
  });

  it('routes weekly plan reads, drafts, review requests, and owner publication', () => {
    expect(requiredScopeForRequest('/api/weeks/2026-08-03', 'GET')).toBe('weeks:read');
    expect(requiredScopeForRequest('/api/weeks/drafts', 'POST')).toBe('weeks:write');
    expect(requiredScopeForRequest('/api/weeks/revisions/rev-1/request-review', 'POST')).toBe('weeks:request_review');
    expect(requiredScopeForRequest('/api/weeks/revisions/rev-1/publish', 'POST')).toBe('weeks:write');
  });

  it('separates project reads and writes', () => {
    expect(requiredScopeForRequest('/api/projects', 'GET')).toBe('projects:read');
    expect(requiredScopeForRequest('/api/projects/project-1', 'GET')).toBe('projects:read');
    expect(requiredScopeForRequest('/api/projects', 'POST')).toBe('projects:write');
    expect(requiredScopeForRequest('/api/projects/project-1/updates', 'POST')).toBe('projects:write');
  });

  it('separates cycle reads and scoped membership writes', () => {
    expect(requiredScopeForRequest('/api/cycles', 'GET')).toBe('cycles:read');
    expect(requiredScopeForRequest('/api/cycles/cycle-1', 'GET')).toBe('cycles:read');
    expect(requiredScopeForRequest('/api/cycles/cycle-1/actions/action-1/assign', 'POST')).toBe('cycles:write');
    expect(requiredScopeForRequest('/api/cycles/calendar.ics', 'GET')).toBe('cycles:read');
    expect(requiredScopeForRequest('/api/cycles/cycle-1/start-today', 'POST')).toBe('cycles:write');
  });

  it('separates initiative strategy reads and writes', () => {
    expect(requiredScopeForRequest('/api/initiatives', 'GET')).toBe('initiatives:read');
    expect(requiredScopeForRequest('/api/initiatives/i1/graph', 'GET')).toBe('initiatives:read');
    expect(requiredScopeForRequest('/api/initiatives/i1/projects/p1/attach', 'POST')).toBe('initiatives:write');
  });

  it('separates template and document reads from writes', () => {
    expect(requiredScopeForRequest('/api/templates', 'GET')).toBe('templates:read');
    expect(requiredScopeForRequest('/api/templates/t1/instantiate', 'POST')).toBe('templates:write');
    expect(requiredScopeForRequest('/api/documents/d1', 'GET')).toBe('documents:read');
    expect(requiredScopeForRequest('/api/documents/d1', 'PUT')).toBe('documents:write');
  });

  it('separates discussion reads from collaboration writes', () => {
    expect(requiredScopeForRequest('/api/comments', 'GET')).toBe('comments:read');
    expect(requiredScopeForRequest('/api/comments', 'POST')).toBe('comments:write');
    expect(requiredScopeForRequest('/api/comments/c1/resolve', 'POST')).toBe('comments:write');
  });

  it('separates release reads, owner configuration, and CI ingestion', () => {
    expect(requiredScopeForRequest('/api/releases/pipelines', 'GET')).toBe('releases:read');
    expect(requiredScopeForRequest('/api/releases/items/r1/transition', 'POST')).toBe('releases:write');
    expect(requiredScopeForRequest('/api/releases/ingest/p1', 'POST')).toBe('releases:ingest');
  });

  it('separates analytical reads, mutations, and exports', () => {
    expect(requiredScopeForRequest('/api/insights', 'GET')).toBe('insights:read');
    expect(requiredScopeForRequest('/api/insights/i1/run', 'POST')).toBe('insights:write');
    expect(requiredScopeForRequest('/api/dashboards/d1', 'GET')).toBe('insights:read');
    expect(requiredScopeForRequest('/api/exports/actions.csv', 'GET')).toBe('exports:read');
  });

  it('separates workflow and Triage reads from owner-only mutations', () => {
    expect(requiredScopeForRequest('/api/workflows', 'GET')).toBe('workflows:read');
    expect(requiredScopeForRequest('/api/workflows/w1/statuses', 'POST')).toBe('workflows:write');
    expect(requiredScopeForRequest('/api/triage', 'GET')).toBe('workflows:read');
    expect(requiredScopeForRequest('/api/triage/a1/accept', 'POST')).toBe('workflows:write');
  });

  it('separates notification and integration reads from mutations', () => {
    expect(requiredScopeForRequest('/api/notifications', 'GET')).toBe('notifications:read');
    expect(requiredScopeForRequest('/api/notifications/n1/read', 'POST')).toBe('notifications:write');
    expect(requiredScopeForRequest('/api/integrations', 'GET')).toBe('integrations:read');
    expect(requiredScopeForRequest('/api/integrations/deliveries/process', 'POST')).toBe('integrations:write');
  });
});
