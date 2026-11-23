import type { Frame, Page } from '@playwright/test';
import { expect, type Lab, test } from '../support/extension';
import type { Popup } from '../support/popup';
import { LOCAL } from '../support/views';

/** A saved login as `chrome.storage.local` holds it. */
interface Saved {
  username: string;
  password: string;
  lane: string;
  used: number;
}

/** The login every test starts with, so the menu can show that a page is ready. */
const SEED: Saved = {
  username: 'seed@example.invalid',
  password: 'seed-pass',
  lane: 'acme@0',
  used: 1
};

/** Starts the browser with the local view and acme's seed login. */
async function start(launch: (options: { scenario: { view: typeof LOCAL } }) => Promise<Lab>) {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  await lab.worker.evaluate((seed) => chrome.storage.local.set({ 'logins:acme': [seed] }), SEED);
  return lab;
}

/** The open login menu frame of `page`, once it lists `username`. */
async function menuFor(page: Page, username: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect
    .poll(
      () => {
        frame = page
          .frames()
          .find((each) => each.url().includes('/menu.html') && !each.isDetached());
        return frame !== undefined;
      },
      { message: 'the login menu opens' }
    )
    .toBe(true);
  const menu = frame as Frame;
  await expect(menu.getByRole('option', { name: new RegExp(username) })).toBeVisible();
  return menu;
}

/** Waits until no login menu is on `page`. */
async function noMenu(page: Page): Promise<void> {
  await expect(page.locator('div[popover]')).toHaveCount(0);
}

/**
 * Waits until the login fill of `page` knows the page is a lane. The menu shows
 * only after the background answered, so its opening is the sign. It closes again
 * with Escape.
 */
async function ready(page: Page, field = '#user'): Promise<void> {
  await page.click(field);
  await menuFor(page, SEED.username);
  await page.keyboard.press('Escape');
  await noMenu(page);
}

/** The saved logins of acme, once `username` is among them. */
async function savedWith(lab: Lab, username: string): Promise<Saved[]> {
  await expect
    .poll(async () => (await logins(lab)).some((each) => each.username === username), {
      message: `the login of ${username} is saved`
    })
    .toBe(true);
  return logins(lab);
}

/** The saved logins of acme. */
async function logins(lab: Lab): Promise<Saved[]> {
  return (await lab.stored<Saved[]>('logins:acme')) ?? [];
}

/** Signs in on `page` with `username` and `password`, and waits for the next page. */
async function signIn(page: Page, username: string, password: string, prefix = ''): Promise<void> {
  await page.fill(`#${prefix}user`, username);
  await page.fill(`#${prefix}pass`, password);
  // Enter sends the form even while the menu is open, as long as no login is
  // highlighted. A click on the button could land on the menu instead.
  await Promise.all([page.waitForURL('**/signed-in'), page.press(`#${prefix}pass`, 'Enter')]);
}

/** How many `input` events each field of `page` got. */
async function inputs(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const event of (window as unknown as { events: { type: string; id: string }[] }).events) {
      if (event.type === 'input') {
        counts[event.id] = (counts[event.id] ?? 0) + 1;
      }
    }
    return counts;
  });
}

/** Opens the popup's login settings over `page` and flips the switch named `label`. */
async function flip(lab: Lab, page: Page, label: string): Promise<Popup> {
  const popup = await lab.popup(page);
  await popup.click('Login settings');
  await popup.clickIn('label.switch', label);
  return popup;
}

test('a login typed on one lane is offered and filled on another lane of the project', async ({
  launch
}) => {
  const lab = await start(launch);
  const first = await lab.open('https://app.acme.localhost/login');
  await ready(first);
  await first.fill('#otp', '123456');
  await first.fill('#plain', 'Ali');
  await signIn(first, 'alice@example.invalid', 's3cret-pass');

  const alice = (await savedWith(lab, 'alice@example.invalid')).find(
    (each) => each.username === 'alice@example.invalid'
  );
  expect(alice).toMatchObject({ password: 's3cret-pass', lane: 'acme@0' });
  const everything = JSON.stringify(
    await lab.worker.evaluate(() => chrome.storage.local.get(null))
  );
  expect(everything).not.toContain('123456');
  expect(everything).not.toContain('Ali');

  const second = await lab.open('https://app.acme1.localhost/login');
  await second.click('#user');
  await menuFor(second, 'alice@example.invalid');
  // The newest login comes first.
  await second.keyboard.press('ArrowDown');
  await second.keyboard.press('Enter');
  await expect(second.locator('#pass')).toHaveValue('s3cret-pass');
  await expect(second.locator('#user')).toHaveValue('alice@example.invalid');
  await expect(second.locator('#otp')).toHaveValue('');
  await expect(second.locator('#plain')).toHaveValue('');
  expect(second.url()).toBe('https://app.acme1.localhost/login');
  await expect
    .poll(
      async () =>
        (await logins(lab)).find((each) => each.username === 'alice@example.invalid')?.lane
    )
    .toBe('acme@1');
});

test('a field without a login token, or with one-time-code, opens no menu', async ({ launch }) => {
  const lab = await start(launch);
  const page = await lab.open('https://app.acme1.localhost/login');
  await ready(page);
  await page.evaluate(() => {
    const counted = window as unknown as { menus: number };
    counted.menus = 0;
    new MutationObserver((changes) => {
      for (const change of changes) {
        counted.menus += [...change.addedNodes].filter(
          (node) => node instanceof HTMLElement && node.hasAttribute('popover')
        ).length;
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  await page.click('#plain');
  await page.click('#otp');
  // The content script decides on each focus as it happens, so the menu for the
  // username field, focused last, is the first one that can open.
  await page.click('#user');
  await menuFor(page, SEED.username);
  expect(await page.evaluate(() => (window as unknown as { menus: number }).menus)).toBe(1);
});

test('"Remember passwords" off saves nothing, and "Fill logins on lanes" off opens no menu', async ({
  launch
}) => {
  const lab = await start(launch);
  const lane = await lab.open('https://app.acme1.localhost/login');

  const settings = await flip(lab, lane, 'Remember passwords');
  await expect.poll(() => lab.stored('settings')).toEqual({ fill: true, remember: false });
  await settings.close();
  const bob = await lab.open('https://app.acme1.localhost/login');
  // The menu shows only once the page knows its settings, so remembering is known to be off.
  await ready(bob);
  await signIn(bob, 'bob@example.invalid', 'bob-pass');
  // A submit with remembering off sends nothing, so the logins can be read at once.
  expect(JSON.stringify(await lab.stored('logins:acme'))).not.toContain('bob@');

  const fillOff = await flip(lab, lane, 'Remember passwords');
  await fillOff.clickIn('label.switch', 'Fill logins on lanes');
  await expect.poll(() => lab.stored('settings')).toEqual({ fill: false, remember: true });
  await fillOff.close();
  const carol = await lab.open('https://app.acme1.localhost/login');
  await carol.click('#user');
  await signIn(carol, 'carol@example.invalid', 'carol-pass');
  // The save of carol's login proves the page knew its settings before the
  // username field got the focus, and with the fill off it never asks for a menu.
  await savedWith(lab, 'carol@example.invalid');
  await noMenu(carol);
});

test("the page's own keys, clicks and submits never fill or save anything", async ({ launch }) => {
  const lab = await start(launch);
  const page = await lab.open('https://app.acme1.localhost/login');
  await ready(page);

  // The page may focus its field, which opens the menu, but its keys and clicks do nothing.
  await page.evaluate(() => {
    const user = document.querySelector('#user') as HTMLInputElement;
    // The field still has the focus from the menu Escape closed.
    user.blur();
    user.focus();
  });
  await menuFor(page, SEED.username);
  await page.evaluate(() => {
    const user = document.querySelector('#user') as HTMLInputElement;
    for (const key of ['ArrowDown', 'Enter', 'ArrowDown', 'Enter']) {
      user.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true })
      );
    }
    user.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    user.click();
    const form = document.querySelector('#f') as HTMLFormElement;
    (document.querySelector('#pass') as HTMLInputElement).value = 'forged';
    user.value = 'mallory@example.invalid';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    user.value = '';
    (document.querySelector('#pass') as HTMLInputElement).value = '';
  });

  // A person's keys fill once. A fill from the page's keys would have come first.
  await page.focus('#user');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pass')).toHaveValue(SEED.password);
  expect(await inputs(page)).toEqual({ user: 1, pass: 1 });

  // A real submit after the forged one is saved, and the forged one never is.
  await page.reload();
  await ready(page);
  await signIn(page, 'dave@example.invalid', 'dave-pass');
  const saved = await savedWith(lab, 'dave@example.invalid');
  expect(saved.some((each) => each.username === 'mallory@example.invalid')).toBe(false);
});

test('a form in an open shadow root is saved and filled', async ({ launch }) => {
  const lab = await start(launch);
  const page = await lab.open('https://app.acme1.localhost/shadow');
  await ready(page);
  await signIn(page, 'shadow@example.invalid', 'shadow-pass');
  const saved = await savedWith(lab, 'shadow@example.invalid');
  expect(saved.find((each) => each.username === 'shadow@example.invalid')).toMatchObject({
    password: 'shadow-pass',
    lane: 'acme@1'
  });

  const again = await lab.open('https://app.acme.localhost/shadow');
  await again.click('#user');
  await menuFor(again, 'shadow@example.invalid');
  await again.keyboard.press('ArrowDown');
  await again.keyboard.press('Enter');
  await expect(again.locator('#pass')).toHaveValue('shadow-pass');
  await expect(again.locator('#user')).toHaveValue('shadow@example.invalid');
});

test('fields outside any form are filled', async ({ launch }) => {
  const lab = await start(launch);
  const page = await lab.open('https://app.acme1.localhost/formless');
  await page.click('#pass');
  await menuFor(page, SEED.username);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#user')).toHaveValue(SEED.username);
  await expect(page.locator('#pass')).toHaveValue(SEED.password);
});

test('with two forms on a page, only the form of the focused field is filled or saved', async ({
  launch
}) => {
  const lab = await start(launch);
  const page = await lab.open('https://app.acme1.localhost/two-forms');
  await page.click('#b-user');
  await menuFor(page, SEED.username);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#b-pass')).toHaveValue(SEED.password);
  await expect(page.locator('#b-user')).toHaveValue(SEED.username);
  await expect(page.locator('#a-user')).toHaveValue('');
  await expect(page.locator('#a-pass')).toHaveValue('');

  await page.fill('#b-user', '');
  await page.fill('#b-pass', '');
  await page.fill('#b-user', 'admin@example.invalid');
  await signIn(page, 'erin@example.invalid', 'erin-pass', 'a-');
  const saved = await savedWith(lab, 'erin@example.invalid');
  expect(saved.some((each) => each.username === 'admin@example.invalid')).toBe(false);
});

test('the menu closes when the page removes its field', async ({ launch }) => {
  const lab = await start(launch);
  const page = await lab.open('https://app.acme1.localhost/login');
  await page.click('#user');
  await menuFor(page, SEED.username);
  await page.evaluate(() => document.querySelector('#f')?.remove());
  await noMenu(page);
});
