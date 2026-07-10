import React from 'react';
import { getMemberColor } from '../utils/colors.js';
import { getInitials, normalizeMemberRefs } from '../utils/memberUtils.js';

function ownerIdFromValue(owner) {
  if (owner && typeof owner === 'object') {
    return owner.id || owner.member_id || owner.user_id || owner.name || 'unknown';
  }
  return owner || 'unknown';
}

function ownerNameFromValue(owner) {
  if (owner && typeof owner === 'object') {
    return owner.name || owner.label || owner.id || owner.member_id || owner.user_id || 'Unknown';
  }
  return owner || 'Unknown';
}

export default function OwnerAvatars({ owners = [], members = [], max = 3, size = 'sm' }) {
  const normalizedOwners = normalizeMemberRefs(owners);

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
    const ownerId = ownerIdFromValue(owner);
    const member = members.find(m => m.id === ownerId);
    return member ? member.name : ownerNameFromValue(owner);
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {displayed.map((owner, index) => {
        const ownerId = ownerIdFromValue(owner);
        const name = getName(owner);
        const color = getMemberColor(ownerId);
        return (
          <div
            key={`${ownerId}-${index}`}
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
