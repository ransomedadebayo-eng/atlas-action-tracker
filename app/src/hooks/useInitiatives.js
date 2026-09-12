import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { initiativesApi } from '../api/client.js';

function initiativeItems(data) {
  return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
}

export function useInitiatives(filters = {}) {
  return useQuery({ queryKey: ['initiatives', filters], queryFn: () => initiativesApi.list(filters), select: initiativeItems, staleTime: 30000 });
}

export function useInitiative(id) {
  return useQuery({ queryKey: ['initiative', id], queryFn: () => initiativesApi.get(id), enabled: Boolean(id), staleTime: 15000 });
}

export function useInitiativeGraph(id, weeks = 26) {
  return useQuery({ queryKey: ['initiativeGraph', id, weeks], queryFn: () => initiativesApi.graph(id, weeks), enabled: Boolean(id), staleTime: 30000 });
}

function invalidate(queryClient, id) {
  queryClient.invalidateQueries({ queryKey: ['initiatives'] });
  queryClient.invalidateQueries({ queryKey: ['initiative', id] });
  queryClient.invalidateQueries({ queryKey: ['initiativeGraph', id] });
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  queryClient.invalidateQueries({ queryKey: ['project'] });
}

function mutation(apiCall, idFromVariables = variables => variables.id) {
  return function useInitiativeMutation() {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: apiCall, onSuccess: (_data, variables) => invalidate(queryClient, idFromVariables(variables)) });
  };
}

export function useCreateInitiative() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: initiativesApi.create, onSuccess: () => invalidate(queryClient) });
}

export const useUpdateInitiative = mutation(({ id, ...data }) => initiativesApi.update(id, data));
export const useArchiveInitiative = mutation(({ id, ...data }) => initiativesApi.archive(id, data));
export const useRestoreInitiative = mutation(({ id, ...data }) => initiativesApi.restore(id, data));
export const useReorderInitiative = mutation(({ id, ...data }) => initiativesApi.reorder(id, data));
export const useAttachInitiativeProject = mutation(({ id, projectId }) => initiativesApi.attachProject(id, projectId));
export const useDetachInitiativeProject = mutation(({ id, projectId }) => initiativesApi.detachProject(id, projectId));
export const useAttachInitiativeParent = mutation(({ id, parentId }) => initiativesApi.attachParent(id, parentId));
export const useDetachInitiativeParent = mutation(({ id, parentId }) => initiativesApi.detachParent(id, parentId));
export const usePostInitiativeUpdate = mutation(({ id, ...data }) => initiativesApi.postUpdate(id, data));
export const useCreateInitiativeResource = mutation(({ id, ...data }) => initiativesApi.createResource(id, data));
export const useUpdateInitiativeResource = mutation(({ id, resourceId, ...data }) => initiativesApi.updateResource(id, resourceId, data));
export const useArchiveInitiativeResource = mutation(({ id, resourceId, ...data }) => initiativesApi.archiveResource(id, resourceId, data));
