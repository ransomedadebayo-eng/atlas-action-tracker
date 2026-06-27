import React, { useState, useMemo, useCallback } from 'react'
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
import ActionDetail from './components/ActionDetail.jsx'
import QuickCapture from './components/QuickCapture.jsx'
import ViewErrorBoundary from './components/ViewErrorBoundary.jsx'
import { useKeyboard } from './hooks/useKeyboard.js'

export default function App() {
  const [currentView, setCurrentView] = useState('today')
  const [selectedBusiness, setSelectedBusiness] = useState(null)
  const [selectedActionId, setSelectedActionId] = useState(null)
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
          setSelectedActionId(null)
        }
      },
    },
  ], [showQuickCapture, selectedActionId, sidebarOpen])

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
            onSelectAction={setSelectedActionId}
            searchQuery={searchQuery}
          />
        )
      case 'review':
        return (
          <TodayReview
            selectedBusiness={selectedBusiness}
            onSelectAction={setSelectedActionId}
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
            onSelectAction={setSelectedActionId}
            searchQuery={searchQuery}
            hideDone={hideDone}
            onToggleHideDone={toggleHideDone}
            frozenBusinesses={frozenBusinesses}
            showFrozen={showFrozen}
          />
        )
      case 'kanban':
        return (
          <KanbanBoard
            selectedBusiness={selectedBusiness}
            onSelectAction={setSelectedActionId}
            hideDone={hideDone}
            onToggleHideDone={toggleHideDone}
          />
        )
      case 'calendar':
        return (
          <CalendarView
            selectedBusiness={selectedBusiness}
            onSelectAction={setSelectedActionId}
            onOpenQuickCapture={handleOpenQuickCapture}
          />
        )
      case 'members':
        return <MemberList onSelectAction={setSelectedActionId} />
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
        setCurrentView={(view) => {
          setCurrentView(view)
          setSelectedActionId(null)
          setSearchQuery('')
        }}
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
          onClose={() => setSelectedActionId(null)}
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
