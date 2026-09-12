import { useQuery } from '@tanstack/react-query'
import { updatesApi } from '../api/client.js'

export function useOfficeDigest() {
  return useQuery({
    queryKey: ['officeDigest'],
    queryFn: () => updatesApi.officeDigest(),
    staleTime: 15000,
  })
}
