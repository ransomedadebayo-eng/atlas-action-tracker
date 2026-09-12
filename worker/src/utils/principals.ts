export const HUMAN_PRINCIPALS = ['ransomed', 'nicole'] as const;
export const MACHINE_PRINCIPALS = ['codex', 'claude', 'nicole-codex'] as const;
export const ACTIVE_PRINCIPALS = [...HUMAN_PRINCIPALS, ...MACHINE_PRINCIPALS] as const;

export type HumanPrincipal = typeof HUMAN_PRINCIPALS[number];
export type MachinePrincipalId = typeof MACHINE_PRINCIPALS[number];
export type ActivePrincipal = typeof ACTIVE_PRINCIPALS[number];

const ACTIVE_PRINCIPAL_SET = new Set<string>(ACTIVE_PRINCIPALS);
const MACHINE_PRINCIPAL_SET = new Set<string>(MACHINE_PRINCIPALS);

export function isActivePrincipal(value: unknown): value is ActivePrincipal {
  return typeof value === 'string' && ACTIVE_PRINCIPAL_SET.has(value);
}

export function isMachinePrincipal(value: unknown): value is MachinePrincipalId {
  return typeof value === 'string' && MACHINE_PRINCIPAL_SET.has(value);
}

export function defaultOwnerForActor(actor: string): ActivePrincipal {
  return actor === 'nicole' || actor === 'nicole-codex' ? actor : 'ransomed';
}
