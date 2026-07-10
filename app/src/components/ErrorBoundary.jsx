import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[atlas] React render failed', error, info)
  }

  render() {
    if (this.state.error) {
      const errorName = this.state.error?.name || 'RenderError'
      const errorMessage = this.state.error?.message || 'No error message was provided.'

      return (
        <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center px-4">
          <div className="w-full max-w-lg rounded-2xl border border-danger/30 bg-danger/10 p-6">
            <p className="text-danger text-xs uppercase tracking-widest font-semibold mb-2">
              Atlas could not render
            </p>
            <h1 className="text-xl font-bold mb-3">Refresh the page to try again.</h1>
            <p className="text-sm text-text-secondary">
              The app hit a frontend error after loading.
            </p>
            <div className="mt-4 rounded-lg border border-danger/20 bg-bg-primary/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-danger">
                {errorName}
              </p>
              <p className="mt-1 break-words text-sm text-text-primary">{errorMessage}</p>
            </div>
            <button
              type="button"
              className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-bg-primary"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
