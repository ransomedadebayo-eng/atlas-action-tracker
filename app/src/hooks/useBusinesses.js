import React, { createContext, useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { configApi } from '../api/client.js'

const BusinessesContext = createContext({
  BUSINESSES: {},
  BUSINESS_LIST: [],
  BUSINESS_COLORS: {},
  loading: true,
})

function shortLabel(name) {
  const words = name.split(/\s+/)
  if (words.length === 1) return name.slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').toUpperCase()
}

export function BusinessesProvider({ children }) {
  const { data: raw = [], isLoading } = useQuery({
    queryKey: ['businesses'],
    queryFn: configApi.businesses,
    staleTime: 60_000,
  })

  const BUSINESSES = {}
  const BUSINESS_LIST = []
  const BUSINESS_COLORS = {}

  for (const b of raw) {
    BUSINESSES[b.id] = { label: b.name, shortLabel: shortLabel(b.name) }
    BUSINESS_LIST.push({ id: b.id, label: b.name, shortLabel: shortLabel(b.name) })
    BUSINESS_COLORS[b.id] = b.color
  }

  return React.createElement(
    BusinessesContext.Provider,
    { value: { BUSINESSES, BUSINESS_LIST, BUSINESS_COLORS, loading: isLoading } },
    children
  )
}

export function useBusinessContext() {
  return useContext(BusinessesContext)
}
