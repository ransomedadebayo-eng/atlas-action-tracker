import { describe, expect, it } from 'vitest';
import { requiredScopeForRequest } from './authorize';

describe('machine principal scope routing', () => {
  it('separates read, write, completion, and assignment scopes', () => {
    expect(requiredScopeForRequest('/api/actions', 'GET')).toBe('actions:read');
    expect(requiredScopeForRequest('/api/actions/123', 'PUT')).toBe('actions:write');
    expect(requiredScopeForRequest('/api/actions/123/complete', 'POST')).toBe('actions:complete');
    expect(requiredScopeForRequest('/api/actions/123/agent-assignment', 'POST')).toBe('actions:assign');
  });

  it('keeps the automation API read-only', () => {
    expect(requiredScopeForRequest('/api/automations/registry', 'GET')).toBe('automations:read');
    expect(requiredScopeForRequest('/api/automations/job/run', 'POST')).toBeNull();
  });
});
