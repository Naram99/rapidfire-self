import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

if (existsSync('.env')) process.loadEnvFile('.env');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const production = process.env.E2E_PRODUCTION === '1';
const port = production
  ? process.env.PORT || 3000
  : process.env.WEB_PORT || 5173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  projects: [
    { name: 'environment' },
    // These flows start the real backend and DB, so their source is checked by
    // the server's existing TypeScript project, including its dependency boundary.
    { name: 'frontend', testDir: './apps/server/test/browser' },
  ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: production ? 'npm start' : 'npm run dev',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI && !production,
    timeout: 30000,
    env: { BETTER_AUTH_URL: baseURL, GAME_ALLOWED_ORIGINS: baseURL },
  },
});
