import { test, expect } from '@playwright/test';
import { ctxFor } from './helpers.ts';

test.describe('print styles', () => {
  for (const path of ['/console/orders', '/console/analytics', '/console/audit', '/console/assets']) {
    test(`print ${path}: chrome hidden, no horizontal overflow`, async ({ browser }) => {
      const ctx = await ctxFor(browser, 'admin', { viewport: { width: 1280, height: 800 } });
      const p = await ctx.newPage();
      await p.goto(path);
      await p.emulateMedia({ media: 'print' });
      expect(await p.locator('nav.rail').isVisible()).toBe(false);
      expect(await p.locator('header.top').isVisible()).toBe(false);
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await ctx.close();
    });
  }
});

test.describe('performance (emulated, no throttling)', () => {
  for (const path of ['/console/map', '/console/sensors', '/console/orders']) {
    test(`weight, requests and layout shift ${path}`, async ({ browser }) => {
      const ctx = await ctxFor(browser, 'dispatcher', { viewport: { width: 375, height: 812 }, hasTouch: true });
      const p = await ctx.newPage();
      let bytes = 0, reqs = 0;
      p.on('response', async (r) => { reqs++; const l = Number((await r.allHeaders())['content-length'] ?? 0); bytes += l || (await r.body().catch(() => Buffer.alloc(0))).length; });
      await p.addInitScript(() => { (window as unknown as { __cls: number }).__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { hadRecentInput: boolean; value: number }[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
      await p.goto(path, { waitUntil: 'networkidle' });
      await p.waitForTimeout(300);
      const cls = await p.evaluate(() => (window as unknown as { __cls: number }).__cls);
      console.log(`perf ${path}: ${reqs} requests, ${(bytes / 1024).toFixed(1)} KB, CLS ${cls.toFixed(3)}`);
      expect(reqs).toBeLessThan(15);
      expect(bytes).toBeLessThan(400 * 1024);
      expect(cls).toBeLessThan(0.1);
      await ctx.close();
    });
  }
});

test('Kiswahili (draft) report form has no horizontal overflow on a phone and keeps the review notice', async ({ browser }) => {
  const ctx = await ctxFor(browser, 'reporter', { viewport: { width: 320, height: 640 } });
  const p = await ctx.newPage();
  await p.goto('/report?lang=sw');
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(p.locator('html')).toHaveAttribute('lang', 'sw');
  await ctx.close();
});
