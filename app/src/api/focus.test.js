import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusApi } from './client.js';

afterEach(() => vi.unstubAllGlobals());
describe('Focus API transport', () => {
  it.each([
    [{ code: 'REVISION_CONFLICT', message: 'Changed elsewhere' }, 409, 'REVISION_CONFLICT'],
    [{ error: { code: 'FOCUS_STORAGE_UNAVAILABLE', message: 'Storage unavailable' } }, 503, 'FOCUS_STORAGE_UNAVAILABLE'],
  ])('preserves HTTP status and machine-readable error codes', async (body, status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, text: async () => JSON.stringify(body) }));
    await expect(focusApi.get()).rejects.toMatchObject({ status, code });
  });
  it('encodes stable history cursors and project IDs without changing them', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"items":[]}' });
    vi.stubGlobal('fetch', fetch);
    await focusApi.history({ project_id: 'project/actual-id', cursor: 'timestamp+session/id=', limit: 20 });
    const url = new URL(fetch.mock.calls[0][0], 'https://atlas.test');
    expect(url.pathname).toBe('/api/focus/history');
    expect(url.searchParams.get('project_id')).toBe('project/actual-id');
    expect(url.searchParams.get('cursor')).toBe('timestamp+session/id=');
  });
});
