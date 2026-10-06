import { defineConfig } from '@playwright/test';

/** Full suite on 8 viewports as separate projects. Phones and tablets use touch emulation. */
const VIEWPORTS = [
  { name: 'phone-320x568', width: 320, height: 568, touch: true },
  { name: 'phone-375x667', width: 375, height: 667, touch: true },
  { name: 'phone-390x844', width: 390, height: 844, touch: true },
  { name: 'phone-412x915', width: 412, height: 915, touch: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, touch: true },
  { name: 'tablet-1024x768', width: 1024, height: 768, touch: true },
  { name: 'tablet-1024x1366', width: 1024, height: 1366, touch: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, touch: false },
];

const useFor = (v: (typeof VIEWPORTS)[number]) => ({
  browserName: 'chromium' as const,
  viewport: { width: v.width, height: v.height },
  hasTouch: v.touch,
  isMobile: v.touch,
  deviceScaleFactor: v.touch ? 2 : 1,
});

export default defineConfig({
  testDir: './e2e',
  outputDir: '../test-results/artifacts',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 4),
  retries: Number(process.env.E2E_RETRIES ?? 0),
  reporter: [
    ['list'],
    ['json', { outputFile: '../test-results/playwright-results.json' }],
    ['html', { open: 'never', outputFolder: '../test-results/playwright-report' }],
  ],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8090',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [
    // Everything except the row-number / drag-and-drop spec runs in parallel.
    ...VIEWPORTS.map((v) => ({
      name: v.name,
      testIgnore: /order\.spec\.ts/,
      use: useFor(v),
    })),
    // Row numbers depend on every project in a category, so order.spec.ts must not run while
    // other tests add or remove projects. These projects run after all the others, one
    // viewport at a time.
    ...VIEWPORTS.map((v, i) => ({
      name: `order-${v.name}`,
      testMatch: /order\.spec\.ts/,
      fullyParallel: false,
      dependencies: i === 0 ? VIEWPORTS.map((x) => x.name) : [`order-${VIEWPORTS[i - 1]!.name}`],
      use: useFor(v),
    })),
  ],
});
