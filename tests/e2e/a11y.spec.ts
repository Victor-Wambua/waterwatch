import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { ctxFor } from './helpers.ts';
import type { RoleKey } from './auth.ts';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const SCREENS: Record<string, string[]> = {
  reporter: ['/report', '/report/mine', '/notifications', '/account'],
  tech1: ['/tech', '/notifications'],
  dispatcher: ['/console/map', '/console/map?asset=', '/console/assets', '/console/assets/new', '/console/reports', '/console/orders', '/console/schedule', '/console/sensors', '/console/analytics', '/console/assets/@first', '/console/orders/@first', '/notifications', '/account'],
  admin: ['/console/audit', '/console/admin/users', '/console/admin/devices', '/console/admin/settings', '/console/assets/import'],
  auditor: ['/console/audit', '/console/orders', '/console/analytics'],
  ngo: ['/console/map', '/console/analytics'],
  platform: ['/platform']
};
const VIEWPORTS = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } } as const;

type V = { id: string; impact: string; nodes: number; target: string };
test.describe('axe-core sweep (serious and critical must be zero)', () => {
  test.setTimeout(600000);
  test('every screen, role, viewport and theme', async ({ browser }) => {
    const found: Record<string, V[]> = {};
    let screens = 0;
    for (const [role, paths] of Object.entries(SCREENS)) for (const [vn, viewport] of Object.entries(VIEWPORTS)) for (const theme of ['light', 'dark'] as const) {
      const ctx = await ctxFor(browser, role as RoleKey, { viewport, colorScheme: theme, hasTouch: vn === 'mobile', bypassCSP: true });
      const p = await ctx.newPage();
      for (let path of paths) {
        if (path.includes('@first')) {
          const base = path.replace('/@first', '');
          await p.goto(base);
          path = (await p.locator(`main a[href^="${base}/"]`).first().getAttribute('href')) as string;
        }
        await p.goto(path);
        await p.addScriptTag({ content: axeSource });
        const res = await p.evaluate(async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0].target.join(' ') }));
        });
        screens++;
        const bad = (res as V[]).filter((v) => v.impact === 'serious' || v.impact === 'critical');
        if (bad.length) found[`${role} ${vn} ${theme} ${path}`] = bad;
      }
      await ctx.close();
    }
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/axe-summary.json', JSON.stringify({ screens, found }, null, 1));
    const total = Object.values(found).reduce((n, v) => n + v.reduce((m, x) => m + x.nodes, 0), 0);
    console.log(`axe: ${screens} screen renders, ${Object.keys(found).length} with serious/critical, ${total} nodes`);
    expect(found).toEqual({});
  });
});
