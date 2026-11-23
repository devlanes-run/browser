import type { Page } from '@playwright/test';
import { expect, type Lab, type LaunchOptions, test } from '../support/extension';
import { EXTENSION_ID } from '../support/host';
import type { ExtensionScope, Popup } from '../support/popup';
import { LOCAL } from '../support/views';

/**
 * The popup paints its header within 100 ms of its navigation start, whatever
 * the host and the service worker do. The slow-popup fix set that target.
 *
 * The measure is the browser's own first contentful paint of the popup page, so
 * it covers loading, rendering and painting, and nothing the test does. The first
 * popup of a browser session pays a one-time setup in the browser, about 120 ms
 * on a fast machine, that no extension code runs in, so it isn't measured. Later
 * opens paint in about 25 to 50 ms. Now and then one takes about 100 ms, when
 * the machine is busy with something else, so a test takes the fastest of
 * {@link SAMPLES} opens. A popup that waits for the service worker is slow on
 * every open: before the fix it painted after 2.6 s with a busy worker, so the
 * bound still catches that regression by a wide margin.
 */
const BOUND_MS = 100;

/** How many popups a test opens and measures after the first. */
const SAMPLES = 3;

/**
 * How long the busy-worker test keeps the worker spinning. Opening, measuring
 * and closing {@link SAMPLES} popups takes about two seconds, so a slow runner
 * still measures inside it.
 */
const BUSY_MS = 8000;

/**
 * Opens the popup over `page` once, then {@link SAMPLES} more times, and gives
 * the fastest first contentful paint with the last popup, still open. Every
 * sample goes into the report, so a CI log shows how close a runner comes to
 * the bound.
 */
async function fastestPaint(
  lab: Lab,
  page: Page,
  opener?: ExtensionScope
): Promise<{ ms: number; popup: Popup }> {
  await (await lab.popup(page, opener)).close();
  const samples: number[] = [];
  let popup: Popup | undefined;
  for (let sample = 0; sample < SAMPLES; sample++) {
    await popup?.close();
    popup = await lab.popup(page, opener);
    samples.push(Math.round(await popup.firstContentfulPaint()));
  }
  const description = samples.map((ms) => `${ms} ms`).join(', ');
  test.info().annotations.push({ type: 'first contentful paints', description });
  console.log(`first contentful paints: ${description}`);
  return { ms: Math.min(...samples), popup: popup as Popup };
}

const CASES: { name: string; options: LaunchOptions; settles: string }[] = [
  { name: 'no host', options: { installed: false }, settles: 'devlanes setup' },
  {
    name: 'a host that never answers',
    options: { scenario: { hello: 'silent' } },
    settles: 'Connecting'
  },
  { name: 'a working host', options: { scenario: { view: LOCAL } }, settles: 'acme@1' }
];

for (const { name, options, settles } of CASES) {
  test(`the popup paints within ${BOUND_MS} ms with ${name}`, async ({ launch }) => {
    const lab = await launch(options);
    const page = await lab.open('https://app.acme.localhost/');
    const { ms, popup } = await fastestPaint(lab, page);
    expect(ms).toBeLessThan(BOUND_MS);
    await popup.waitForText(settles);
  });
}

test(`the popup paints within ${BOUND_MS} ms while the service worker is busy`, async ({
  launch
}) => {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  const page = await lab.open('https://app.acme.localhost/');
  // An extension page opens the popup, since the worker can't while it is busy.
  const opener = await lab.open(`chrome-extension://${EXTENSION_ID}/manifest.json`);

  // A slow worker start blocks the event loop like this. The worker says when it
  // stops, before it starts, so the test knows the popup opened while it was busy.
  lab.worker
    .evaluate((ms) => {
      const end = Date.now() + ms;
      chrome.storage.session.set({ 'e2e:busy-until': end });
      while (Date.now() < end) {
        // Spinning is the point.
      }
    }, BUSY_MS)
    .catch(() => undefined);
  let busyUntil = 0;
  await expect
    .poll(
      async () => {
        busyUntil = await opener.evaluate(
          async () =>
            ((await chrome.storage.session.get('e2e:busy-until'))['e2e:busy-until'] as number) ?? 0
        );
        return busyUntil;
      },
      { message: 'the worker starts to spin' }
    )
    .toBeGreaterThan(0);
  const { ms, popup } = await fastestPaint(lab, page, opener);
  expect(ms).toBeLessThan(BOUND_MS);
  expect(Date.now(), 'the worker was still busy when the popup painted').toBeLessThan(busyUntil);
  // The lanes come from the snapshot the worker saved, before the worker can answer.
  await popup.waitForText('acme@1');
});
