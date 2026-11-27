import type { Context, MiddlewareHandler } from 'hono';
import { AppError } from '../core/errors.ts';
import { body as bodyMw, ctxOf, flash, type AppT, type Deps, type Env } from './http.ts';
import type { Ctx } from '../repo/ctx.ts';

export type Form = Record<string, string | File | (string | File)[]>;
export type ActionResult = { msg?: string; to?: string } | void;
export const fstr = (f: Form, k: string): string => { const v = f[k]; return typeof v === 'string' ? v.trim() : ''; };
export const fnum = (f: Form, k: string): number => Number(fstr(f, k));
export const ffile = (f: Form, k: string): File | null => { const v = f[k]; return v instanceof File && v.size > 0 ? v : null; };

const back = (c: Context<Env>, fallback: string) => {
  const ref = c.req.header('referer');
  if (ref) { try { const u = new URL(ref); if (u.host === c.req.header('host')) return u.pathname + u.search; } catch { /* ignore */ } }
  return fallback;
};

/** POST form action: validates via the service layer, flashes success/error, redirects (PRG). */
export function formAction(app: AppT, d: Deps, path: string, guard: MiddlewareHandler<Env>, handler: (ctx: Ctx, f: Form, c: Context<Env>) => Promise<ActionResult> | ActionResult, opts: { maxBytes?: number; fallback?: string } = {}): void {
  app.post(path, guard, bodyMw(opts.maxBytes ?? 64 * 1024), async (c) => {
    const f = (await c.req.parseBody()) as Form;
    try {
      const r = await handler(ctxOf(c, d), f, c);
      if (r && r.msg) flash(c, 'ok', r.msg);
      return c.redirect((r && r.to) || back(c, opts.fallback ?? '/'), 303);
    } catch (e) {
      if (e instanceof AppError && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 429) { flash(c, 'err', e.message); return c.redirect(back(c, opts.fallback ?? '/'), 303); }
      throw e;
    }
  });
}
