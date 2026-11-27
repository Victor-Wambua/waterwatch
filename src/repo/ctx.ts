import type { DatabaseSync } from 'node:sqlite';
import { TenantDb, SystemDb } from '../db/index.ts';
import type { Config } from '../core/config.ts';
import { forbidden, unauthorized } from '../core/errors.ts';
import { appendAudit } from '../domain/audit.ts';
import { can, type Permission } from '../domain/rbac.ts';
import { parseSettings, type OrgSettings } from '../domain/settings.ts';
import type { Actor } from '../domain/types.ts';
import { randomUUID } from 'node:crypto';

export type Clock = () => number;
export type Runtime = { db: DatabaseSync; sys: SystemDb; cfg: Config; clock: Clock };
export type Ctx = { rt: Runtime; db: DatabaseSync; t: TenantDb; actor: Actor; now: number; settings: OrgSettings; orgId: string };

export const newId = () => randomUUID();

export function makeCtx(rt: Runtime, actor: Actor): Ctx {
  if (!actor.orgId) throw forbidden('This action requires an organisation account');
  const t = new TenantDb(rt.db, actor.orgId);
  const org = t.get<{ settings: string }>('SELECT settings FROM organisations WHERE id = :org');
  return { rt, db: rt.db, t, actor, now: rt.clock(), settings: parseSettings(org?.settings), orgId: actor.orgId };
}

export function need(ctx: Ctx, perm: Permission): void {
  if (!ctx.actor) throw unauthorized();
  if (!can(ctx.actor.role, perm)) throw forbidden();
}

export function audit(ctx: Ctx, action: string, objectType?: string, objectId?: string, detail?: Record<string, unknown>): void {
  appendAudit(ctx.db, ctx.now, { orgId: ctx.orgId, actor: ctx.actor, action, objectType, objectId, detail: { ...detail, ...(ctx.actor.ip ? { ip: ctx.actor.ip } : {}) } });
}

export function nextRef(ctx: Ctx, name: 'R' | 'WO'): string {
  ctx.t.run('INSERT INTO counters (org_id, name, value) VALUES (:org, :n, 1) ON CONFLICT(org_id, name) DO UPDATE SET value = value + 1', { n: name });
  const v = ctx.t.get<{ value: number }>('SELECT value FROM counters WHERE org_id = :org AND name = :n', { n: name });
  return `${name}-${String(1000 + (v?.value ?? 0))}`;
}

export function notify(ctx: Ctx, userIds: string[], kind: string, title: string, link?: string): void {
  for (const uid of new Set(userIds)) {
    ctx.t.run('INSERT INTO notifications (id, org_id, user_id, kind, title, link, created_at) VALUES (:id, :org, :u, :k, :t, :l, :now)', { id: newId(), u: uid, k: kind, t: title, l: link ?? null, now: ctx.now });
  }
}
export const usersWithRoles = (ctx: Ctx, roles: string[]): string[] =>
  ctx.t.all<{ id: string }>(`SELECT id FROM users WHERE org_id = :org AND status = 'active' AND role IN (${roles.map((_, i) => `:r${i}`).join(',')})`, Object.fromEntries(roles.map((r, i) => [`r${i}`, r]))).map((r) => r.id);
