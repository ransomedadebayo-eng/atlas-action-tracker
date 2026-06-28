import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { automationsApi } from '../api/client.js'

export function useAutomationRegistry() {
  return useQuery({
    queryKey: ['automationRegistry'],
    queryFn: () => automationsApi.registry(),
    staleTime: 60000,
  })
}

export function useRunAutomation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (job) => automationsApi.run(job),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRegistry'] })
      queryClient.invalidateQueries({ queryKey: ['todayPlan'] })
      queryClient.invalidateQueries({ queryKey: ['decisionQueue'] })
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] })
    },
  })
}
