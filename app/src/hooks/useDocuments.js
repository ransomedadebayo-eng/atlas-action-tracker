import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsApi } from '../api/client.js';

function items(data) { return Array.isArray(data) ? data : (data?.items || []); }
export function useDocuments(filters = {}) { return useQuery({ queryKey: ['documents', filters], queryFn: () => documentsApi.list(filters), select: items, staleTime: 30000 }); }
export function useDocument(id) { return useQuery({ queryKey: ['document', id], queryFn: () => documentsApi.get(id), enabled: Boolean(id), staleTime: 15000 }); }
function invalidate(client, id) { client.invalidateQueries({ queryKey: ['documents'] }); if (id) client.invalidateQueries({ queryKey: ['document', id] }); }
export function useCreateDocument() { const client = useQueryClient(); return useMutation({ mutationFn: documentsApi.create, onSuccess: () => invalidate(client) }); }
function mutation(apiCall) { return function useDocumentMutation() { const client = useQueryClient(); return useMutation({ mutationFn: apiCall, onSuccess: (_data, variables) => invalidate(client, variables.id) }); }; }
export const useUpdateDocument = mutation(({ id, ...data }) => documentsApi.update(id, data));
export const useArchiveDocument = mutation(({ id, ...data }) => documentsApi.archive(id, data));
export const useRestoreDocument = mutation(({ id, ...data }) => documentsApi.restore(id, data));
export const useRevertDocument = mutation(({ id, ...data }) => documentsApi.revert(id, data));
