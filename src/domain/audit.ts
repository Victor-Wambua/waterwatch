import type { DatabaseSync } from 'node:sqlite';
import { sha256hex } from '../core/crypto.ts';
import { tx } from '../db/index.ts';
import type { Actor } from './types.ts';

export const GENESIS = '0'.repeat(64);
export type AuditInput = { orgId: string | null; actor: Pick<Actor, 'id' | 'role'> | null; action: string; objectType?: string; objectId?: string; detail?: Record<string, unknown> };
type Row = { seq: number; chain: string; org_id: string | null; ts: number; actor_id: string | null; actor_role: string | null; action: string; object_type: string | null; object_id: string | null; detail: string; prev_hash: string; hash: string };

export const chainOf = (orgId: string | null) => orgId ?? 'platform';
const canon = (r: { chain: string; ts: number; actor_id: string | null; actor_role: string | null; action: string; object_type: string | null; object_id: string | null; detail: string; prev_hash: string }) =>
  JSON.stringify([r.chain, r.ts, r.actor_id, r.actor_role, r.action, r.object_type, r.object_id, r.detail, r.prev_hash]);

/** Append-only, hash-chained (per organisation). DB triggers additionally reject UPDATE/DELETE. */
export function appendAudit(db: DatabaseSync, now: number, e: AuditInput): void {
  tx(db, () => {
    const chain = chainOf(e.orgId);
    const last = db.prepare('SELECT hash FROM audit_log WHERE chain = ? ORDER BY seq DESC LIMIT 1').get(chain) as { hash: string } | undefined;
    const prev = last?.hash ?? GENESIS;
    const row = { chain, ts: now, actor_id: e.actor?.id ?? null, actor_role: e.actor?.role ?? null, action: e.action, object_type: e.objectType ?? null, object_id: e.objectId ?? null, detail: JSON.stringify(e.detail ?? {}), prev_hash: prev };
    const hash = sha256hex(canon(row));
    db.prepare('INSERT INTO audit_log (chain, org_id, ts, actor_id, actor_role, action, object_type, object_id, detail, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(row.chain, e.orgId, row.ts, row.actor_id, row.actor_role, row.action, row.object_type, row.object_id, row.detail, prev, hash);
  });
}

export type VerifyResult = { ok: boolean; checked: number; head: string; brokenAtSeq?: number; reason?: string };
export function verifyChain(db: DatabaseSync, orgId: string | null): VerifyResult {
  const chain = chainOf(orgId);
  const rows = db.prepare('SELECT * FROM audit_log WHERE chain = ? ORDER BY seq ASC').all(chain) as Row[];
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev) return { ok: false, checked: 0, head: prev, brokenAtSeq: r.seq, reason: 'prev_hash does not match previous entry' };
    if (sha256hex(canon(r)) !== r.hash) return { ok: false, checked: 0, head: prev, brokenAtSeq: r.seq, reason: 'entry content does not match its hash' };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, head: prev };
}
