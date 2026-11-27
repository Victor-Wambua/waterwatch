export const ROLES = ['reporter', 'technician', 'dispatcher', 'org_admin', 'platform_admin', 'auditor'] as const;
export type Role = (typeof ROLES)[number];
export const ASSET_TYPES = ['borehole', 'kiosk', 'waterpoint', 'pump', 'tank', 'treatment', 'valve', 'pipe'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_STATUSES = ['operational', 'degraded', 'down', 'contamination', 'unknown'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const REPORT_CATEGORIES = ['no_water', 'low_pressure', 'leak', 'pump_failure', 'contamination', 'damage', 'access'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const PRIORITIES = ['P1', 'P2', 'P3'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const WO_STATUSES = ['new', 'assigned', 'in_progress', 'awaiting_parts', 'completed', 'closed', 'cancelled'] as const;
export type WoStatus = (typeof WO_STATUSES)[number];
export const WO_KINDS = ['reactive', 'planned', 'sensor', 'contamination'] as const;
export type WoKind = (typeof WO_KINDS)[number];
export const COST_CATEGORIES = ['parts', 'labour', 'contractor', 'transport'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const SENSOR_KINDS = ['flow', 'level', 'pump_status', 'pressure', 'quality'] as const;
export type SensorKind = (typeof SENSOR_KINDS)[number];
export type Origin = 'real' | 'simulated';
export type DataOrigin = 'verified_live' | 'verified_historical' | 'user_submitted' | 'officially_published' | 'synthetic' | 'mock_integration' | 'imported';

/** Categories counted as "reported outages" in analytics (documented in docs/API.md and the analytics page). */
export const OUTAGE_CATEGORIES: readonly ReportCategory[] = ['no_water', 'low_pressure', 'pump_failure', 'leak'];

export type Actor = {
  id: string;
  orgId: string | null;
  role: Role;
  name: string;
  scopeOwner: string | null;
  ip?: string;
};
