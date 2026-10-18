// @vitest-environment jsdom
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useViews } from './useViews.js';
import { viewsApi } from '../api/client.js';
vi.mock('../api/client.js', () => ({ viewsApi: { list: vi.fn() } }));

describe('supported saved views', () => {
  it('hides historical initiative views while keeping action and project views', async () => {
    const views = [
      { id: 'actions', entity_type: 'action' }, { id: 'projects', entity_type: 'project' },
      { id: 'old-initiative', entity_type: 'initiative' },
    ];
    viewsApi.list.mockResolvedValue(views);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useViews(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(views.slice(0, 2));
    expect(viewsApi.list).toHaveBeenCalledExactlyOnceWith({});
    client.clear();
  });
});
