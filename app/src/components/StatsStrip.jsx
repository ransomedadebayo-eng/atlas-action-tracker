import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Ban, FileText } from 'lucide-react';
import { useActionStats } from '../hooks/useActions.js';

export default function StatsStrip({ business }) {
  const { data: stats, isLoading } = useActionStats(business ? { business } : {});
  const safeStats = Array.isArray(stats) ? (stats[0] || {}) : (stats || {});

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="glass-card p-5 animate-pulse">
            <div className="h-4 bg-bg-elevated rounded w-20 mb-3" />
            <div className="h-8 bg-bg-elevated rounded w-12" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Active',
      value: Number(safeStats.totalActive ?? safeStats.total_active ?? safeStats.active ?? 0),
      icon: Activity,
      color: '#3b82f6',
    },
    {
      label: 'Overdue',
      value: Number(safeStats.overdue ?? 0),
      icon: AlertTriangle,
      color: '#ef4444',
      alert: Number(safeStats.overdue ?? 0) > 0,
    },
    {
      label: 'Completed (7d)',
      value: Number(safeStats.completedThisWeek ?? safeStats.completed_this_week ?? 0),
      icon: CheckCircle2,
      color: '#f4b860',
    },
    {
      label: 'Blocked',
      value: Number(safeStats.blocked ?? 0),
      icon: Ban,
      color: '#f97316',
      alert: Number(safeStats.blocked ?? 0) > 0,
    },
    {
      label: 'Pending Review',
      value: Number(safeStats.pendingReview ?? safeStats.pending_review ?? 0),
      icon: FileText,
      color: '#a855f7',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((card) => {
        const isOverdueAlert = card.label === 'Overdue' && card.alert
        return (
          <div
            key={card.label}
            className={`glass-card p-5 ${isOverdueAlert ? 'col-span-2 sm:col-span-1' : ''}`}
            style={card.alert ? { borderColor: `${card.color}30` } : undefined}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="label flex items-center gap-1.5">
                {card.label}
                {isOverdueAlert && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </span>
              <card.icon className="w-4 h-4" style={{ color: card.color }} />
            </div>
            <div
              className={`font-headline font-bold ${isOverdueAlert ? 'text-3xl' : 'text-2xl'} ${card.alert ? '' : 'text-text-primary'}`}
              style={card.alert ? { color: card.color } : undefined}
            >
              {card.value}
            </div>
          </div>
        )
      })}
    </div>
  );
}
