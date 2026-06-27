import React from 'react';
import { getMemberColor } from '../utils/colors.js';
import { getInitials } from '../utils/memberUtils.js';

export default function OwnerAvatars({ owners = [], members = [], max = 3, size = 'sm' }) {
  const normalizedOwners = (Array.isArray(owners) ? owners : [])
    .map((owner) => {
      if (typeof owner === 'string') return { id: owner, name: owner };
      if (owner && typeof owner === 'object') {
        const id = String(owner.id || owner.name || '').trim();
        const name = String(owner.name || owner.id || '').trim();
        return id || name ? { id: id || name, name: name || id } : null;
      }
      const value = String(owner || '').trim();
      return value ? { id: value, name: value } : null;
    })
    .filter(Boolean);

  if (!normalizedOwners.length) return <span className="text-text-muted text-xs">Unassigned</span>;

  const sizeClasses = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
  };

  const displayed = normalizedOwners.slice(0, max);
  const remaining = normalizedOwners.length - max;

  function getName(owner) {
    const ownerId = owner.id;
    const member = members.find(m => m.id === ownerId);
    return member ? member.name : owner.name;
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {displayed.map((owner) => {
        const name = getName(owner);
        const color = getMemberColor(owner.id);
        return (
          <div
            key={owner.id}
            className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-mono font-semibold ring-2 ring-bg-surface`}
            style={{ backgroundColor: `${color}30`, color }}
            title={name}
          >
            {getInitials(name)}
          </div>
        );
      })}
      {remaining > 0 && (
        <div
          className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-mono font-semibold bg-bg-elevated text-text-secondary ring-2 ring-bg-surface`}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
