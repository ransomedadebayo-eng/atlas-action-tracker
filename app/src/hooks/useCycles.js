import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cyclesApi } from '../api/client.js';

export function useCycles(params = {}) {
  return useQuery({
    queryKey: ['cycles', params],
    queryFn: () => cyclesApi.list(params),
    staleTime: 30000,
  });
}

export function useCycle(id) {
  return useQuery({
    queryKey: ['cycle', id],
    queryFn: () => cyclesApi.get(id),
    enabled: Boolean(id),
    staleTime: 15000,
  });
}

function invalidateCycles(queryClient, id) {
  queryClient.invalidateQueries({ queryKey: ['cycles'] });
  if (id) queryClient.invalidateQueries({ queryKey: ['cycle', id] });
  queryClient.invalidateQueries({ queryKey: ['actions'] });
  queryClient.invalidateQueries({ queryKey: ['action'] });
  queryClient.invalidateQueries({ queryKey: ['actionStructure'] });
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  queryClient.invalidateQueries({ queryKey: ['project'] });
}

export function useConfigureCycles() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: cyclesApi.configure, onSuccess: () => invalidateCycles(queryClient) });
}

export function useAssignCycleAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, actionId }) => cyclesApi.assignAction(id, actionId),
    onSuccess: (_data, variables) => invalidateCycles(queryClient, variables.id),
  });
}

export function useRemoveCycleAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, actionId }) => cyclesApi.removeAction(id, actionId),
    onSuccess: (_data, variables) => invalidateCycles(queryClient, variables.id),
  });
}

export function useCompleteCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => cyclesApi.complete(id, data),
    onSuccess: (_data, variables) => invalidateCycles(queryClient, variables.id),
  });
}

export function useStartCycleToday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => cyclesApi.startToday(id, data),
    onSuccess: (_data, variables) => invalidateCycles(queryClient, variables.id),
  });
}

export function useDisableCycles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => cyclesApi.disable(id, data),
    onSuccess: () => invalidateCycles(queryClient),
  });
}
