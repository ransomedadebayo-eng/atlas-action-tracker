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
import WeekPage from './components/WeekPage.jsx'
import ViewErrorBoundary from './components/ViewErrorBoundary.jsx'
import { useKeyboard } from './hooks/useKeyboard.js'
import { getPacificWeekStart } from './utils/dateUtils.js'

const InitiativesPage = React.lazy(() => import('./components/InitiativesPage.jsx'))
const ProjectsPage = React.lazy(() => import('./components/ProjectsPage.jsx'))
const CyclesPage = React.lazy(() => import('./components/CyclesPage.jsx'))
const TemplatesPage = React.lazy(() => import('./components/TemplatesPage.jsx'))
const DocumentsPage = React.lazy(() => import('./components/DocumentsPage.jsx'))
const ReleasesPage = React.lazy(() => import('./components/ReleasesPage.jsx'))
const InsightsPage = React.lazy(() => import('./components/InsightsPage.jsx'))
const WorkflowsPage = React.lazy(() => import('./components/WorkflowsPage.jsx'))
const NotificationsPage = React.lazy(() => import('./components/NotificationsPage.jsx'))

const VIEW_PATHS = {
  today: '/today',
  week: '/week',
  projects: '/projects',
  initiatives: '/initiatives',
  templates: '/templates',
  documents: '/documents',
  releases: '/releases',
  insights: '/insights',
  workflows: '/workflows',
  notifications: '/notifications',
  cycles: '/cycles',
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
  const weekMatch = path.match(/^\/week(?:\/([^/]+))?$/)
  if (weekMatch) {
    return { view: 'week', actionId: null, weekStart: weekMatch[1] || getPacificWeekStart() }
  }
  const projectMatch = path.match(/^\/projects(?:\/([^/]+))?$/)
  if (projectMatch) {
    return { view: 'projects', actionId: null, projectId: projectMatch[1] ? decodeURIComponent(projectMatch[1]) : null }
  }
  const initiativeMatch = path.match(/^\/initiatives(?:\/([^/]+))?$/)
  if (initiativeMatch) {
    return { view: 'initiatives', actionId: null, initiativeId: initiativeMatch[1] ? decodeURIComponent(initiativeMatch[1]) : null }
  }
  const documentMatch = path.match(/^\/documents(?:\/([^/]+))?$/)
  if (documentMatch) {
    return { view: 'documents', actionId: null, documentId: documentMatch[1] ? decodeURIComponent(documentMatch[1]) : null }
  }
  const releaseMatch = path.match(/^\/releases(?:\/([^/]+))?$/)
  if (releaseMatch) {
    return { view: 'releases', actionId: null, releasePipelineId: releaseMatch[1] ? decodeURIComponent(releaseMatch[1]) : null }
  }
  const insightMatch = path.match(/^\/insights(?:\/([^/]+))?$/)
  if (insightMatch) return { view: 'insights', actionId: null, insightId: insightMatch[1] ? decodeURIComponent(insightMatch[1]) : null }
  const dashboardMatch = path.match(/^\/dashboards\/([^/]+)$/)
  if (dashboardMatch) return { view: 'insights', actionId: null, dashboardId: decodeURIComponent(dashboardMatch[1]) }
  const cycleMatch = path.match(/^\/cycles(?:\/([^/]+))?$/)
  if (cycleMatch) {
    return { view: 'cycles', actionId: null, cycleId: cycleMatch[1] ? decodeURIComponent(cycleMatch[1]) : null }
  }
  const actionMatch = path.match(/^\/actions\/([^/]+)$/)
  if (actionMatch) {
    return { view: 'dashboard', actionId: decodeURIComponent(actionMatch[1]) }
  }
  if (path === '/tasks') {
    return { view: new URLSearchParams(window.location.search).get('view') === 'kanban' ? 'kanban' : 'dashboard', actionId: null }
  }
  const match = Object.entries(VIEW_PATHS).find(([, routePath]) => routePath.split('?')[0] === path)
  return { view: match?.[0] || 'today', actionId: null, weekStart: null, projectId: null, initiativeId: null, documentId: null, releasePipelineId: null, insightId: null, dashboardId: null, cycleId: null }
}

export default function App() {
  const initialRoute = useMemo(routeFromLocation, [])
  const [currentView, setCurrentView] = useState(initialRoute.view)
  const [selectedBusiness, setSelectedBusiness] = useState(null)
  const [selectedActionId, setSelectedActionId] = useState(initialRoute.actionId)
  const [weekStart, setWeekStart] = useState(initialRoute.weekStart || getPacificWeekStart())
  const [projectId, setProjectId] = useState(initialRoute.projectId || null)
  const [initiativeId, setInitiativeId] = useState(initialRoute.initiativeId || null)
  const [documentId, setDocumentId] = useState(initialRoute.documentId || null)
  const [releasePipelineId, setReleasePipelineId] = useState(initialRoute.releasePipelineId || null)
  const [insightId, setInsightId] = useState(initialRoute.insightId || null)
  const [dashboardId, setDashboardId] = useState(initialRoute.dashboardId || null)
  const [cycleId, setCycleId] = useState(initialRoute.cycleId || null)
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
    setInitiativeId(null)
    setDocumentId(null)
    setReleasePipelineId(null)
    setInsightId(null)
    setDashboardId(null)
    setCycleId(null)
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

  const navigateInitiative = useCallback((nextInitiativeId, { replace = false } = {}) => {
    const path = nextInitiativeId ? `/initiatives/${encodeURIComponent(nextInitiativeId)}` : '/initiatives'
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'initiatives', initiativeId: nextInitiativeId }, '', path)
    setCurrentView('initiatives')
    setInitiativeId(nextInitiativeId || null)
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

  const navigateReleasePipeline = useCallback((nextPipelineId, { replace = false } = {}) => {
    const path = nextPipelineId ? `/releases/${encodeURIComponent(nextPipelineId)}` : '/releases'
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'releases', releasePipelineId: nextPipelineId }, '', path)
    setCurrentView('releases')
    setReleasePipelineId(nextPipelineId || null)
    setSelectedActionId(null)
    setSearchQuery('')
  }, [])

  const navigateInsight = useCallback((nextInsightId, { replace = false } = {}) => {
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'insights', insightId: nextInsightId }, '', nextInsightId ? `/insights/${encodeURIComponent(nextInsightId)}` : '/insights')
    setCurrentView('insights'); setInsightId(nextInsightId || null); setDashboardId(null); setSelectedActionId(null); setSearchQuery('')
  }, [])
  const navigateDashboard = useCallback((nextDashboardId, { replace = false } = {}) => {
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'insights', dashboardId: nextDashboardId }, '', nextDashboardId ? `/dashboards/${encodeURIComponent(nextDashboardId)}` : '/insights')
    setCurrentView('insights'); setDashboardId(nextDashboardId || null); setInsightId(null); setSelectedActionId(null); setSearchQuery('')
  }, [])

  const navigateCycle = useCallback((nextCycleId, { replace = false } = {}) => {
    const path = nextCycleId ? `/cycles/${encodeURIComponent(nextCycleId)}` : '/cycles'
    window.history[replace ? 'replaceState' : 'pushState']({ atlasView: 'cycles', cycleId: nextCycleId }, '', path)
    setCurrentView('cycles')
    setCycleId(nextCycleId || null)
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
    const backgroundPath = currentView === 'week' ? `/week/${weekStart}` : (currentView === 'projects' && projectId ? `/projects/${encodeURIComponent(projectId)}` : (currentView === 'cycles' && cycleId ? `/cycles/${encodeURIComponent(cycleId)}` : (VIEW_PATHS[currentView] || VIEW_PATHS.dashboard)))
    window.history.pushState({ atlasAction: true, backgroundPath }, '', `/actions/${encodeURIComponent(actionId)}`)
    setSelectedActionId(actionId)
  }, [currentView, weekStart, projectId, cycleId])

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
      setInitiativeId(route.initiativeId || null)
      setDocumentId(route.documentId || null)
      setReleasePipelineId(route.releasePipelineId || null)
      setInsightId(route.insightId || null)
      setDashboardId(route.dashboardId || null)
      setCycleId(route.cycleId || null)
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
      case 'projects':
        return <ProjectsPage projectId={projectId} selectedBusiness={selectedBusiness} searchQuery={searchQuery} onOpenProject={navigateProject} onOpenInitiative={navigateInitiative} onBack={() => navigateProject(null)} onSelectAction={openAction} />
      case 'initiatives':
        return <InitiativesPage initiativeId={initiativeId} selectedBusiness={selectedBusiness} searchQuery={searchQuery} onOpenInitiative={navigateInitiative} onBack={() => navigateInitiative(null)} onOpenProject={navigateProject} />
      case 'templates':
        return <TemplatesPage selectedBusiness={selectedBusiness} onOpenAction={openAction} onOpenProject={navigateProject} onOpenDocument={navigateDocument} />
      case 'documents':
        return <DocumentsPage documentId={documentId} searchQuery={searchQuery} onOpenDocument={navigateDocument} onBack={() => navigateDocument(null)} />
      case 'releases':
        return <ReleasesPage pipelineId={releasePipelineId} selectedBusiness={selectedBusiness} onOpenPipeline={navigateReleasePipeline} onBack={() => navigateReleasePipeline(null)} />
      case 'insights':
        return <InsightsPage insightId={insightId} dashboardId={dashboardId} selectedBusiness={selectedBusiness} onOpenInsight={navigateInsight} onOpenDashboard={navigateDashboard} onOpenAction={openAction} onBack={() => navigateInsight(null)} />
      case 'workflows':
        return <WorkflowsPage selectedBusiness={selectedBusiness} onOpenAction={openAction} />
      case 'notifications':
        return <NotificationsPage />
      case 'cycles':
        return <CyclesPage cycleId={cycleId} selectedBusiness={selectedBusiness} onOpenCycle={navigateCycle} onBack={() => navigateCycle(null)} onSelectAction={openAction} />
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
