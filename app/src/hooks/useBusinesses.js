import React, { createContext, useContext, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { configApi } from '../api/client.js'

const BusinessesContext = createContext({
  BUSINESSES: {},
  BUSINESS_LIST: [],
  BUSINESS_COLORS: {},
  frozenSet: new Set(),
  toggleFreezeInDB: () => {},
  loading: true,
})

function shortLabel(name) {
  const words = name.split(/\s+/)
  if (words.length === 1) return name.slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').toUpperCase()
}

export function BusinessesProvider({ children }) {
  const queryClient = useQueryClient()
  const { data: raw = [], isLoading } = useQuery({
    queryKey: ['businesses'],
    queryFn: configApi.businesses,
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: configApi.updateBusinesses,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  })

  const toggleFreezeInDB = useCallback((id) => {
    const updated = raw.map(b => b.id === id ? { ...b, frozen: !b.frozen } : b)
    mutation.mutate(updated)
  }, [raw, mutation])

  const BUSINESSES = {}
  const BUSINESS_LIST = []
  const BUSINESS_COLORS = {}
  const frozenSet = new Set()

  for (const b of raw) {
    BUSINESSES[b.id] = { label: b.name, shortLabel: shortLabel(b.name) }
    BUSINESS_LIST.push({ id: b.id, label: b.name, shortLabel: shortLabel(b.name) })
    BUSINESS_COLORS[b.id] = b.color
    if (b.frozen) frozenSet.add(b.id)
  }

  return React.createElement(
    BusinessesContext.Provider,
    { value: { BUSINESSES, BUSINESS_LIST, BUSINESS_COLORS, frozenSet, toggleFreezeInDB, loading: isLoading } },
    children
  )
}

export function useBusinessContext() {
  return useContext(BusinessesContext)
}
