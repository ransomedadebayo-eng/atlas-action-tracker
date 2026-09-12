import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commentsApi } from '../api/client.js';

export function useDiscussion(targetType, targetId) { return useQuery({ queryKey: ['discussion', targetType, targetId], queryFn: () => commentsApi.get(targetType, targetId), enabled: Boolean(targetType && targetId), staleTime: 10000 }); }
function mutation(apiCall, targetFromVariables = variables => [variables.target_type, variables.target_id]) { return function useCommentMutation() { const client = useQueryClient(); return useMutation({ mutationFn: apiCall, onSuccess: (_data, variables) => { const [type,id] = targetFromVariables(variables); client.invalidateQueries({ queryKey: ['discussion', type, id] }); } }); }; }
export const useCreateComment = mutation(commentsApi.create);
export const useUpdateComment = mutation(({ id, ...data }) => commentsApi.update(id, data));
export const useArchiveComment = mutation(({ id, ...data }) => commentsApi.archive(id, data));
export const useRestoreComment = mutation(({ id, ...data }) => commentsApi.restore(id, data));
export const useResolveComment = mutation(({ id, ...data }) => commentsApi.resolve(id, data));
export const useReopenComment = mutation(({ id, ...data }) => commentsApi.reopen(id, data));
export const useToggleReaction = mutation(commentsApi.toggleReaction);
export const useSetDiscussionSubscription = mutation(commentsApi.setSubscription);
