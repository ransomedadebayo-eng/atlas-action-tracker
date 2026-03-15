import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { BusinessesProvider } from './hooks/useBusinesses.js'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BusinessesProvider>
        <App />
      </BusinessesProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
