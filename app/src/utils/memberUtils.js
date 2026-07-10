import { getMemberColor } from './colors.js';

export const ACTIVE_PRINCIPAL_IDS = Object.freeze(['ransomed', 'codex', 'claude']);
const ACTIVE_PRINCIPAL_SET = new Set(ACTIVE_PRINCIPAL_IDS);

export function isActivePrincipal(memberOrId) {
  const id = typeof memberOrId === 'object' ? (memberOrId?.id || memberOrId?.member_id) : memberOrId;
  return ACTIVE_PRINCIPAL_SET.has(String(id || '').trim().toLowerCase());
}

export function activePrincipals(members = []) {
  const items = Array.isArray(members) ? members : (Array.isArray(members?.items) ? members.items : []);
  return items.filter(isActivePrincipal);
}

export function getInitials(name) {
  if (!name) return '?';
  const value = typeof name === 'string'
    ? name
    : name && typeof name === 'object'
      ? String(name.name || name.id || '')
      : String(name);
  if (!value.trim()) return '?';
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function normalizeMemberRef(memberRef) {
  if (typeof memberRef === 'string') {
    const id = memberRef.trim();
    return id ? { id, name: id } : null;
  }
  if (memberRef && typeof memberRef === 'object') {
    const id = String(memberRef.id || memberRef.name || '').trim();
    const name = String(memberRef.name || memberRef.id || '').trim();
    return id || name ? { id: id || name, name: name || id } : null;
  }
  const value = String(memberRef || '').trim();
  return value ? { id: value, name: value } : null;
}

export function normalizeMemberRefs(memberRefs) {
  return (Array.isArray(memberRefs) ? memberRefs : [])
    .map(normalizeMemberRef)
    .filter(Boolean);
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
