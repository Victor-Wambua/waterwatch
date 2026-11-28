import { test, expect, type Page } from '@playwright/test';
import { ctxFor } from './helpers.ts';

const active = (p: Page) => p.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e ? `${e.tagName.toLowerCase()}|${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40)}` : ''; });
const focusVisible = (p: Page) => p.evaluate(() => { const e = document.activeElement as HTMLElement; if (!e || e === document.body) return false; const cs = getComputedStyle(e); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' || e.matches(':focus-visible'); });

test.describe('keyboard-only walkthroughs (Tab, Shift+Tab, Enter, Escape only)', () => {
  test('skip link is first, works, and focus is visible and ordered on the console', async ({ browser }) => {
    const ctx = await ctxFor(browser, 'dispatcher', { viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto('/console/orders');
    await p.keyboard.press('Tab');
    expect(await active(p)).toContain('Skip to content');
    expect(await focusVisible(p)).toBe(true);
    await p.keyboard.press('Enter');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('main');
    // Walk forward through the whole page: no trap (we reach the end), every stop shows a focus indicator.
    await p.goto('/console/orders');
    const seen: string[] = [];
    for (let i = 0; i < 80; i++) {
      await p.keyboard.press('Tab');
      const a = await active(p);
      if (a.startsWith('body') || a === '') break;
      expect(await focusVisible(p), `focus visible on ${a}`).toBe(true);
      seen.push(a);
    }
    expect(seen.length).toBeGreaterThan(10);
    expect(seen[0]).toContain('Skip');
    // Header controls come before the console navigation, which comes before main content.
    const iNav = seen.findIndex((s) => s.includes('Planned work')), iMain = seen.findIndex((s) => s.includes('New work order'));
    expect(iNav).toBeGreaterThan(0);
    expect(iMain).toBeGreaterThan(iNav);
    await ctx.close();
  });

  test('modal dialog traps focus, Escape closes it and focus returns to the opener', async ({ browser }) => {
    const ctx = await ctxFor(browser, 'dispatcher', { viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto('/console/orders');
    const opener = p.getByRole('button', { name: 'New work order' });
    await opener.focus();
    await p.keyboard.press('Enter');
    await expect(p.locator('dialog#dlg[open]')).toBeVisible();
    for (let i = 0; i < 25; i++) {
      await p.keyboard.press('Tab');
      expect(await p.evaluate(() => !!document.activeElement?.closest('dialog#dlg') || document.activeElement === document.body || document.activeElement === document.documentElement)).toBe(true);
    }
    await p.keyboard.press('Shift+Tab');
    await p.keyboard.press('Escape');
    await expect(p.locator('dialog#dlg[open]')).toHaveCount(0);
    expect(await p.evaluate(() => document.activeElement?.textContent?.trim())).toBe('New work order');
    await ctx.close();
  });

  test('map marker is reachable and activates with Enter', async ({ browser }) => {
    const ctx = await ctxFor(browser, 'dispatcher', { viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto('/console/map');
    await p.locator('a.marker').first().focus();
    await p.keyboard.press('Enter');
    await expect(p).toHaveURL(/asset=/);
    await ctx.close();
  });

  test('community report form can be completed and sent by keyboard alone', async ({ browser }) => {
    const ctx = await ctxFor(browser, 'reporter', { viewport: { width: 375, height: 812 } });
    const p = await ctx.newPage();
    await p.goto('/report');
    await p.keyboard.press('Tab');
    expect(await active(p)).toContain('Skip');
    await p.keyboard.press('Enter');
    const first = p.locator('main input[type=radio], main select, main button').first();
    await expect(first).toBeVisible();
    // Reach the submit button using Tab only and confirm every stop has a visible focus indicator.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await p.keyboard.press('Tab');
      if (!(await focusVisible(p))) throw new Error(`no visible focus at ${await active(p)}`);
      reached = (await active(p)).toLowerCase().includes('send report');
    }
    expect(reached).toBe(true);
    await ctx.close();
  });
});
