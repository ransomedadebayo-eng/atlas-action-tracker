import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../api/client.js';

function projectItems(data) {
  return Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
}

export function useProjects(filters = {}) {
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: () => projectsApi.list(filters),
    select: projectItems,
    staleTime: 30000,
  });
}

export function useProject(id) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id),
    enabled: Boolean(id),
    staleTime: 15000,
  });
}

function invalidateProjects(queryClient, id) {
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  if (id) queryClient.invalidateQueries({ queryKey: ['project', id] });
  queryClient.invalidateQueries({ queryKey: ['actions'] });
  queryClient.invalidateQueries({ queryKey: ['actionStats'] });
}

function projectMutation(apiCall, idFromVariables = variables => variables.id) {
  return function useProjectMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: apiCall,
      onSuccess: (_data, variables) => invalidateProjects(queryClient, idFromVariables(variables)),
    });
  };
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.create,
    onSuccess: () => invalidateProjects(queryClient),
  });
}

export const useUpdateProject = projectMutation(({ id, ...data }) => projectsApi.update(id, data));
export const useArchiveProject = projectMutation(({ id, ...data }) => projectsApi.archive(id, data));
export const useRestoreProject = projectMutation(({ id, ...data }) => projectsApi.restore(id, data));
export const useCreateProjectMilestone = projectMutation(({ id, ...data }) => projectsApi.createMilestone(id, data));
export const useUpdateProjectMilestone = projectMutation(({ id, milestoneId, ...data }) => projectsApi.updateMilestone(id, milestoneId, data));
export const useArchiveProjectMilestone = projectMutation(({ id, milestoneId, ...data }) => projectsApi.archiveMilestone(id, milestoneId, data));
export const usePostProjectUpdate = projectMutation(({ id, ...data }) => projectsApi.postUpdate(id, data));
export const useCreateProjectDependency = projectMutation(({ id, ...data }) => projectsApi.createDependency(id, data));
export const useResolveProjectDependency = projectMutation(({ id, dependencyId }) => projectsApi.resolveDependency(id, dependencyId));
export const useArchiveProjectDependency = projectMutation(({ id, dependencyId }) => projectsApi.archiveDependency(id, dependencyId));
export const useAssignProjectAction = projectMutation(({ id, actionId, ...data }) => projectsApi.assignAction(id, actionId, data));
export const useRemoveProjectAction = projectMutation(({ id, actionId }) => projectsApi.removeAction(id, actionId));
export const useReorderProject = projectMutation(({ id, ...data }) => projectsApi.reorder(id, data));
export const useMoveProjectTimeline = projectMutation(({ id, ...data }) => projectsApi.moveTimeline(id, data));
