import { expect, test } from '../support/extension';
import { BOXES, LOCAL } from '../support/views';

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

test('the badge shows the lane number, marked and blue when a box serves the lane', async ({
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

  const opened = lab.context.waitForEvent('page');
  await popup.clickIn('.chip', 'acme@1');
  const copy = await opened;
  await copy.waitForURL('https://app.acme1.localhost/orders/7?tab=items#total');
  const order = await lab.worker.evaluate(async () =>
    (await chrome.tabs.query({ url: 'https://*.localhost/*' })).map((tab) => tab.url)
  );
  expect(order).toEqual([
    'https://app.acme.localhost/orders/7?tab=items#total',
    'https://app.acme1.localhost/orders/7?tab=items#total'
  ]);
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

  test('sends use for the box picked', async ({ launch }) => {
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
