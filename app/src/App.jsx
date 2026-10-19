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
import OfficeDigestPage from './components/OfficeDigestPage.jsx'
import ActionDetail from './components/ActionDetail.jsx'
import QuickCapture from './components/QuickCapture.jsx'
import WeekPage from './components/WeekPage.jsx'
import ViewErrorBoundary from './components/ViewErrorBoundary.jsx'
import { useKeyboard } from './hooks/useKeyboard.js'
import { getPacificWeekStart } from './utils/dateUtils.js'

const ProjectsPage = React.lazy(() => import('./components/ProjectsPage.jsx'))
const DocumentsPage = React.lazy(() => import('./components/DocumentsPage.jsx'))
const NotificationsPage = React.lazy(() => import('./components/NotificationsPage.jsx'))
const FocusPage = React.lazy(() => import('./components/FocusPage.jsx'))

const VIEW_PATHS = {
  today: '/today',
  week: '/week',
  focus: '/focus',
  projects: '/projects',
  documents: '/documents',
  notifications: '/notifications',
  dashboard: '/tasks',
  kanban: '/tasks?view=kanban',
  review: '/review',
  decide: '/decide',
  journal: '/journal',
  calendar: '/calendar',
  members: '/settings/principals',
  transcripts: '/transcripts',
  automations: '/automations',
  officeDigest: '/updates/office-digest',
}

export function routeFromLocation() {
  let path = window.location.pathname.replace(/\/$/, '') || '/today'
  const retiredPath = [
    [/^\/cycles(?:\/|$)/, '/week'],
    [/^\/initiatives(?:\/|$)/, '/projects?group=business'],
    [/^\/(?:insights|dashboards)(?:\/|$)/, '/projects'],
    [/^\/(?:templates|releases|workflows)(?:\/|$)/, '/today'],
  ].find(([pattern]) => pattern.test(path))
  if (retiredPath) {
    window.history.replaceState(null, '', retiredPath[1])
    path = window.location.pathname
  }
  const weekMatch = path.match(/^\/week(?:\/([^/]+))?$/)
  if (weekMatch) {
    return { view: 'week', actionId: null, weekStart: weekMatch[1] || getPacificWeekStart() }
  }
  const projectMatch = path.match(/^\/projects(?:\/([^/]+))?$/)
  if (projectMatch) {
    return { view: 'projects', actionId: null, projectId: projectMatch[1] ? decodeURIComponent(projectMatch[1]) : null }
  }
  const documentMatch = path.match(/^\/documents(?:\/([^/]+))?$/)
  if (documentMatch) {
    return { view: 'documents', actionId: null, documentId: documentMatch[1] ? decodeURIComponent(documentMatch[1]) : null }
  }
  const actionMatch = path.match(/^\/actions\/([^/]+)$/)
  if (actionMatch) {
    return { view: 'dashboard', actionId: decodeURIComponent(actionMatch[1]) }
  }
  if (path === '/updates/office-digest') {
    return { view: 'officeDigest', actionId: null, savedViewId: null }
  }
  if (path === '/tasks') {
    const params = new URLSearchParams(window.location.search)
    return {
      view: params.get('view') === 'kanban' ? 'kanban' : 'dashboard',
      actionId: null,
      savedViewId: params.get('saved_view'),
    }
  }
  const match = Object.entries(VIEW_PATHS).find(([, routePath]) => routePath.split('?')[0] === path)
  return { view: match?.[0] || 'today', actionId: null, weekStart: null, projectId: null, documentId: null, savedViewId: null }
}

export default function App() {
  const initialRoute = useMemo(routeFromLocation, [])
  const [currentView, setCurrentView] = useState(initialRoute.view)
  const [selectedBusiness, setSelectedBusiness] = useState(null)
  const [selectedActionId, setSelectedActionId] = useState(initialRoute.actionId)
  const [weekStart, setWeekStart] = useState(initialRoute.weekStart || getPacificWeekStart())
  const [projectId, setProjectId] = useState(initialRoute.projectId || null)
  const [documentId, setDocumentId] = useState(initialRoute.documentId || null)
  const [savedViewId, setSavedViewId] = useState(initialRoute.savedViewId || null)
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
    const path = view === 'week' ? `/week/${weekStart}` : (VIEW_PATHS[view] || VIEW_PATHS.today)
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: view }, '', path)
    setCurrentView(view)
    setSelectedActionId(null)
    setProjectId(null)
    setDocumentId(null)
    setSavedViewId(null)
    setSearchQuery('')
  }, [weekStart])

  const navigateProject = useCallback((nextProjectId, { replace = false } = {}) => {
    const path = nextProjectId ? `/projects/${encodeURIComponent(nextProjectId)}` : '/projects'
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'projects', projectId: nextProjectId }, '', path)
    setCurrentView('projects')
    setProjectId(nextProjectId || null)
    setSelectedActionId(null)
    setSearchQuery('')
  }, [])

  const navigateDocument = useCallback((nextDocumentId, { replace = false } = {}) => {
    const path = nextDocumentId ? `/documents/${encodeURIComponent(nextDocumentId)}` : '/documents'
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'documents', documentId: nextDocumentId }, '', path)
    setCurrentView('documents')
    setDocumentId(nextDocumentId || null)
    setSelectedActionId(null)
    setSearchQuery('')
  }, [])

  const navigateSavedView = useCallback((nextSavedViewId, { replace = false } = {}) => {
    const params = new URLSearchParams()
    if (nextSavedViewId) params.set('saved_view', nextSavedViewId)
    const path = `/tasks${params.toString() ? `?${params}` : ''}`
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'dashboard', savedViewId: nextSavedViewId }, '', path)
    setCurrentView('dashboard')
    setSavedViewId(nextSavedViewId || null)
    setSelectedActionId(null)
    setSearchQuery('')
  }, [])

  const navigateWeek = useCallback((nextWeekStart, { replace = false } = {}) => {
    setWeekStart(nextWeekStart)
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'week', weekStart: nextWeekStart }, '', `/week/${nextWeekStart}`)
    setCurrentView('week')
    setSelectedActionId(null)
    setSearchQuery('')
  }, [])

  const openAction = useCallback((actionId) => {
    const backgroundPath = currentView === 'week'
      ? `/week/${weekStart}`
      : (currentView === 'projects' && projectId
        ? `/projects/${encodeURIComponent(projectId)}`
        : (currentView === 'dashboard' && savedViewId
          ? `/tasks?saved_view=${encodeURIComponent(savedViewId)}`
          : (VIEW_PATHS[currentView] || VIEW_PATHS.dashboard)))
    window.history.pushState({ atlasAction: true, backgroundPath }, '', `/actions/${encodeURIComponent(actionId)}`)
    setSelectedActionId(actionId)
  }, [currentView, weekStart, projectId, savedViewId])

  const closeAction = useCallback(() => {
    const backgroundPath = window.history.state?.backgroundPath || (currentView === 'week' ? `/week/${weekStart}` : (VIEW_PATHS[currentView] || VIEW_PATHS.dashboard))
    window.history.replaceState({ atlasView: currentView }, '', backgroundPath)
    setSelectedActionId(null)
  }, [currentView, weekStart])

  useEffect(() => {
    function handlePopState() {
      const route = routeFromLocation()
      setCurrentView(route.view)
      setSelectedActionId(route.actionId)
      if (route.weekStart) setWeekStart(route.weekStart)
      setProjectId(route.projectId || null)
      setDocumentId(route.documentId || null)
      setSavedViewId(route.savedViewId || null)
      setSearchQuery('')
    }

    window.addEventListener('popstate', handlePopState)
    if (window.location.pathname === '/') navigateView('today', { replace: true })
    if (window.location.pathname.replace(/\/$/, '') === '/week') navigateWeek(getPacificWeekStart(), { replace: true })
    return () => window.removeEventListener('popstate', handlePopState)
  }, [navigateView, navigateWeek])

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
      case 'week':
        return <WeekPage weekStart={weekStart} onNavigateWeek={navigateWeek} onSelectAction={openAction} />
      case 'focus':
        return <FocusPage />
      case 'projects':
        return <ProjectsPage projectId={projectId} selectedBusiness={selectedBusiness} searchQuery={searchQuery} onOpenProject={navigateProject} onBack={() => navigateProject(null)} onSelectAction={openAction} />
      case 'documents':
        return <DocumentsPage documentId={documentId} searchQuery={searchQuery} onOpenDocument={navigateDocument} onBack={() => navigateDocument(null)} />
      case 'notifications':
        return <NotificationsPage />
      case 'review':
        return (
          <TodayReview
            selectedBusiness={selectedBusiness}
            onSelectAction={openAction}
            onOpenWeek={(date) => navigateWeek(date)}
            searchQuery={searchQuery}
          />
        )
      case 'decide':
        return <DecidePage />
      case 'journal':
        return <JournalPage searchQuery={searchQuery} />
      case 'officeDigest':
        return (
          <OfficeDigestPage
            selectedBusiness={selectedBusiness}
            searchQuery={searchQuery}
            onSelectAction={openAction}
            onOpenSavedView={navigateSavedView}
          />
        )
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
            savedViewId={savedViewId}
            onSavedViewIdChange={setSavedViewId}
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
        onNavigateWeek={navigateWeek}
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
            <React.Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-bg-surface" aria-label="Loading view" />}>{renderView()}</React.Suspense>
          </div>
        </ViewErrorBoundary>
      </Layout>

      {selectedActionId && (
        <ActionDetail
          actionId={selectedActionId}
          onClose={closeAction}
          onSelectAction={openAction}
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
