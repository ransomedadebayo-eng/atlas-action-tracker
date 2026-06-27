import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default class ViewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[atlas:view]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-danger/30 bg-danger/10 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-danger" />
          <div>
            <p className="text-sm font-semibold text-text-primary">This view could not render.</p>
            <p className="mt-1 text-sm text-text-muted">
              Switch tabs or refresh Atlas. The rest of the app is still available.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
