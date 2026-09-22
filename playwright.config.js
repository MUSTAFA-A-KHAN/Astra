import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  // Hosted CI has no GPU: every frame is rasterised on the CPU by SwiftShader,
  // so the same flows need far longer there than on a developer machine.
  timeout: process.env.CI ? 240000 : 90000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chromium',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'android', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
    { name: 'ipad', use: { ...devices['iPad Pro 11'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node tools/dev-server.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
