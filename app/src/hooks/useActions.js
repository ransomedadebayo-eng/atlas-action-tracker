import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { actionsApi } from '../api/client.js';

function actionItems(data) {
  return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
}

export function useActions(filters = {}) {
  return useQuery({
    queryKey: ['actions', filters],
    queryFn: () => actionsApi.list(filters),
    select: actionItems,
    staleTime: 30000,
    placeholderData: keepPreviousData,
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
    select: actionItems,
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
      queryClient.invalidateQueries({ queryKey: ['todayPlan'] });
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
      queryClient.invalidateQueries({ queryKey: ['todayPlan'] });
    },
  });
}

export function useCreateAgentAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => actionsApi.createAgentAssignment(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      queryClient.invalidateQueries({ queryKey: ['action', id] });
      queryClient.invalidateQueries({ queryKey: ['actionStats'] });
    },
  });
}

function invalidateActionQueries(queryClient, id) {
  queryClient.invalidateQueries({ queryKey: ['actions'] });
  if (id) queryClient.invalidateQueries({ queryKey: ['action', id] });
  queryClient.invalidateQueries({ queryKey: ['actionStats'] });
  queryClient.invalidateQueries({ queryKey: ['actionsByOwner'] });
  queryClient.invalidateQueries({ queryKey: ['memberStats'] });
  queryClient.invalidateQueries({ queryKey: ['todayPlan'] });
}

export function useCompleteAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => actionsApi.complete(id, data),
    onSuccess: (_data, variables) => invalidateActionQueries(queryClient, variables.id),
  });
}

export function useArchiveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => actionsApi.archive(id, data),
    onSuccess: (_data, variables) => invalidateActionQueries(queryClient, variables.id),
  });
}

export function useRestoreAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => actionsApi.restore(id, data),
    onSuccess: (_data, variables) => invalidateActionQueries(queryClient, variables.id),
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
      queryClient.invalidateQueries({ queryKey: ['todayPlan'] });
    },
  });
}
