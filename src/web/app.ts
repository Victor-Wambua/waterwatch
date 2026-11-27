import { Hono } from 'hono';
import { AppError } from '../core/errors.ts';
import { RateLimiter } from '../core/ratelimit.ts';
import { apiRoutes } from './routes-api.ts';
import { authRoutes } from './routes-auth.ts';
import { consoleRoutes } from './routes-console.ts';
import { fieldRoutes } from './routes-field.ts';
import { opsRoutes } from './routes-ops.ts';
import { csrfGuard, errorPage, globalRateLimit, isApiPath, securityHeaders, sessionLoader, staticHandler, type Deps, type Env } from './http.ts';
import { homeFor } from './shell.ts';
import type { Runtime } from '../repo/ctx.ts';

export function createApp(rt: Runtime, publicDir = 'public'): Hono<Env> {
  const d: Deps = { rt, limiter: new RateLimiter(rt.clock, rt.cfg.rateLimitDisabled) };
  const app = new Hono<Env>();
  app.use('*', securityHeaders(d));
  const stat = staticHandler(publicDir);
  for (const p of ['/css/*', '/js/*', '/vendor/*', '/logo.svg', '/sw.js', '/manifest.webmanifest']) app.get(p, stat);
  app.use('*', globalRateLimit(d));
  app.use('*', sessionLoader(d));
  app.use('*', csrfGuard(d));

  app.get('/', (c) => { const a = c.get('auth'); return c.redirect(a && !a.mfaPending ? homeFor(a.actor.role) : '/login', 303); });
  authRoutes(app, d);
  apiRoutes(app, d);
  consoleRoutes(app, d);
  opsRoutes(app, d);
  fieldRoutes(app, d);

  app.notFound((c) => (isApiPath(c.req.path) ? c.json({ error: 'not_found', message: 'Not found' }, 404) : c.html(errorPage(404, 'That page does not exist.'), 404)));
  app.onError((err, c) => {
    const api = isApiPath(c.req.path);
    if (err instanceof AppError) {
      if (err.status === 429 || err.status === 401) { /* headers set by caller */ }
      return api ? c.json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }, err.status as 400) : c.html(errorPage(err.status, err.message), err.status as 400);
    }
    const status = (err as { status?: number }).status;
    if (status === 413 || status === 400) return api ? c.json({ error: 'bad_request', message: 'Bad request' }, status) : c.html(errorPage(status, 'The request could not be processed.'), status);
    if (err instanceof SyntaxError) return api ? c.json({ error: 'invalid_json', message: 'Body is not valid JSON.' }, 400) : c.html(errorPage(400, 'The request could not be processed.'), 400);
    console.error('unhandled error', err instanceof Error ? err.message : String(err));
    return api ? c.json({ error: 'internal', message: 'Internal error' }, 500) : c.html(errorPage(500, 'An unexpected error occurred. It has been logged.'), 500);
  });
  return app;
}
