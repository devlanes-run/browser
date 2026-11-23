// Renders every preview case at the popup's size, in light and dark, with
// Playwright's Chromium. Run `pnpm screenshots` in packages/extension. The
// browser comes from `npx playwright install chromium`.

import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { CASES, MENU_CASES } from './cases';

const index = pathToFileURL(fileURLToPath(new URL('./dist/index.html', import.meta.url)));
const out = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark'] as const) {
    // Chrome sizes a popup to its content, so the shots take the full page from a short
    // viewport. Past 600 px Chrome scrolls, and the shot shows what scrolls.
    const page = await browser.newPage({
      viewport: { width: 380, height: 120 },
      deviceScaleFactor: 2,
      colorScheme,
      reducedMotion: 'reduce'
    });
    for (const preview of CASES) {
      const url = new URL(index);
      url.searchParams.set('case', preview.name);
      await page.goto(url.href);
      await page.locator('header.top').waitFor();
      for (const name of preview.clicks ?? []) {
        await page.getByRole('button', { name, exact: true }).click();
      }
      if (preview.clicks) {
        // The fake background answers a switch after 300 ms. Wait for the answer, or for
        // the settings a click opened, not for a fixed time.
        await page.locator('.flow:not([role="status"]), .settings').first().waitFor();
      }
      if (preview.focus) {
        // Tab first, so the browser draws the ring as it does for keyboard focus.
        await page.keyboard.press('Tab');
        await page.getByRole('button', { name: preview.focus }).focus();
      }
      const file = `${out}${preview.name}-${colorScheme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
    }
    await page.close();

    // The menu is as wide as its field, at least 240 px, and the content script sizes its height.
    const menuPage = await browser.newPage({
      viewport: { width: 300, height: 300 },
      deviceScaleFactor: 2,
      colorScheme,
      reducedMotion: 'reduce'
    });
    for (const preview of MENU_CASES) {
      const url = new URL('./dist/menu.html', import.meta.url);
      url.searchParams.set('menu', preview.name);
      await menuPage.goto(url.href);
      const file = `${out}menu-${preview.name}-${colorScheme}.png`;
      await menuPage.locator('.menu').screenshot({ path: file });
      console.log(file);
    }
    await menuPage.close();
  }
} finally {
  await browser.close();
}
