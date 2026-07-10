import { useQuery } from '@tanstack/react-query'
import { automationsApi } from '../api/client.js'

export function useAutomationRegistry() {
  return useQuery({
    queryKey: ['automationRegistry'],
    queryFn: () => automationsApi.registry(),
    staleTime: 60000,
  })
}
