import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { actionsApi } from '../api/client.js';

export function useActions(filters = {}) {
  return useQuery({
    queryKey: ['actions', filters],
    queryFn: () => actionsApi.list(filters),
    staleTime: 30000,
  });
}

export function useAction(id) {
  return useQuery({
    queryKey: ['action', id],
    queryFn: () => actionsApi.get(id),
    enabled: !!id,
  });
}

export function useActionStats(params = {}) {
  return useQuery({
    queryKey: ['actionStats', params],
    queryFn: () => actionsApi.stats(params),
    staleTime: 15000,
  });
}

export function useActionsByOwner(ownerId) {
  return useQuery({
    queryKey: ['actionsByOwner', ownerId],
    queryFn: () => actionsApi.byOwner(ownerId),
    enabled: !!ownerId,
  });
}

export function useCreateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => actionsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['actionStats'] });
      queryClient.invalidateQueries({ queryKey: ['actionsByOwner'] });
      queryClient.invalidateQueries({ queryKey: ['memberStats'] });
    },
  });
}

export function useUpdateAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => actionsApi.update(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['action', data.id] });
      queryClient.invalidateQueries({ queryKey: ['actionStats'] });
      queryClient.invalidateQueries({ queryKey: ['actionsByOwner'] });
      queryClient.invalidateQueries({ queryKey: ['memberStats'] });
    },
  });
}

export function useDeleteAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => actionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['actionStats'] });
      queryClient.invalidateQueries({ queryKey: ['actionsByOwner'] });
      queryClient.invalidateQueries({ queryKey: ['memberStats'] });
    },
  });
}

export function useBulkUpdateActions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates) => actionsApi.bulkUpdate(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['actionStats'] });
      queryClient.invalidateQueries({ queryKey: ['actionsByOwner'] });
      queryClient.invalidateQueries({ queryKey: ['memberStats'] });
    },
  });
}
