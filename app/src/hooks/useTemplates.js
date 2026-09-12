import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { templatesApi } from '../api/client.js';

export function useTemplates(filters = {}) { return useQuery({ queryKey: ['templates', filters], queryFn: () => templatesApi.list(filters), staleTime: 30000 }); }
export function useTemplate(id) { return useQuery({ queryKey: ['template', id], queryFn: () => templatesApi.get(id), enabled: Boolean(id), staleTime: 15000 }); }
export function useDefaultTemplate(type, business, audience = 'owner') { return useQuery({ queryKey: ['templateDefault', type, business, audience], queryFn: () => templatesApi.getDefault({ template_type: type, business, audience }), staleTime: 30000 }); }
function invalidate(queryClient, id) { queryClient.invalidateQueries({ queryKey: ['templates'] }); queryClient.invalidateQueries({ queryKey: ['template', id] }); queryClient.invalidateQueries({ queryKey: ['templateDefault'] }); queryClient.invalidateQueries({ queryKey: ['actions'] }); queryClient.invalidateQueries({ queryKey: ['projects'] }); queryClient.invalidateQueries({ queryKey: ['documents'] }); }
function mutation(apiCall) { return function useTemplateMutation() { const client = useQueryClient(); return useMutation({ mutationFn: apiCall, onSuccess: (_data, variables) => invalidate(client, variables.id) }); }; }
export function useCreateTemplate() { const client = useQueryClient(); return useMutation({ mutationFn: templatesApi.create, onSuccess: () => invalidate(client) }); }
export const useUpdateTemplate = mutation(({ id, ...data }) => templatesApi.update(id, data));
export const useInstantiateTemplate = mutation(({ id, ...data }) => templatesApi.instantiate(id, data));
export const useArchiveTemplate = mutation(({ id, ...data }) => templatesApi.archive(id, data));
export const useRestoreTemplate = mutation(({ id, ...data }) => templatesApi.restore(id, data));
export const useDuplicateTemplate = mutation(({ id, ...data }) => templatesApi.duplicate(id, data));
