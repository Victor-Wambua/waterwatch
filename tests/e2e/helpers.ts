import { type Browser, type BrowserContext } from '@playwright/test';
import sharp from 'sharp';
import { authFile, type RoleKey } from './auth.ts';

export const ctxFor = (browser: Browser, role: RoleKey, opts: Record<string, unknown> = {}): Promise<BrowserContext> =>
  browser.newContext({ storageState: authFile(role), baseURL: 'http://127.0.0.1:4401', ...opts });
export const photo = (name: string) => sharp({ create: { width: 800, height: 600, channels: 3, background: '#2a8' } }).jpeg().toBuffer().then((buffer) => ({ name, mimeType: 'image/jpeg', buffer }));
