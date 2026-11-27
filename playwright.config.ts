import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: 'http://127.0.0.1:4401', trace: 'off', actionTimeout: 10000 },
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: 'node src/server.ts',
    url: 'http://127.0.0.1:4401/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: '4401', WW_ENV: 'test', WW_DB_PATH: 'data/e2e.sqlite', WW_DATA_DIR: 'data/e2e-files',
      WW_SECRET_KEY: 'e2e-only-secret-key-not-for-production-0123456789', WW_SEED_ON_START: '1',
      WW_SEED_PASSWORD: 'E2e-Passw0rd-only!', WW_HEALTH_INTERVAL_MS: '0', WW_RATE_LIMIT_DISABLED: '0'
    }
  }
});
