import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { viewsApi } from '../api/client.js';

export function useViews() {
  return useQuery({
    queryKey: ['views'],
    queryFn: () => viewsApi.list(),
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

export function useDeleteView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => viewsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] });
    },
  });
}
