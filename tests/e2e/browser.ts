import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Locally the pinned Playwright browser revision may not be installed (offline machine). If a cached Chrome for Testing exists,
 * use it; otherwise (CI after `npx playwright install chromium`) Playwright's own default is used.
 */
const cached = join(homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
export const executablePath: string | undefined = process.env.WW_CHROMIUM || (existsSync(cached) ? cached : undefined);
