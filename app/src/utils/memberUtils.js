import { getMemberColor } from './colors.js';

export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getMemberById(members, id) {
  return members.find(m => m.id === id);
}

export function getMemberName(members, id) {
  const member = getMemberById(members, id);
  return member ? member.name : id;
}

export function getMemberAvatar(memberId) {
  return {
    initials: getInitials(memberId),
    color: getMemberColor(memberId),
  };
}
