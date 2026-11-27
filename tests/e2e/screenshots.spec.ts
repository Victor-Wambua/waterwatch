import { test } from '@playwright/test';
import { ctxFor } from './helpers.ts';

const SHOTS: [string, string, string, 'desktop' | 'mobile'][] = [
  ['map', 'dispatcher', '/console/map?asset=', 'desktop'], ['map', 'dispatcher', '/console/map', 'mobile'],
  ['reports', 'dispatcher', '/console/reports', 'desktop'], ['reports', 'dispatcher', '/console/reports', 'mobile'],
  ['orders', 'dispatcher', '/console/orders', 'desktop'], ['orders', 'dispatcher', '/console/orders', 'mobile'],
  ['sensors', 'dispatcher', '/console/sensors', 'desktop'], ['sensors', 'dispatcher', '/console/sensors', 'mobile'],
  ['analytics', 'dispatcher', '/console/analytics', 'desktop'], ['analytics', 'dispatcher', '/console/analytics', 'mobile'],
  ['audit', 'admin', '/console/audit', 'desktop'], ['schedule', 'dispatcher', '/console/schedule', 'desktop'], ['devices', 'admin', '/console/admin/devices', 'desktop'],
  ['report', 'reporter', '/report', 'mobile'], ['tech', 'tech2', '/tech', 'mobile']
];
for (const theme of ['light', 'dark'] as const) for (const [name, role, path, vp] of SHOTS) {
  test(`screenshot ${name} ${vp} ${theme}`, async ({ browser }) => {
    const ctx = await ctxFor(browser, role as 'dispatcher', { viewport: vp === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 }, hasTouch: vp === 'mobile', colorScheme: theme });
    const p = await ctx.newPage(); await p.goto(path);
    if (name === 'tech') { await p.locator('a.job').first().click(); }
    await p.screenshot({ path: `docs/screenshots/app-${name}${name === 'tech' ? '-job' : ''}-${vp}-${theme}.png`, fullPage: true });
    await ctx.close();
  });
}
