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
    expect(requiredScopeForRequest('/api/updates/office-digest', 'GET')).toBe('actions:read');
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

  it('separates document reads from writes', () => {
    expect(requiredScopeForRequest('/api/documents/d1', 'GET')).toBe('documents:read');
    expect(requiredScopeForRequest('/api/documents/d1', 'PUT')).toBe('documents:write');
  });

  it('separates discussion reads from collaboration writes', () => {
    expect(requiredScopeForRequest('/api/comments', 'GET')).toBe('comments:read');
    expect(requiredScopeForRequest('/api/comments', 'POST')).toBe('comments:write');
    expect(requiredScopeForRequest('/api/comments/c1/resolve', 'POST')).toBe('comments:write');
  });

  it('separates notification and integration reads from mutations', () => {
    expect(requiredScopeForRequest('/api/notifications', 'GET')).toBe('notifications:read');
    expect(requiredScopeForRequest('/api/notifications/n1/read', 'POST')).toBe('notifications:write');
    expect(requiredScopeForRequest('/api/integrations', 'GET')).toBe('integrations:read');
    expect(requiredScopeForRequest('/api/integrations/deliveries/process', 'POST')).toBe('integrations:write');
  });
});
