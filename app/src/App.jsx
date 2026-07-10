import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useBusinessContext } from './hooks/useBusinesses.js'
import Layout from './components/Layout.jsx'
import ActionTable from './components/ActionTable.jsx'
import KanbanBoard from './components/KanbanBoard.jsx'
import CalendarView from './components/CalendarView.jsx'
import MemberList from './components/MemberList.jsx'
import TranscriptUpload from './components/TranscriptUpload.jsx'
import TranscriptHistory from './components/TranscriptHistory.jsx'
import TodayList from './components/TodayList.jsx'
import TodayReview from './components/TodayReview.jsx'
import JournalPage from './components/JournalPage.jsx'
import DecidePage from './components/DecidePage.jsx'
import AutomationRegistry from './components/AutomationRegistry.jsx'
import ActionDetail from './components/ActionDetail.jsx'
import QuickCapture from './components/QuickCapture.jsx'
import ViewErrorBoundary from './components/ViewErrorBoundary.jsx'
import { useKeyboard } from './hooks/useKeyboard.js'

const VIEW_PATHS = {
  today: '/today',
  dashboard: '/tasks',
  kanban: '/tasks?view=kanban',
  review: '/review',
  decide: '/decide',
  journal: '/journal',
  calendar: '/calendar',
  members: '/settings/principals',
  transcripts: '/transcripts',
  automations: '/automations',
}

function routeFromLocation() {
  const path = window.location.pathname.replace(/\/$/, '') || '/today'
  const actionMatch = path.match(/^\/actions\/([^/]+)$/)
  if (actionMatch) {
    return { view: 'dashboard', actionId: decodeURIComponent(actionMatch[1]) }
  }
  if (path === '/tasks') {
    return { view: new URLSearchParams(window.location.search).get('view') === 'kanban' ? 'kanban' : 'dashboard', actionId: null }
  }
  const match = Object.entries(VIEW_PATHS).find(([, routePath]) => routePath.split('?')[0] === path)
  return { view: match?.[0] || 'today', actionId: null }
}

export default function App() {
  const initialRoute = useMemo(routeFromLocation, [])
  const [currentView, setCurrentView] = useState(initialRoute.view)
  const [selectedBusiness, setSelectedBusiness] = useState(null)
  const [selectedActionId, setSelectedActionId] = useState(initialRoute.actionId)
  const [showQuickCapture, setShowQuickCapture] = useState(false)
  const [quickCaptureDate, setQuickCaptureDate] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [hideDone, setHideDone] = useState(() => {
    const stored = localStorage.getItem('atlas_hideDone')
    return stored === null ? true : stored === 'true'
  })

  const toggleHideDone = useCallback((value) => {
    setHideDone(value)
    localStorage.setItem('atlas_hideDone', String(value))
  }, [])

  const { frozenSet: frozenBusinesses, toggleFreezeInDB: toggleFreezeBusiness } = useBusinessContext()
  const [showFrozen, setShowFrozen] = useState(false)

  const navigateView = useCallback((view, { replace = false } = {}) => {
    const path = VIEW_PATHS[view] || VIEW_PATHS.today
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: view }, '', path)
    setCurrentView(view)
    setSelectedActionId(null)
    setSearchQuery('')
  }, [])

  const openAction = useCallback((actionId) => {
    const backgroundPath = VIEW_PATHS[currentView] || VIEW_PATHS.dashboard
    window.history.pushState({ atlasAction: true, backgroundPath }, '', `/actions/${encodeURIComponent(actionId)}`)
    setSelectedActionId(actionId)
  }, [currentView])

  const closeAction = useCallback(() => {
    const backgroundPath = window.history.state?.backgroundPath || VIEW_PATHS[currentView] || VIEW_PATHS.dashboard
    window.history.replaceState({ atlasView: currentView }, '', backgroundPath)
    setSelectedActionId(null)
  }, [currentView])

  useEffect(() => {
    function handlePopState() {
      const route = routeFromLocation()
      setCurrentView(route.view)
      setSelectedActionId(route.actionId)
      setSearchQuery('')
    }

    window.addEventListener('popstate', handlePopState)
    if (window.location.pathname === '/') navigateView('today', { replace: true })
    return () => window.removeEventListener('popstate', handlePopState)
  }, [navigateView])

  const shortcuts = useMemo(() => [
    {
      key: 'k',
      meta: true,
      action: () => {
        setQuickCaptureDate(null)
        setShowQuickCapture(true)
      },
    },
    {
      key: 'Escape',
      meta: false,
      preventDefault: false,
      action: () => {
        if (showQuickCapture) {
          setShowQuickCapture(false)
        } else if (sidebarOpen) {
          setSidebarOpen(false)
        } else if (selectedActionId) {
          closeAction()
        }
      },
    },
  ], [showQuickCapture, selectedActionId, sidebarOpen, closeAction])

  useKeyboard(shortcuts)

  function handleOpenQuickCapture(date = null) {
    setQuickCaptureDate(date)
    setShowQuickCapture(true)
  }

  function renderView() {
    switch (currentView) {
      case 'today':
        return (
          <TodayList
            selectedBusiness={selectedBusiness}
            onSelectAction={openAction}
            searchQuery={searchQuery}
          />
        )
      case 'review':
        return (
          <TodayReview
            selectedBusiness={selectedBusiness}
            onSelectAction={openAction}
            searchQuery={searchQuery}
          />
        )
      case 'decide':
        return <DecidePage />
      case 'journal':
        return <JournalPage searchQuery={searchQuery} />
      case 'dashboard':
        return (
          <ActionTable
            selectedBusiness={selectedBusiness}
            onSelectAction={openAction}
            searchQuery={searchQuery}
            hideDone={hideDone}
            onToggleHideDone={toggleHideDone}
            frozenBusinesses={frozenBusinesses}
            showFrozen={showFrozen}
          />
        )
      case 'automations':
        return <AutomationRegistry />
      case 'kanban':
        return (
          <KanbanBoard
            selectedBusiness={selectedBusiness}
            onSelectAction={openAction}
            hideDone={hideDone}
            onToggleHideDone={toggleHideDone}
          />
        )
      case 'calendar':
        return (
          <CalendarView
            selectedBusiness={selectedBusiness}
            onSelectAction={openAction}
            onOpenQuickCapture={handleOpenQuickCapture}
          />
        )
      case 'members':
        return <MemberList onSelectAction={openAction} />
      case 'transcripts':
        return (
          <div className="flex flex-col gap-6">
            <TranscriptUpload />
            <TranscriptHistory />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="h-screen flex overflow-hidden bg-bg-primary">
      <Layout
        currentView={currentView}
        setCurrentView={navigateView}
        selectedBusiness={selectedBusiness}
        setSelectedBusiness={setSelectedBusiness}
        onOpenQuickCapture={() => handleOpenQuickCapture(null)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        frozenBusinesses={frozenBusinesses}
        toggleFreezeBusiness={toggleFreezeBusiness}
        showFrozen={showFrozen}
        setShowFrozen={setShowFrozen}
      >
        <ViewErrorBoundary key={currentView}>
          <div className="view-transition">
            {renderView()}
          </div>
        </ViewErrorBoundary>
      </Layout>

      {selectedActionId && (
        <ActionDetail
          actionId={selectedActionId}
          onClose={closeAction}
        />
      )}

      {showQuickCapture && (
        <QuickCapture
          onClose={() => setShowQuickCapture(false)}
          selectedBusiness={selectedBusiness}
          prefilledDate={quickCaptureDate}
        />
      )}
    </div>
  )
}
