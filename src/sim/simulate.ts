/**
 * WaterWatch device SIMULATOR. Sends SIGNED batches for devices registered with origin "simulated".
 * Every payload carries origin: "simulated"; the platform labels the data "SIMULATED SENSOR — test environment".
 * Never point this at a production environment (production refuses simulated devices).
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomToken } from '../core/crypto.ts';
import { signRequest } from '../repo/ingest.ts';

export type SimSensor = { key: string; kind: string; base: number; amp: number; intervalS: number; unit?: string };
export type SimDevice = { deviceKey: string; secret: string; name: string; sensors: SimSensor[] };
export const BANNER = 'SIMULATED SENSORS — test environment. Data sent by this tool is flagged origin=simulated and is never real telemetry.';

export type Reading = { sensor: string; ts: number; value: number; id: string };
export function makeReadings(dev: SimDevice, tsList: number[], mode: 'normal' | 'flatline' = 'normal', rnd: () => number = Math.random): Reading[] {
  const out: Reading[] = [];
  for (const s of dev.sensors) for (const ts of tsList) {
    const k = ts / (s.intervalS * 1000);
    let v = s.base + s.amp * Math.sin(k / 3.2) + (rnd() - 0.5) * s.amp * 0.2;
    if (mode === 'flatline') v = s.base;
    if (s.kind === 'pump_status') v = 1;
    out.push({ sensor: s.key, ts, value: Math.round(v * 100) / 100, id: `${s.key}:${ts}` });
  }
  return out;
}

export function buildRequest(dev: SimDevice, readings: Reading[], nowMs: number, batchId?: string) {
  const body = JSON.stringify({ batch_id: batchId ?? `sim-${nowMs}`, origin: 'simulated', device: { battery_pct: 80, rssi_dbm: -84 }, readings });
  const ts = String(Math.floor(nowMs / 1000)), nonce = randomToken(12);
  return { body, headers: { 'content-type': 'application/json', 'x-ww-device': dev.deviceKey, 'x-ww-timestamp': ts, 'x-ww-nonce': nonce, 'x-ww-signature': signRequest(dev.secret, dev.deviceKey, ts, nonce, body) } };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? d) : d; };
  const has = (n: string) => args.includes(`--${n}`);
  const url = (opt('url', 'http://127.0.0.1:4400') as string).replace(/\/$/, '');
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !has('allow-remote')) { console.error('Refusing to send simulated data to a non-local host without --allow-remote.'); process.exit(2); }
  const credFile = opt('creds', 'data/simulator-devices.json') as string;
  if (!existsSync(credFile)) { console.error(`No credentials file at ${credFile}. Run "npm run seed" on a fresh database, or register a simulated device in the console and pass --device key:secret:sensorKey:kind:intervalS`); process.exit(2); }
  let devices: SimDevice[] = (JSON.parse(readFileSync(credFile, 'utf8')) as { devices: SimDevice[] }).devices;
  const extra = args.flatMap((a, i) => (a === '--device' ? [args[i + 1] as string] : []));
  for (const e of extra) { const [deviceKey, secret, key, kind, iv] = e.split(':'); devices.push({ deviceKey: deviceKey as string, secret: secret as string, name: deviceKey as string, sensors: [{ key: key ?? 'flow', kind: kind ?? 'flow', base: 50, amp: 10, intervalS: Number(iv ?? 60) }] }); }
  const only = opt('only'); if (only) devices = devices.filter((d) => d.name === only || d.deviceKey === only);
  const stop = new Set((opt('stop') ?? '').split(',').filter(Boolean)); const flat = new Set((opt('flatline') ?? '').split(',').filter(Boolean));
  const every = Number(opt('every', '15')) * 1000, count = Number(opt('count', '0')), backfill = Number(opt('backfill', '0'));
  console.log(BANNER); console.log(`Target ${url}; ${devices.length} simulated device(s); every ${every / 1000}s${count ? `; ${count} round(s)` : ''}`);
  const post = async (d: SimDevice, rs: Reading[], label: string) => {
    const r = buildRequest(d, rs, Date.now());
    try { const res = await fetch(`${url}/ingest/v1/readings`, { method: 'POST', headers: r.headers, body: r.body }); console.log(`[SIMULATED] ${d.name} ${label}: ${res.status} ${(await res.text()).slice(0, 160)}`); } catch (e) { console.log(`[SIMULATED] ${d.name} ${label}: network error ${(e as Error).message}`); }
  };
  if (backfill > 0) for (const d of devices) { // store-and-forward demo: past readings, deliberately out of order
    const iv = (d.sensors[0]?.intervalS ?? 60) * 1000, ts = Array.from({ length: backfill }, (_, i) => Date.now() - (backfill - i) * iv).reverse();
    await post(d, makeReadings(d, ts), `backfill x${backfill}`);
  }
  for (let round = 1; !count || round <= count; round++) {
    for (const d of devices) { if (stop.has(d.name)) { console.log(`[SIMULATED] ${d.name} is silent (simulated failure)`); continue; } await post(d, makeReadings(d, [Date.now()], flat.has(d.name) ? 'flatline' : 'normal'), `round ${round}`); }
    if (count && round >= count) break;
    await new Promise((r) => setTimeout(r, every));
  }
}
if (process.argv[1]?.endsWith('simulate.ts')) await main();
