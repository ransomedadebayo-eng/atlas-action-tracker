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

export function useActionStructure(id) {
  return useQuery({
    queryKey: ['actionStructure', id],
    queryFn: () => actionsApi.structure(id),
    enabled: !!id,
    staleTime: 15000,
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
      invalidateActionQueries(queryClient, data.id);
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
  queryClient.invalidateQueries({ queryKey: ['actionStructure'] });
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  queryClient.invalidateQueries({ queryKey: ['project'] });
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
      queryClient.invalidateQueries({ queryKey: ['actionStructure'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
    },
  });
}

function structureMutation(apiCall) {
  return function useStructureMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: apiCall,
      onSuccess: (_data, variables) => invalidateActionQueries(queryClient, variables.id),
    });
  };
}

export const useCreateSubAction = structureMutation(({ id, ...data }) => actionsApi.createSubAction(id, data));
export const useSetActionParent = structureMutation(({ id, ...data }) => actionsApi.setParent(id, data));
export const useCreateActionRelation = structureMutation(({ id, ...data }) => actionsApi.createRelation(id, data));
export const useTransitionActionRelation = structureMutation(({ id, relationId, transition }) => actionsApi.transitionRelation(id, relationId, transition));
export const useMarkActionDuplicate = structureMutation(({ id, ...data }) => actionsApi.markDuplicate(id, data));
export const useRestoreDuplicateAction = structureMutation(({ id, ...data }) => actionsApi.restoreDuplicate(id, data));
export const useConvertActionToProject = structureMutation(({ id, ...data }) => actionsApi.convertToProject(id, data));
