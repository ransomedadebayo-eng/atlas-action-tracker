import React from 'react';

const DiscussionThread = React.lazy(() => import('./DiscussionThread.jsx'));

export default function LazyDiscussionThread(props) {
  return <React.Suspense fallback={<div className="h-20 animate-pulse rounded-lg bg-bg-elevated" aria-label="Loading discussion" />}><DiscussionThread {...props} /></React.Suspense>;
}
