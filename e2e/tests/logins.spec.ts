import type { Frame, Page } from '@playwright/test';
import { expect, type Lab, test } from '../support/extension';
import { EXTENSION_ID } from '../support/host';
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

/** A message the background got from a content script, the menu or the popup. */
interface Message {
  type: string;
  /** The username of a `login:save`. */
  username?: string;
}

/**
 * Starts the browser with the local view and acme's seed login. The worker also
 * records the type of every message it gets, in order, so a test can show that
 * the content script never asked for something. The recorder answers nothing,
 * so the extension's own listener still answers every message.
 */
async function start(launch: (options: { scenario: { view: typeof LOCAL } }) => Promise<Lab>) {
  const lab = await launch({ scenario: { view: LOCAL } });
  await lab.connected();
  await lab.worker.evaluate((seed) => {
    const recorded: Recorded[] = [];
    (globalThis as unknown as { recorded: Recorded[] }).recorded = recorded;
    chrome.runtime.onMessage.addListener((message: Message, sender) => {
      const from = sender.url ?? '';
      recorded.push(
        message.type === 'login:save'
          ? { type: message.type, username: message.username ?? '', from }
          : { type: message?.type, from }
      );
    });
    return chrome.storage.local.set({ 'logins:acme': [seed] });
  }, SEED);
  return lab;
}

/** A recorded message with the URL of the frame that sent it. */
type Recorded = Message & { from: string };

/** Every message the background got since {@link start}, without the frames that sent them. */
async function messages(lab: Lab): Promise<Message[]> {
  return (await recorded(lab)).map(({ from: _, ...message }) => message);
}

/** Every message the background got since {@link start}. */
function recorded(lab: Lab): Promise<Recorded[]> {
  return lab.worker.evaluate(() => (globalThis as unknown as { recorded: Recorded[] }).recorded);
}

/**
 * Opens `url` in a new tab once its login fill is listening. The content script
 * runs when the document is idle, which can be after the page's load, so a click
 * right after loading could come before it listens. It asks the background
 * about the lane as its last step, so that request is the sign. `frame` names
 * the URL of a framed lane page to wait for instead.
 */
async function openLane(lab: Lab, url: string, frame = url): Promise<Page> {
  const asked = async () =>
    (await recorded(lab)).filter((each) => each.type === 'login:lane' && each.from === frame)
      .length;
  const before = await asked();
  const page = await lab.open(url);
  await expect
    .poll(asked, { message: `the login fill listens on ${frame}` })
    .toBeGreaterThan(before);
  return page;
}

/** The messages the background got after the first `skip`, up to and with the first `login:save`. */
function untilSave(all: Message[], skip: number): Message[] {
  const rest = all.slice(skip);
  const save = rest.findIndex((each) => each.type === 'login:save');
  return save < 0 ? rest : rest.slice(0, save + 1);
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
  const first = await openLane(lab, 'https://app.acme.localhost/login');
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

  const second = await openLane(lab, 'https://app.acme1.localhost/login');
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
  const page = await openLane(lab, 'https://app.acme1.localhost/login');
  await ready(page);
  const before = (await messages(lab)).length;

  await page.click('#plain');
  await page.click('#otp');
  // A menu asked for one of those fields would be dropped once the focus moved on,
  // so the test counts the menus the background was asked for. The one for the
  // username field, focused last, comes after any of theirs.
  await page.click('#user');
  await menuFor(page, SEED.username);
  const asked = (await messages(lab)).slice(before).filter((each) => each.type === 'login:menu');
  expect(asked).toHaveLength(1);
});

test('"Remember passwords" off saves nothing, and "Fill logins on lanes" off opens no menu', async ({
  launch
}) => {
  const lab = await start(launch);
  const lane = await openLane(lab, 'https://app.acme1.localhost/login');

  const settings = await flip(lab, lane, 'Remember passwords');
  await expect.poll(() => lab.stored('settings')).toEqual({ fill: true, remember: false });
  await settings.close();
  const bob = await openLane(lab, 'https://app.acme1.localhost/login');
  // The menu shows only once the page knows its settings, so remembering is known to be off.
  await ready(bob);
  await signIn(bob, 'bob@example.invalid', 'bob-pass');

  const fillOff = await flip(lab, lane, 'Remember passwords');
  await fillOff.clickIn('label.switch', 'Fill logins on lanes');
  await expect.poll(() => lab.stored('settings')).toEqual({ fill: false, remember: true });
  await fillOff.close();
  const before = (await messages(lab)).length;
  const carol = await openLane(lab, 'https://app.acme1.localhost/login');
  await carol.click('#user');
  await signIn(carol, 'carol@example.invalid', 'carol-pass');
  await savedWith(lab, 'carol@example.invalid');
  // The page asks for a menu as its field gets the focus, before anything is typed,
  // so a request for one would come before carol's save.
  const sent = untilSave(await messages(lab), before);
  expect(sent.at(-1)).toEqual({ type: 'login:save', username: 'carol@example.invalid' });
  expect(sent.filter((each) => each.type === 'login:menu')).toEqual([]);
  // Bob's submit came before carol's, so a save of bob's login would be done by now.
  expect(JSON.stringify(await lab.stored('logins:acme'))).not.toContain('bob@');
  // Bob's page never sent a save, so the background had nothing to refuse.
  expect(
    (await messages(lab)).filter(
      (each) => each.type === 'login:save' && each.username === 'bob@example.invalid'
    )
  ).toEqual([]);
});

test("the page's own keys, clicks and submits never fill or save anything", async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(lab, 'https://app.acme1.localhost/login');
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
  });
  // A person's keys fill once. A fill from the page's keys would have come first.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pass')).toHaveValue(SEED.password);
  expect(await inputs(page)).toEqual({ user: 1, pass: 1 });

  // The fill closed the menu. A click from a person on the focused field would open
  // it again, so a click from the page must not.
  await noMenu(page);
  const before = (await messages(lab)).length;
  await page.evaluate(() => {
    const user = document.querySelector('#user') as HTMLInputElement;
    user.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    user.click();
    const pass = document.querySelector('#pass') as HTMLInputElement;
    user.value = 'mallory@example.invalid';
    pass.value = 'forged';
    (document.querySelector('#f') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
  });

  // A real sign-in comes after. Focusing the password field asks for one menu, and
  // the submit saves dave. Anything the page's click or submit caused came first.
  await signIn(page, 'dave@example.invalid', 'dave-pass');
  await savedWith(lab, 'dave@example.invalid');
  expect(untilSave(await messages(lab), before)).toEqual([
    { type: 'login:menu' },
    { type: 'login:save', username: 'dave@example.invalid' }
  ]);
});

test('a form in an open shadow root is saved and filled', async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(lab, 'https://app.acme1.localhost/shadow');
  await ready(page);
  await signIn(page, 'shadow@example.invalid', 'shadow-pass');
  const saved = await savedWith(lab, 'shadow@example.invalid');
  expect(saved.find((each) => each.username === 'shadow@example.invalid')).toMatchObject({
    password: 'shadow-pass',
    lane: 'acme@1'
  });

  const again = await openLane(lab, 'https://app.acme.localhost/shadow');
  await again.click('#user');
  await menuFor(again, 'shadow@example.invalid');
  await again.keyboard.press('ArrowDown');
  await again.keyboard.press('Enter');
  await expect(again.locator('#pass')).toHaveValue('shadow-pass');
  await expect(again.locator('#user')).toHaveValue('shadow@example.invalid');
});

test('fields outside any form are filled', async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(lab, 'https://app.acme1.localhost/formless');
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
  const page = await openLane(lab, 'https://app.acme1.localhost/two-forms');
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
  const page = await openLane(lab, 'https://app.acme1.localhost/login');
  await page.click('#user');
  await menuFor(page, SEED.username);
  await page.evaluate(() => document.querySelector('#f')?.remove());
  await noMenu(page);
});

test('the fill works in a lane page framed by another lane page', async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(
    lab,
    'https://app.acme.localhost/framed',
    'https://app.acme1.localhost/login'
  );
  const child = page.frameLocator('#child');
  // A Playwright click into the frame sometimes focuses only the frame element and
  // not the field inside. It happens without the extension too: on Windows, 2 of 40
  // fresh browsers without it and 3 of 40 with it left the field unfocused. So the
  // test focuses the field itself. The keys that pick the login are still a person's.
  await child.locator('#user').focus();
  await menuFor(page, SEED.username);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(child.locator('#pass')).toHaveValue(SEED.password);
  await expect(child.locator('#user')).toHaveValue(SEED.username);
});

test('after Escape, a click on the focused field opens the menu again', async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(lab, 'https://app.acme1.localhost/login');
  await page.click('#user');
  await menuFor(page, SEED.username);
  await page.keyboard.press('Escape');
  await noMenu(page);
  await page.click('#user');
  await menuFor(page, SEED.username);
});

test('page CSS that hides every div and popover leaves the menu usable', async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(lab, 'https://app.acme1.localhost/login');
  await page.addStyleTag({
    content: `div, [popover] { display: none !important; opacity: 0 !important;
      pointer-events: none !important; transform: scale(0) !important; clip-path: inset(50%) !important; }`
  });
  await page.click('#pass');
  const menu = await menuFor(page, SEED.username);
  // A pointer click goes where the menu is drawn, so it lands only when the menu shows.
  await menu.getByRole('option', { name: new RegExp(SEED.username) }).click();
  await expect(page.locator('#pass')).toHaveValue(SEED.password);
  await expect(page.locator('#user')).toHaveValue(SEED.username);
});

test("a lane page can't load the menu from the extension's static URL", async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(lab, 'https://app.acme1.localhost/login');
  const result = await page.evaluate(async (id) => {
    try {
      const response = await fetch(`chrome-extension://${id}/menu.html`);
      return `loaded with ${response.status}`;
    } catch {
      return 'blocked';
    }
  }, EXTENSION_ID);
  expect(result).toBe('blocked');
});

test("the content script can't read the extension's storage", async ({ launch }) => {
  const lab = await start(launch);
  const page = await openLane(lab, 'https://app.acme1.localhost/login');
  const cdp = await lab.context.newCDPSession(page);
  const worlds: { id: number; name: string; type: string | undefined }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    worlds.push({ id: context.id, name: context.name, type: context.auxData?.type });
  });
  // Enabling the domain reports every context that already exists.
  await cdp.send('Runtime.enable');
  let world: number | undefined;
  await expect
    .poll(
      () => {
        world = worlds.find((each) => each.type === 'isolated' && each.name === 'devlanes')?.id;
        return world;
      },
      { message: "the content script's isolated world" }
    )
    .toBeDefined();
  /** Runs `expression` in the content script's world and returns its value. */
  const run = async (expression: string) =>
    (
      await cdp.send('Runtime.evaluate', {
        contextId: world as number,
        expression,
        awaitPromise: true,
        returnByValue: true
      })
    ).result.value as unknown;

  // The world is this extension's content script, which can message its background.
  expect(await run('chrome.runtime.id')).toBe(EXTENSION_ID);
  expect(await run('typeof chrome.runtime.sendMessage')).toBe('function');
  expect(
    await run(`(async () => {
      try {
        await chrome.storage.local.get(null);
        return 'read';
      } catch {
        return 'refused';
      }
    })()`)
  ).toBe('refused');
});
