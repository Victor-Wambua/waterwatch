import { z } from 'zod';
import { KENYA_BOUNDS } from '../core/geo.ts';

export const settingsSchema = z.object({
  /** SLA targets in minutes. PLACEHOLDERS (2 h / 24 h / 72 h) to be set by each utility. */
  slaMinutes: z.object({ P1: z.number().int().min(5).default(120), P2: z.number().int().min(5).default(1440), P3: z.number().int().min(5).default(4320) }).default({ P1: 120, P2: 1440, P3: 4320 }),
  slaPauseAwaitingParts: z.boolean().default(false),
  bounds: z.object({ minLat: z.number().min(-90).max(90), maxLat: z.number().min(-90).max(90), minLng: z.number().min(-180).max(180), maxLng: z.number().min(-180).max(180) })
    .refine((b) => b.minLat < b.maxLat && b.minLng < b.maxLng, 'Bounds min must be below max').default(KENYA_BOUNDS),
  tzOffsetMin: z.number().int().min(-720).max(840).default(180),
  healthLateFactor: z.number().min(1).max(10).default(1.25),
  healthMissingFactor: z.number().min(1.1).max(20).default(2),
  batteryLowPct: z.number().min(0).max(100).default(20),
  rssiWeakDbm: z.number().min(-140).max(0).default(-105),
  ingestMaxAgeDays: z.number().int().min(1).max(365).default(30),
  ingestSkewSec: z.number().int().min(30).max(3600).default(300),
  reportsPerHour: z.number().int().min(1).max(200).default(10),
  duplicateWindowMin: z.number().int().min(0).max(1440).default(30),
  repeatWindowDays: z.number().int().min(7).max(730).default(90)
});
export type OrgSettings = z.infer<typeof settingsSchema>;
export const parseSettings = (json: string | null | undefined): OrgSettings => {
  let obj: unknown;
  try { obj = json ? JSON.parse(json) : {}; } catch { obj = {}; }
  const r = settingsSchema.safeParse(obj);
  return r.success ? r.data : settingsSchema.parse({});
};
