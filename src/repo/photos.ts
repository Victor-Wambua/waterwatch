import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256hex } from '../core/crypto.ts';
import { forbidden, notFound } from '../core/errors.ts';
import { processImage } from '../domain/uploads.ts';
import { audit, newId, type Ctx } from './ctx.ts';

export type PhotoRow = { id: string; org_id: string; kind: string; uploader_id: string; mime: string; bytes: number; path: string };

export async function savePhoto(ctx: Ctx, kind: 'report' | 'completion', input: Uint8Array): Promise<string> {
  const p = await processImage(input, ctx.rt.cfg.maxUploadBytes);
  const id = newId();
  const dir = join(ctx.rt.cfg.dataDir, 'photos', ctx.orgId);
  mkdirSync(dir, { recursive: true });
  const rel = join(ctx.orgId, `${id}.jpg`); // never derived from user input
  writeFileSync(join(ctx.rt.cfg.dataDir, 'photos', rel), p.buf, { mode: 0o600 });
  ctx.t.run('INSERT INTO photos (id, org_id, kind, uploader_id, mime, bytes, sha256, path, width, height, created_at) VALUES (:id,:org,:k,:u,:m,:b,:h,:p,:w,:ht,:now)',
    { id, k: kind, u: ctx.actor.id, m: p.mime, b: p.buf.length, h: sha256hex(p.buf), p: rel, w: p.width, ht: p.height, now: ctx.now });
  audit(ctx, 'photo.uploaded', 'photo', id, { kind, bytes: p.buf.length });
  return id;
}

/** Authorised read: dispatcher/admin/auditor may view all org photos; reporters their own report photo; technicians photos on their work orders. */
export function readPhoto(ctx: Ctx, id: string): { data: Buffer; mime: string } {
  const ph = ctx.t.get<PhotoRow>('SELECT * FROM photos WHERE id = :id AND org_id = :org', { id });
  if (!ph) throw notFound();
  const role = ctx.actor.role;
  let allowed = ph.uploader_id === ctx.actor.id;
  if (!allowed && (role === 'dispatcher' || role === 'org_admin' || role === 'auditor')) allowed = ctx.actor.scopeOwner === null;
  if (!allowed && role === 'technician') {
    allowed = !!ctx.t.get(`SELECT 1 AS x FROM work_orders w WHERE w.org_id = :org AND w.assignee_id = :u AND (w.completion_photo_id = :id
      OR EXISTS (SELECT 1 FROM reports r WHERE r.org_id = :org AND r.work_order_id = w.id AND r.photo_id = :id))`, { u: ctx.actor.id, id });
  }
  if (!allowed) throw forbidden();
  audit(ctx, 'photo.viewed', 'photo', id);
  return { data: readFileSync(join(ctx.rt.cfg.dataDir, 'photos', ph.path)), mime: ph.mime };
}
