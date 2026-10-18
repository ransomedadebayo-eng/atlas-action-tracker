// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeFromLocation } from './App.jsx';

describe('legacy surface links', () => {
  afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/today'); });
  it.each([
    ['/cycles', '/week', 'week'], ['/cycles/cycle-1', '/week', 'week'],
    ['/initiatives/initiative-ventures-2026', '/projects?group=business', 'projects'],
    ['/insights', '/projects', 'projects'], ['/insights/insight-1?run=true', '/projects', 'projects'],
    ['/dashboards/dashboard-1', '/projects', 'projects'],
    ['/templates', '/today', 'today'], ['/releases/pipeline-1', '/today', 'today'],
    ['/workflows', '/today', 'today'],
  ])('replaces %s with %s', (oldUrl, nextUrl, view) => {
    window.history.replaceState(null, '', oldUrl);
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');
    expect(routeFromLocation()).toMatchObject({ view, actionId: null });
    expect(`${window.location.pathname}${window.location.search}`).toBe(nextUrl);
    expect(replace).toHaveBeenCalledExactlyOnceWith(null, '', nextUrl);
    expect(push).not.toHaveBeenCalled();
  });
  it('preserves action, task saved-view and Office Digest deep links', () => {
    window.history.replaceState(null, '', '/actions/ATLAS-101');
    expect(routeFromLocation()).toMatchObject({ view: 'dashboard', actionId: 'ATLAS-101' });
    window.history.replaceState(null, '', '/tasks?saved_view=office-digest-done');
    expect(routeFromLocation()).toMatchObject({ view: 'dashboard', savedViewId: 'office-digest-done' });
    window.history.replaceState(null, '', '/updates/office-digest');
    expect(routeFromLocation()).toMatchObject({ view: 'officeDigest' });
  });
});
