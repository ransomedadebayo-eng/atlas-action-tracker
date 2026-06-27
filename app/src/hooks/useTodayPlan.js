import { useQuery } from '@tanstack/react-query'
import { todayApi } from '../api/client.js'

export function useTodayPlan(date) {
  return useQuery({
    queryKey: ['atlas-today-plan', date ?? 'today'],
    queryFn: () => todayApi.get(date),
    staleTime: 60 * 1000,
    retry: 1,
  })
}
