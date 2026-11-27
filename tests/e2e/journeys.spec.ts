import { expect, test } from '@playwright/test';
import { ctxFor, photo } from './helpers.ts';
import { signRequest } from '../../src/repo/ingest.ts';

const BASE = 'http://127.0.0.1:4401';
const mttrCount = async (page: import('@playwright/test').Page) => {
  await page.goto('/console/analytics');
  const t = await page.locator('.kpi', { hasText: 'Mean time to repair' }).innerText();
  return Number(t.match(/\((\d+) repairs\)/)?.[1]);
};

test('J1+J2+J3: community report (online) -> dispatcher work order -> technician completes with photo -> dispatcher confirms -> analytics reflect', async ({ browser }) => {
  const rep = await ctxFor(browser, 'reporter'); const rp = await rep.newPage();
  const disp = await ctxFor(browser, 'dispatcher'); const dp = await disp.newPage();
  const before = await mttrCount(dp);

  await rp.goto('/report');
  await rp.getByText('Pump not working').click();
  await rp.selectOption('#asset_id', { label: 'Kisima Borehole (Borehole)' });
  await rp.fill('#text', 'E2E: pump silent at Kisima');
  await rp.setInputFiles('#photo', await photo('r.jpg'));
  await rp.getByRole('button', { name: 'Send report' }).click();
  await expect(rp.locator('#done-title')).toHaveText('Thank you. Your report was sent.');
  const ref = (await rp.locator('#done-ref').innerText()).replace('Ref ', '');
  expect(ref).toMatch(/^R-\d+$/);

  await dp.goto('/console/reports');
  const card = dp.locator('article.report', { hasText: 'E2E: pump silent at Kisima' });
  await expect(card).toBeVisible();
  await expect(card.locator('img.photoimg')).toBeVisible();
  await card.getByRole('button', { name: 'Create work order' }).click();
  await dp.locator('#dlg select[name=assignee]').selectOption({ label: 'Peter Otieno (synthetic)' });
  await dp.locator('#dlg').getByRole('button', { name: 'Create work order' }).click();
  await expect(dp).toHaveURL(/\/console\/orders\//);
  const woUrl = dp.url();
  await expect(dp.locator('h1')).toContainText('WO-');

  const tech = await ctxFor(browser, 'tech1', { viewport: { width: 390, height: 844 }, hasTouch: true }); const tp = await tech.newPage();
  await tp.goto('/tech');
  await tp.getByRole('link', { name: /E2E|Fault report/ }).first().click();
  await tp.getByRole('button', { name: 'Start work' }).click();
  await tp.fill('#mn', 'Contactor'); await tp.fill('#mu', '1850.50'); await tp.getByRole('button', { name: 'Add' }).click();
  await expect(tp.getByText('Total KES 1,850.5')).toBeVisible();
  await tp.getByRole('button', { name: 'Mark complete' }).click(); // no photo: browser blocks (required) -> still in progress
  await expect(tp.getByRole('heading', { name: 'Complete the job' })).toBeVisible();
  await tp.setInputFiles('#cp', await photo('done.jpg')); await tp.fill('#cn', 'Replaced contactor');
  await tp.getByRole('button', { name: 'Mark complete' }).click();
  await expect(tp).toHaveURL(/\/tech$/);

  await dp.goto(woUrl);
  await expect(dp.locator('.chip', { hasText: 'Completed' }).first()).toBeVisible();
  await expect(dp.locator('img[alt^="Completion photo"]')).toBeVisible();
  await dp.getByRole('button', { name: 'Confirm completed' }).click();
  await expect(dp.locator('.chip', { hasText: 'Closed' }).first()).toBeVisible();

  expect(await mttrCount(dp)).toBe(before + 1);
  await dp.goto('/console/assets');
  await dp.getByRole('link', { name: 'Kisima Borehole' }).click();
  await expect(dp.getByText('Replaced contactor')).toBeVisible();
  await rep.close(); await disp.close(); await tech.close();
});

test('J1b: offline report is queued by the real service worker flow and syncs idempotently when back online', async ({ browser }) => {
  const ctx = await ctxFor(browser, 'reporter2', { viewport: { width: 390, height: 844 }, hasTouch: true }); const p = await ctx.newPage();
  await p.goto('/report');
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.reload(); // now controlled by the worker
  await ctx.setOffline(true);
  await p.reload(); // served from the service-worker cache while offline
  await expect(p.getByRole('heading', { name: '1. What is the problem?' })).toBeVisible();
  await p.getByText('Leak / burst pipe').click();
  await p.selectOption('#asset_id', { label: 'Eastgate Valve V-31 (Valve / distribution node)' });
  await p.fill('#text', 'E2E offline leak report');
  await p.getByRole('button', { name: 'Send report' }).click();
  await expect(p.locator('#done-title')).toContainText('Saved on this phone');
  await expect(p.locator('#queue-count')).toHaveText('1');
  await expect(p.locator('#net-bar')).toContainText('offline');
  await ctx.setOffline(false);
  await expect(p.locator('#queue-count')).toHaveText('0', { timeout: 15000 });

  const disp = await ctxFor(browser, 'dispatcher'); const dp = await disp.newPage();
  await dp.goto('/console/reports?status=all');
  await expect(dp.locator('article.report', { hasText: 'E2E offline leak report' })).toHaveCount(1);
  // a second flush must not duplicate (idempotent client id)
  await p.reload(); await p.waitForTimeout(500);
  await dp.reload();
  await expect(dp.locator('article.report', { hasText: 'E2E offline leak report' })).toHaveCount(1);
  await ctx.close(); await disp.close();
});

test('J5: a sensor that stops reporting raises a health alert and a work-order suggestion', async ({ browser }) => {
  test.setTimeout(90000);
  const admin = await ctxFor(browser, 'admin'); const ap = await admin.newPage();
  await ap.goto('/console/admin/devices');
  await ap.fill('#dn', 'E2E meter'); await ap.selectOption('#da', { label: 'Soko Kiosk (A-004)' }); await ap.selectOption('#do', 'simulated');
  await ap.fill('#sk', 'flow'); await ap.fill('#si', '10');
  await ap.getByRole('button', { name: 'Register device' }).click();
  const texts = await ap.locator('.secret').allInnerTexts();
  const [deviceKey, secret] = texts as [string, string];
  expect(deviceKey).toMatch(/^dev_/);
  const send = async (value: number, nonce: string) => {
    const now = Date.now(); const body = JSON.stringify({ origin: 'simulated', readings: [{ sensor: 'flow', ts: now, value }] });
    const ts = String(Math.floor(now / 1000));
    const r = await fetch(`${BASE}/ingest/v1/readings`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-ww-device': deviceKey, 'x-ww-timestamp': ts, 'x-ww-nonce': nonce, 'x-ww-signature': signRequest(secret, deviceKey, ts, nonce, body) } });
    return r.status;
  };
  expect(await send(12.5, 'e2e-nonce-000001')).toBe(200);
  expect(await send(12.5, 'e2e-nonce-000001')).toBe(409); // replay refused
  await ap.goto('/console/sensors');
  await ap.getByRole('button', { name: 'Run health check now' }).click();
  await expect(ap.locator('tr', { hasText: 'E2E meter' }).getByText('Reporting')).toBeVisible();
  await ap.waitForTimeout(23000); // > 2x the 10 s expected interval, no more readings
  await ap.getByRole('button', { name: 'Run health check now' }).click();
  await expect(ap.locator('tr', { hasText: 'E2E meter' }).getByText('Missing readings')).toBeVisible();
  await expect(ap.locator('li', { hasText: 'E2E meter / flow: Missing readings' }).first()).toBeVisible();
  await expect(ap.getByText('SIMULATED SENSOR — test environment').first()).toBeVisible();
  await expect(ap.getByRole('button', { name: /Create suggested work order/ }).first()).toBeVisible();
  // readings resume: alert resolves
  expect(await send(13, 'e2e-nonce-000002')).toBe(200);
  await ap.getByRole('button', { name: 'Run health check now' }).click();
  await expect(ap.locator('tr', { hasText: 'E2E meter' }).getByText('Reporting')).toBeVisible();
  await admin.close();
});

test('J6: contamination escalation shows safety guidance, a P1 banner for dispatchers and a forced-P1 work order', async ({ browser }) => {
  const rep = await ctxFor(browser, 'reporter', { viewport: { width: 390, height: 844 }, hasTouch: true }); const rp = await rep.newPage();
  await rp.goto('/report');
  await expect(rp.locator('#safety-panel')).toBeHidden();
  await rp.getByText('Water looks / smells unsafe').click();
  await expect(rp.locator('#safety-panel')).toBeVisible();
  await expect(rp.locator('#safety-panel')).toContainText('Do not drink');
  await rp.selectOption('#asset_id', { label: 'Njiwa Kiosk (Water kiosk)' });
  await rp.fill('#text', 'E2E brown water');
  await rp.getByRole('button', { name: 'Send report' }).click();
  await expect(rp.locator('#done-safety')).toContainText('not a lab test');
  const disp = await ctxFor(browser, 'dispatcher'); const dp = await disp.newPage();
  await dp.goto('/console/reports');
  await expect(dp.locator('.alertbar[role=alert]')).toContainText('contamination report');
  const card = dp.locator('article.report.contam', { hasText: 'E2E brown water' });
  await expect(card.getByText('High priority — contamination')).toBeVisible();
  await card.getByRole('button', { name: 'Create work order' }).click();
  await expect(dp.locator('#dlg .safety')).toContainText('water-quality officer');
  await dp.locator('#dlg').getByRole('button', { name: 'Create work order' }).click();
  await expect(dp.locator('.chip', { hasText: 'P1 urgent' }).first()).toBeVisible();
  await dp.goto('/console/map');
  await expect(dp.locator('.alertbar[role=alert]', { hasText: 'Contamination alert at Njiwa Kiosk' })).toBeVisible();
  await rep.close(); await disp.close();
});

test('mobile viewport: reporter, technician and console pages have no horizontal overflow and keep 44px touch targets', async ({ browser }) => {
  const checks: [string, string][] = [['reporter', '/report'], ['tech1', '/tech'], ['dispatcher', '/console/map'], ['dispatcher', '/console/orders'], ['dispatcher', '/console/reports'], ['dispatcher', '/console/sensors'], ['dispatcher', '/console/analytics']];
  for (const [role, path] of checks) {
    const ctx = await ctxFor(browser, role as 'reporter', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const p = await ctx.newPage();
    await p.goto(path);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${role} ${path}`).toBeLessThanOrEqual(1);
    if (path === '/report') {
      const h = await p.locator('.cat').first().boundingBox(); expect(h?.height).toBeGreaterThanOrEqual(44);
      const send = await p.locator('#send-btn').boundingBox(); expect(send?.height).toBeGreaterThanOrEqual(44);
    }
    if (path === '/console/map') await expect(p.locator('nav.mobtabs')).toBeVisible();
    await ctx.close();
  }
});

test('no console errors on primary pages', async ({ browser }) => {
  const ctx = await ctxFor(browser, 'dispatcher'); const p = await ctx.newPage(); const errs: string[] = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
  for (const u of ['/console/map', '/console/assets', '/console/reports', '/console/orders', '/console/schedule', '/console/sensors', '/console/analytics']) await p.goto(u);
  expect(errs).toEqual([]);
  await ctx.close();
});
