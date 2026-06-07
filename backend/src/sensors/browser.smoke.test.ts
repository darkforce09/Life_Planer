import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';

/**
 * Playwright smoke test for the headless-browser sensors (Canvas/Ladok login).
 *
 * Browser launches need system deps + downloaded browsers and network, so this
 * is OFF by default to keep CI deterministic. Enable locally with:
 *   RUN_BROWSER_SMOKE=1 npm test
 * and, for the real Ladok login flow, also set LADOK_TEST_USERNAME / _PASSWORD.
 */
const runBrowser = process.env.RUN_BROWSER_SMOKE === '1';

describe.skipIf(!runBrowser)('Browser sensor smoke', () => {
  it('can launch a headless Chromium and render a page', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<h1 id="t">Login</h1>');
      const text = await page.locator('#t').innerText();
      expect(text).toBe('Login');
    } finally {
      await browser.close();
    }
  }, 60_000);

  const runLadok = !!process.env.LADOK_TEST_USERNAME && !!process.env.LADOK_TEST_PASSWORD;
  it.skipIf(!runLadok)('reaches the Ladok/Miun IdP login form', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto('https://www.start.ladok.se/gui/', { waitUntil: 'domcontentloaded' });
      // The federated login page should expose a username/email field.
      const hasLogin = (await page.locator('input[type="text"], input[type="email"]').count()) > 0;
      expect(hasLogin).toBe(true);
    } finally {
      await browser.close();
    }
  }, 90_000);
});
