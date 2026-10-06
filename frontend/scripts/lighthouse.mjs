// Lighthouse mobile run against the running stack. Fails when Accessibility < 95 or Performance < 85.
import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:8090';
const pages = [
  { name: 'dashboard', path: '/' },
  { name: 'dashboard-filtered', path: '/?tab=current&status=overdue' },
  { name: 'import', path: '/import' },
];
const MIN = { accessibility: 95, performance: 85 };
const out = new URL('../../test-results/lighthouse/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});
let failed = false;
const rows = [];
try {
  for (const p of pages) {
    const result = await lighthouse(
      `${base}${p.path}`,
      {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices'],
      },
      // default config = mobile emulation + simulated slow 4G / 4x CPU throttling
    );
    const lhr = result.lhr;
    const score = (id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
    const row = {
      page: p.name,
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      lcp: lhr.audits['largest-contentful-paint']?.displayValue,
      tbt: lhr.audits['total-blocking-time']?.displayValue,
      cls: lhr.audits['cumulative-layout-shift']?.displayValue,
      formFactor: lhr.configSettings.formFactor,
    };
    rows.push(row);
    writeFileSync(`${out}${p.name}.json`, JSON.stringify(lhr, null, 2));
    if (row.performance < MIN.performance || row.accessibility < MIN.accessibility) failed = true;
  }
} finally {
  await chrome.kill();
}
console.table(rows);
writeFileSync(`${out}summary.json`, JSON.stringify(rows, null, 2));
if (failed) {
  console.error(
    `FAILED: need Accessibility >= ${MIN.accessibility} and Performance >= ${MIN.performance}`,
  );
  process.exit(1);
}
console.log(
  `PASSED: Accessibility >= ${MIN.accessibility}, Performance >= ${MIN.performance} on every page (mobile).`,
);
