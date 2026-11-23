import { expect, type LaunchOptions, test } from '../support/extension';
import { EXTENSION_ID } from '../support/host';
import type { Popup } from '../support/popup';
import { LOCAL } from '../support/views';

/**
 * The popup paints its header within 100 ms of its navigation start, whatever
 * the host and the service worker do. That is the target the slow-popup fix set.
 *
 * The measure is the browser's own first contentful paint of the popup page, so
 * it covers loading, rendering and painting, and nothing the test does. The test
 * opens the popup once before it measures. The first popup of a browser session
 * pays a one-time setup in the browser, about 120 ms on a fast machine, that no
 * extension code runs in. Later opens paint in about 25 to 40 ms, which leaves a
 * slow CI runner more than twice the room. The popup that waited for the service
 * worker before this fix painted after 2.6 s with a busy worker, so the bound
 * still catches that regression by a wide margin.
 */
const BOUND_MS = 100;

/** The popup's first contentful paint, noted in the report so slow runners show their margin. */
async function paint(popup: Popup): Promise<number> {
  const ms = await popup.firstContentfulPaint();
  const description = `${Math.round(ms)} ms`;
  test.info().annotations.push({ type: 'first contentful paint', description });
  // The list reporter prints this, so a CI log shows how close a runner comes to the bound.
  console.log(`first contentful paint: ${description}`);
  return ms;
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
    await (await lab.popup(page)).close();

    const popup = await lab.popup(page);
    expect(await paint(popup)).toBeLessThan(BOUND_MS);
    await popup.waitForText(settles);
  });
}

test(`the popup paints within ${BOUND_MS} ms while the service worker is busy`, async ({
  launch
}) => {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  const page = await lab.open('https://app.acme.localhost/');
  await (await lab.popup(page)).close();
  // An extension page opens the popup, since the worker can't while it is busy.
  const opener = await lab.open(`chrome-extension://${EXTENSION_ID}/manifest.json`);

  // Keeps the worker's event loop busy for 3 s, as a slow worker start would.
  lab.worker
    .evaluate(() => {
      const end = Date.now() + 3000;
      while (Date.now() < end) {
        // Spinning is the point.
      }
    })
    .catch(() => undefined);
  const popup = await lab.popup(page, opener);
  expect(await paint(popup)).toBeLessThan(BOUND_MS);
  // The lanes come from the snapshot the worker saved, before the worker can answer.
  await popup.waitForText('acme@1');
});
