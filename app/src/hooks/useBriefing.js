import { useQuery } from '@tanstack/react-query'
import { actionsApi } from '../api/client.js'

async function fetchBriefing() {
  const BASE_URL = '/api'
  const token = import.meta.env.VITE_ATLAS_API_TOKEN
  const res = await fetch(`${BASE_URL}/briefing/today`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })
  if (!res.ok) return { briefing: null }
  return res.json()
}

export function useBriefing() {
  const { data } = useQuery({
    queryKey: ['briefing-today'],
    queryFn: fetchBriefing,
    staleTime: 5 * 60 * 1000, // 5 min
    retry: false,
  })
  return data?.briefing ?? null
}
