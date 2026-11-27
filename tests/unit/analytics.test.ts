import { describe, expect, it } from 'vitest';
import { availability, costSummary, downtimeByAsset, flowVolume, localDay, mttr, outagesPerWeek, repeatFailures, slaCompliance, weekStart, type WoRow } from '../../src/domain/analytics.ts';

// Fixtures use Nairobi local time (UTC+3 = 180 min). 2026-06-01 is a Monday.
const OFF = 180, H = 3_600_000, D = 24 * H;
const E = (day: number, hour: number, min = 0, month = 5) => Date.UTC(2026, month, day, hour - 3, min); // local EAT -> epoch
const FROM = E(1, 0), TO = FROM + 21 * D - 1; // exactly three Monday-based weeks

describe('weekStart / localDay', () => {
  it('maps to the Monday 00:00 local, respecting the week boundary', () => {
    expect(weekStart(E(7, 23, 59), OFF)).toBe(E(1, 0));
    expect(weekStart(E(8, 0), OFF)).toBe(E(8, 0));
    expect(weekStart(E(1, 0), OFF)).toBe(E(1, 0));
  });
  it('local day differs from UTC day near midnight', () => { expect(localDay(E(2, 0, 30), OFF)).toBe('2026-06-02'); expect(new Date(E(2, 0, 30)).toISOString().slice(0, 10)).toBe('2026-06-01'); });
});

describe('outages per week', () => {
  const r = (category: string, status: string, t: number) => ({ category, status, created_at: t });
  const reports = [r('no_water', 'new', E(2, 10)), r('leak', 'linked', E(3, 10)), r('contamination', 'new', E(3, 11)), r('pump_failure', 'new', E(9, 9)), r('low_pressure', 'duplicate', E(10, 9)),
    r('no_water', 'new', E(16, 9)), r('access', 'new', E(17, 8)), r('low_pressure', 'new', E(14, 23, 59)), r('no_water', 'new', E(15, 0)), r('no_water', 'rejected', E(16, 10)), r('no_water', 'new', FROM - 1)];
  it('counts outage categories only, excludes duplicates/rejected/out-of-window, honours local week boundaries', () => {
    const w = outagesPerWeek(reports, FROM, TO, OFF);
    expect(w.map((x) => x.count)).toEqual([2, 2, 2]);
    expect(w.map((x) => x.label)).toEqual(['06-01', '06-08', '06-15']);
  });
  it('fills empty weeks with zero', () => expect(outagesPerWeek([], FROM, TO, OFF).map((x) => x.count)).toEqual([0, 0, 0]));
});

const wo = (id: string, asset: string, title: string, kind: string, status: string, fault: number, done: number | null): WoRow => ({ id, asset_id: asset, title, kind, status, priority: 'P2', created_at: fault, fault_started_at: fault, completed_at: done });
const WOS: WoRow[] = [
  wo('w1', 'A-X', 'Starter contactor', 'reactive', 'closed', E(2, 10), E(2, 22)),
  wo('w2', 'A-X', 'Starter contactor', 'reactive', 'completed', E(9, 8), E(10, 8)),
  wo('w3', 'A-Y', 'Contamination response', 'contamination', 'closed', E(16, 0), E(16, 6)),
  wo('w4', 'A-Z', 'Planned service', 'planned', 'closed', E(5, 8), E(5, 12)),
  wo('w5', 'A-Y', 'Pump check', 'reactive', 'in_progress', E(16, 3), null),
  wo('w6', 'A-W', 'Sensor check', 'sensor', 'closed', E(6, 8), E(6, 12)),
  wo('w7', 'A-Q', 'Cancelled job', 'reactive', 'cancelled', E(6, 8), null)
];

describe('MTTR', () => {
  it('mean 14 h, median 12 h over (12, 24, 6); planned/sensor/open/cancelled excluded', () => {
    const m = mttr(WOS, FROM, TO, OFF);
    expect(m.count).toBe(3); expect(m.meanHours).toBeCloseTo(14, 10); expect(m.medianHours).toBe(12);
    expect(m.weekly.map((w) => [w.count, w.meanHours])).toEqual([[1, 12], [1, 24], [1, 6]]);
  });
  it('median of an even count is the mean of the middle two', () => { const m = mttr([WOS[0] as WoRow, WOS[1] as WoRow], FROM, TO, OFF); expect(m.medianHours).toBe(18); });
  it('null when there are no completed repairs', () => { const m = mttr([], FROM, TO, OFF); expect(m.meanHours).toBeNull(); expect(m.medianHours).toBeNull(); expect(m.count).toBe(0); });
  it('only repairs completed inside the window count', () => expect(mttr(WOS, E(10, 12), TO, OFF).count).toBe(1));
});

describe('repeat failures', () => {
  it('assets with 2+ reactive/contamination work orders, ordered by count then id; most common job; excludes planned, sensor, cancelled', () => {
    const r = repeatFailures(WOS, FROM, TO);
    expect(r).toEqual([{ assetId: 'A-X', count: 2, commonJob: 'Starter contactor' }, { assetId: 'A-Y', count: 2, commonJob: 'Contamination response' }]);
  });
  it('respects the minimum count and window', () => { expect(repeatFailures(WOS, FROM, TO, 3)).toEqual([]); expect(repeatFailures(WOS, E(17, 0), TO)).toEqual([]); });
});

describe('downtime and availability', () => {
  it('sums disjoint intervals and merges overlapping ones; open work runs to now and is flagged ongoing', () => {
    const d = downtimeByAsset(WOS, FROM, TO, TO);
    const x = d.find((a) => a.assetId === 'A-X'), y = d.find((a) => a.assetId === 'A-Y');
    expect(x?.hours).toBeCloseTo(36, 9); expect(x?.ongoing).toBe(false);
    expect(y?.hours).toBeCloseTo(144, 3); expect(y?.ongoing).toBe(true); // merged [Jun16 00:00 .. end of window]
    expect(d.map((a) => a.assetId)).toEqual(['A-Y', 'A-X']); // planned, sensor, cancelled never create downtime
  });
  it('clips to the window', () => {
    const d = downtimeByAsset([wo('c', 'A-Q', 't', 'reactive', 'closed', E(31, 12, 0, 4), E(1, 6))], FROM, TO, TO);
    expect(d[0]?.hours).toBe(6);
  });
  it('availability = 1 - downtime/window, floored at 0, 1 for empty window', () => {
    expect(availability(36, FROM, TO)).toBeCloseTo(1 - 36 / 504, 5);
    expect(availability(10_000, FROM, TO)).toBe(0); expect(availability(0, FROM, FROM)).toBe(1);
  });
});

describe('cost summary (integer minor units)', () => {
  it('totals by category and asset', () => {
    const c = costSummary([{ asset_id: 'A-X', category: 'parts', qty: 2, unit_cost_minor: 15000 }, { asset_id: 'A-X', category: 'labour', qty: 1, unit_cost_minor: 5000 }, { asset_id: 'A-Y', category: 'parts', qty: 1, unit_cost_minor: 12345 }, { asset_id: 'A-Y', category: 'contractor', qty: 1, unit_cost_minor: 100000 }]);
    expect(c.totalMinor).toBe(147345);
    expect(c.byCategory).toEqual([{ category: 'contractor', minor: 100000 }, { category: 'parts', minor: 42345 }, { category: 'labour', minor: 5000 }]);
    expect(c.byAsset).toEqual([{ assetId: 'A-Y', minor: 112345 }, { assetId: 'A-X', minor: 35000 }]);
    expect(Number.isInteger(c.totalMinor)).toBe(true);
  });
  it('empty input', () => expect(costSummary([]).totalMinor).toBe(0));
});

describe('SLA compliance', () => {
  it('2 of 3 judged met; unjudged ignored', () => { const s = slaCompliance([{ sla_met: true }, { sla_met: true }, { sla_met: false }, { sla_met: null }]); expect(s).toEqual({ judged: 3, met: 2, pct: 2 / 3 }); });
  it('null percentage when nothing is judged', () => expect(slaCompliance([]).pct).toBeNull());
});

describe('flow volume (m3/h readings, rectangle rule, gaps reported not estimated)', () => {
  const t = (h: number, m: number, day = 2) => E(day, h, m);
  it('hand-computed: 15 + 10 + 40 + 5 = 70 m3 with a 0.5 h unmetered gap', () => {
    const v = flowVolume([{ ts: t(0, 0), value: 60 }, { ts: t(0, 15), value: 40 }, { ts: t(0, 30), value: 80 }, { ts: t(1, 30), value: 20 }, { ts: t(1, 45), value: 0 }], 900, OFF);
    expect(v.totalM3).toBeCloseTo(70, 9); expect(v.gapHours).toBeCloseTo(0.5, 9);
    expect(v.daily).toEqual([{ day: '2026-06-02', m3: expect.closeTo(70, 9), gapHours: expect.closeTo(0.5, 9) }]);
  });
  it('is independent of input order and buckets by local day', () => {
    const v = flowVolume([{ ts: t(0, 0, 3), value: 0 }, { ts: t(23, 45, 2), value: 40 }], 900, OFF);
    expect(v.daily).toEqual([{ day: '2026-06-02', m3: expect.closeTo(10, 9), gapHours: 0 }]);
  });
  it('fewer than two readings means no volume', () => { expect(flowVolume([], 900, OFF).totalM3).toBe(0); expect(flowVolume([{ ts: 1, value: 5 }], 900, OFF).totalM3).toBe(0); });
});
