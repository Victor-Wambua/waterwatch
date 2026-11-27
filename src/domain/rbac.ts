import type { Role } from './types.ts';

export const PERMISSIONS = [
  'asset.read', 'asset.write', 'asset.import',
  'report.create', 'report.read_own', 'report.read', 'report.reporter_contact', 'report.triage',
  'wo.read', 'wo.read_assigned', 'wo.create', 'wo.assign', 'wo.update_assigned', 'wo.confirm', 'wo.cost.read',
  'schedule.manage', 'device.manage', 'sensor.read', 'alert.manage', 'analytics.read', 'export',
  'audit.read', 'user.manage', 'settings.manage', 'org.manage', 'notification.read'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const dispatcher: Permission[] = [
  'asset.read', 'asset.write', 'report.read', 'report.reporter_contact', 'report.triage', 'wo.read', 'wo.create', 'wo.assign', 'wo.confirm',
  'wo.cost.read', 'schedule.manage', 'sensor.read', 'alert.manage', 'analytics.read', 'export', 'notification.read'
];

export const MATRIX: Record<Role, readonly Permission[]> = {
  reporter: ['report.create', 'report.read_own'],
  technician: ['wo.read_assigned', 'wo.update_assigned', 'notification.read'],
  dispatcher,
  org_admin: [...dispatcher, 'asset.import', 'device.manage', 'user.manage', 'settings.manage', 'audit.read'],
  auditor: ['asset.read', 'report.read', 'wo.read', 'wo.cost.read', 'sensor.read', 'analytics.read', 'audit.read', 'export'],
  platform_admin: ['org.manage', 'user.manage', 'audit.read']
};

export const can = (role: Role, perm: Permission): boolean => MATRIX[role].includes(perm);
export const MFA_ROLES: readonly Role[] = ['dispatcher', 'org_admin', 'platform_admin'];
export const mfaRequired = (role: Role) => MFA_ROLES.includes(role);
/** Roles an org_admin may create. platform_admin is never creatable from the UI. */
export const ORG_ASSIGNABLE_ROLES: readonly Role[] = ['reporter', 'technician', 'dispatcher', 'org_admin', 'auditor'];
export const roleLabel: Record<Role, string> = {
  reporter: 'Community reporter', technician: 'Technician', dispatcher: 'Dispatcher / manager', org_admin: 'Utility admin',
  platform_admin: 'Platform admin', auditor: 'Read-only auditor'
};
