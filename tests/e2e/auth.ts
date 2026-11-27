import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { totpCode } from '../../src/core/crypto.ts';
import { executablePath } from './browser.ts';

export const BASE = process.env.WW_BASE ?? 'http://127.0.0.1:4401';
export const PASSWORD = process.env.WW_SEED_PASSWORD ?? 'E2e-Passw0rd-only!';
export const USERS = {
  reporter: 'wanjiru@mtokijani.test', reporter2: 'otieno.r@mtokijani.test', tech1: 'peter@mtokijani.test', tech2: 'amina@mtokijani.test', dispatcher: 'dispatcher@mtokijani.test',
  admin: 'admin@mtokijani.test', auditor: 'auditor@mtokijani.test', ngo: 'ngo@mtokijani.test', admin2: 'admin@bahari.test', platform: 'platform@waterwatch.test'
} as const;
export type RoleKey = keyof typeof USERS;
export const authFile = (k: string) => `test-results/auth/${k}.json`;
const secretsFile = 'test-results/auth/totp.json';
const secrets = (): Record<string, string> => (existsSync(secretsFile) ? JSON.parse(readFileSync(secretsFile, 'utf8')) : {});

/** Signs in through the real login form (including real TOTP enrolment for MFA roles). */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  if (page.url().includes('/login/mfa')) {
    const s = secrets();
    let secret = s[email];
    if (!secret) { secret = (await page.locator('#totp-secret').innerText()).trim(); s[email] = secret; writeFileSync(secretsFile, JSON.stringify(s)); }
    await page.fill('#code', totpCode(secret, Date.now()));
    await page.click('button[type=submit]');
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export async function saveAuth(browser: Browser, key: RoleKey): Promise<void> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, USERS[key]);
  await ctx.storageState({ path: authFile(key) });
  await ctx.close();
}
export async function setupAll(keys: RoleKey[]): Promise<void> {
  mkdirSync('test-results/auth', { recursive: true });
  const browser = await chromium.launch({ executablePath });
  for (const k of keys) await saveAuth(browser, k);
  await browser.close();
}
