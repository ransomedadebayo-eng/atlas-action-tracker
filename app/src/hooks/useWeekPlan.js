import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { weeksApi } from '../api/client.js';

export function useWeekPlan(weekStart, revisionId = null) {
  return useQuery({
    queryKey: ['weekPlan', weekStart, revisionId],
    queryFn: () => weeksApi.get(weekStart, revisionId),
    enabled: Boolean(weekStart),
    staleTime: 30000,
  });
}

function invalidateWeek(queryClient, weekStart) {
  queryClient.invalidateQueries({ queryKey: ['weekPlan', weekStart] });
  queryClient.invalidateQueries({ queryKey: ['weekReview'] });
}

export function useSaveWeekPlan(weekStart) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => weeksApi.save(id, data),
    onSuccess: () => invalidateWeek(queryClient, weekStart),
  });
}

export function useRequestWeekReview(weekStart) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => weeksApi.requestReview(id, data),
    onSuccess: () => invalidateWeek(queryClient, weekStart),
  });
}

export function usePublishWeekPlan(weekStart) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => weeksApi.publish(id, data),
    onSuccess: () => invalidateWeek(queryClient, weekStart),
  });
}

export function useForkWeekPlan(weekStart) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => weeksApi.fork(id, data),
    onSuccess: () => invalidateWeek(queryClient, weekStart),
  });
}
