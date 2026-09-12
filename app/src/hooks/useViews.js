import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { viewsApi } from '../api/client.js';

export function useViews(params = {}) {
  return useQuery({
    queryKey: ['views', params],
    queryFn: () => viewsApi.list(params),
    staleTime: 60000,
  });
}

export function useCreateView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => viewsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] });
    },
  });
}

export function useUpdateView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => viewsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] });
    },
  });
}

export function useArchiveView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => viewsApi.archive(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] });
    },
  });
}

export function useRestoreView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => viewsApi.restore(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['views'] }),
  });
}
