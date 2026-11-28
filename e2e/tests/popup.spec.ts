import { contentWorld } from '../support/content-world';
import { expect, type Lab, test } from '../support/extension';
import { BOXES, LOCAL, WILDCARD } from '../support/views';

/**
 * Every lane tab with its URL and index, in tab order, as the browser has it.
 * A tab still loading counts with the URL it goes to. The tests read this
 * instead of waiting for the page to load, because on a machine where devlanes
 * listens on 127.0.0.1:443, a tab the extension opens can reach the devlanes
 * proxy before the test's route applies to it.
 */
async function laneTabs(lab: Lab): Promise<{ url: string; index: number }[]> {
  const tabs = await lab.worker.evaluate(async () =>
    (await chrome.tabs.query({})).map((tab) => ({
      url: tab.pendingUrl ?? tab.url ?? '',
      index: tab.index
    }))
  );
  return tabs.filter((tab) => /^https:\/\/([a-z0-9-]+\.)*localhost\//.test(tab.url));
}

/** The URLs of {@link laneTabs}, in tab order. */
async function laneUrls(lab: Lab): Promise<string[]> {
  return (await laneTabs(lab)).map((tab) => tab.url);
}

/** The badge colours from the devlanes palette: paint for this machine, the info blue for a box. */
const PAINT = [245, 197, 66, 255];
const INFO_BLUE = [47, 95, 143, 255];

test('the popup lists lanes with their routes and highlights the current tab', async ({
  launch
}) => {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  const page = await lab.open('https://app.acme1.localhost/orders');
  const popup = await lab.popup(page);

  await popup.waitFor(
    () => document.querySelector('.lane.here > .hd .ref')?.textContent === 'acme@1',
    undefined,
    'acme@1 as the current tab'
  );
  expect(await popup.texts('.lane > .hd .ref')).toEqual(['acme@0', 'acme@1', 'shop@0']);
  expect(await popup.texts('.routes a')).toEqual([
    'app.acme.localhost',
    'api.acme.localhost',
    'app.acme1.localhost',
    'api.acme1.localhost',
    'shop.localhost'
  ]);
  expect(await popup.texts('.lane.here .routes a')).toEqual([
    'app.acme1.localhost',
    'api.acme1.localhost'
  ]);
});

test('the badge shows the lane number, with a dot and in blue when a box serves the lane', async ({
  launch
}) => {
  const local = await launch({ scenario: { view: LOCAL } });
  await local.connected();
  const onLocal = await local.open('https://app.acme1.localhost/');
  await expect.poll(() => local.badge(onLocal)).toEqual({ text: '1', color: PAINT });
  await local.context.close();

  const boxed = await launch({ scenario: { view: BOXES } });
  await boxed.connected();
  const onBox = await boxed.open('https://app.acme.localhost/');
  await expect.poll(() => boxed.badge(onBox)).toEqual({ text: '0\u2022', color: INFO_BLUE });
});

test('"Open this page in" opens the same page on the other lane, next to the current tab', async ({
  launch
}) => {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  const page = await lab.open('https://app.acme.localhost/orders/7?tab=items#total');
  const popup = await lab.popup(page);

  await popup.clickIn('.chip', 'acme@1');
  await expect
    .poll(() => laneUrls(lab), { message: 'the other lane opens next to the current tab' })
    .toEqual([
      'https://app.acme.localhost/orders/7?tab=items#total',
      'https://app.acme1.localhost/orders/7?tab=items#total'
    ]);
  // laneTabs leaves other tabs out, so only the indexes show that no tab sits between the two.
  const [source, opened] = await laneTabs(lab);
  expect(opened!.index).toBe(source!.index + 1);
});

test('a wildcard route shows without a link, and a tenant page opens on the other lane', async ({
  launch
}) => {
  const lab = await launch({ scenario: { view: WILDCARD } });
  await lab.connected();
  const page = await lab.open('https://t1.sites.acme.localhost/about?x=1#team');
  const popup = await lab.popup(page);

  await popup.waitFor(
    () => document.querySelector('.lane.here > .hd .ref')?.textContent === 'acme@0',
    undefined,
    'acme@0 as the lane of the tenant page'
  );
  expect(await popup.texts('.lane.here .routes .wild')).toEqual(['*.sites.acme.localhost']);
  expect(await popup.texts('.lane.here .routes a')).toEqual(['app.acme.localhost']);

  await popup.clickIn('.chip', 'acme@1');
  await expect
    .poll(() => laneUrls(lab), { message: 'the tenant page opens on the other lane' })
    .toEqual([
      'https://t1.sites.acme.localhost/about?x=1#team',
      'https://t1.sites.acme1.localhost/about?x=1#team'
    ]);
});

test("a lane page's content script can't open the popup's port", async ({ launch }) => {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  const page = await lab.open('https://app.acme.localhost/');
  const run = await contentWorld(lab.context, page);

  // The background closes a port it refuses, and an accepted one gets a snapshot at
  // once, so whichever comes first is the answer.
  const got = await run(`new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: 'popup' });
    port.onMessage.addListener((message) => resolve([message.type]));
    port.onDisconnect.addListener(() => resolve([]));
    port.postMessage({ type: 'use', id: 1, method: 'use', params: { lane: 'acme@0', box: null } });
  })`);
  expect(got).toEqual([]);
  expect(lab.host.requests().map((each) => each.method)).not.toContain('use');

  // The real popup still connects and gets the lanes.
  const popup = await lab.popup(page);
  await popup.waitForText('acme@1');
});

test.describe('the box switch', () => {
  /** The refusal the daemon sends while acme@0 runs on this machine. */
  const RUNS_HERE = {
    error: {
      code: 'local_lane_running',
      message: 'acme@0 runs on this machine. Stop it with devlanes stop --lane acme@0.',
      data: {
        holds: 'processes',
        local_lane: 'acme@0',
        commands: ['devlanes stop --lane acme@0']
      }
    }
  };

  test('sends use with the lane and the box picked', async ({ launch }) => {
    const lab = await launch({ scenario: { view: BOXES } });
    await lab.connected();
    const popup = await lab.popup(await lab.open('https://app.acme.localhost/'));

    await popup.click('fork-b');
    const use = await lab.host.request('use');
    expect(use.params).toEqual({ lane: 'acme@0', box: 'fork-b' });
  });

  test('asks before stopping the local lane, then sends stop_and_use', async ({ launch }) => {
    const lab = await launch({ scenario: { view: BOXES, use: [RUNS_HERE] } });
    await lab.connected();
    const popup = await lab.popup(await lab.open('https://app.acme.localhost/'));

    await popup.click('fork-b');
    await popup.waitForText('acme@0 runs on this machine. Stop it and switch?');
    expect(lab.host.requests().some((each) => each.method === 'stop_and_use')).toBe(false);
    await popup.click('Stop and switch');
    const stop = await lab.host.request('stop_and_use');
    expect(stop.params).toEqual({ lane: 'acme@0', box: 'fork-b' });
  });

  test('shows the commands when containers hold the ports', async ({ launch }) => {
    const commands = ['docker compose -p acme stop', 'docker stop acme-redis-1'];
    const lab = await launch({
      scenario: {
        view: BOXES,
        use: [RUNS_HERE],
        stop_and_use: [
          {
            error: {
              code: 'containers_hold_ports',
              message: 'The containers of acme@0 hold its ports.',
              data: { commands }
            }
          }
        ]
      }
    });
    await lab.connected();
    const popup = await lab.popup(await lab.open('https://app.acme.localhost/'));

    await popup.click('fork-b');
    await popup.click('Stop and switch');
    await popup.waitForText('containers still hold the ports');
    expect(await popup.texts('.cmd code')).toEqual(commands);
  });
});

test('the popup follows the daemon stopping and running again', async ({ launch }) => {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  const popup = await lab.popup(await lab.open('https://app.acme.localhost/'));
  await popup.waitForText('Running');

  lab.host.send({ event: 'daemon', data: { state: 'stopped', message: null } });
  await popup.waitForText('Daemon stopped');
  await popup.waitForText('These lanes are from before devlanes stopped.');

  lab.host.send({ event: 'daemon', data: { state: 'running' } });
  await popup.waitForText('Running');
  await expect.poll(() => popup.text()).not.toContain('Daemon stopped');
});

test('the popup shows a lane_switched notice', async ({ launch }) => {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  const popup = await lab.popup(await lab.open('https://app.acme.localhost/'));

  lab.host.send({
    event: 'notice',
    data: {
      code: 'lane_switched',
      lane: 'acme@1',
      from: 'fork-a',
      to: 'fork-b',
      message: 'acme@1 now comes from fork-b'
    }
  });
  await popup.waitForText('acme@1 now comes from fork-b');
});
