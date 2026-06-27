import { useQuery } from '@tanstack/react-query';
import { todayApi } from '../api/client.js';

export function useTodayPlan(date) {
  return useQuery({
    queryKey: ['todayPlan', date || 'current'],
    queryFn: () => todayApi.get(date),
    staleTime: 30000,
  });
}
