// The login fill on lane pages. It runs in every frame of `https://*.localhost/*`
// and stays idle until the background confirms the frame is on a lane route.
// It is a classic script, so it must never use a dynamic import.

import { type ContentRequest, parseSettings, type Settings, type SettingsChanged } from '../logins';
import { type Candidate, fillable, loginFields, opensMenu, readable, submitted } from './fields';
import { LoginMenu } from './menu';

/** The settings while the frame is on a lane, `null` when it isn't, `undefined` until the background answers. */
let settings: Settings | null | undefined;
let asking: Promise<Settings | null> | undefined;
let menu: LoginMenu | undefined;
/** The field whose menu is waiting for the background. */
let opening: HTMLInputElement | undefined;
/** A field the extension focused itself after a fill, whose next focus opens no menu. */
let refocused: HTMLInputElement | undefined;

/** Sends `request` to the background. A reloaded extension leaves this script without one. */
async function ask<T>(request: ContentRequest): Promise<T | null> {
  try {
    return ((await chrome.runtime.sendMessage(request)) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Asks the background whether this frame is on a lane. A page that loaded
 * before devlanes sent its view asks again on the next sign-in field it focuses.
 */
function checkLane(): Promise<Settings | null> {
  asking ??= ask<Settings>({ type: 'login:lane' }).then((answer) => {
    settings = answer && parseSettings(answer);
    asking = undefined;
    return settings;
  });
  return asking;
}

/** The input an event started on, inside open shadow roots too. */
function inputOf(event: Event): HTMLInputElement | undefined {
  const [target] = event.composedPath();
  return target instanceof HTMLInputElement ? target : undefined;
}

/**
 * The fields of the form `field` belongs to that carry a login token, in document
 * order. A field outside any form goes with the other formless fields of its root.
 */
function candidates(
  field: HTMLInputElement | HTMLFormElement,
  token: typeof readable
): Candidate<HTMLInputElement>[] {
  const form = field instanceof HTMLFormElement ? field : field.form;
  const inputs = form
    ? [...form.elements].filter((each) => each instanceof HTMLInputElement)
    : [...(field.getRootNode() as Document | ShadowRoot).querySelectorAll('input')].filter(
        (each) => !each.form
      );
  return inputs.flatMap((element) => {
    const parsed = token(element);
    return parsed ? [{ element, token: parsed }] : [];
  });
}

/**
 * Writes `value` into `input` the way typing would reach the page's code.
 *
 * Setting `.value` from this isolated world goes straight to the browser's own
 * setter. React wraps `value` on each input to remember the last value it set,
 * but it does that on the page world's copy of the element, which this world
 * doesn't see. So React's copy keeps the old value, and when the `input` event
 * arrives it sees a change and calls `onChange`. Vue's `v-model` reads
 * `event.target.value` on `input`, or on `change` with `.lazy`, so both events go out.
 * They are composed, as the browser's own are, so a listener outside a shadow
 * root around the form still hears them.
 */
function setValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

/** Fills the login of `username` into the form of `field`. */
async function fill(field: HTMLInputElement, username: string): Promise<void> {
  const login = await ask<{ username: string; password: string }>({
    type: 'login:get',
    username
  });
  closeMenu();
  const token = fillable(field);
  if (!login || !token || !field.isConnected) {
    return;
  }
  const fields = loginFields(candidates(field, fillable), token.section);
  if (fields.username) {
    setValue(fields.username, login.username);
  }
  if (fields.password) {
    setValue(fields.password, login.password);
  }
  // A pick with the pointer moved the focus into the menu, which is gone now.
  if (!field.matches(':focus')) {
    refocused = field;
    field.focus();
  }
}

/** Removes the menu, if one is open. */
function closeMenu(): void {
  menu?.close();
  menu = undefined;
}

/** Opens the menu under `field` when the project has saved logins and the fill is on. */
async function openMenu(field: HTMLInputElement): Promise<void> {
  // A click that focuses a field sends both `focusin` and `click`, which open it once.
  if (menu?.field === field || opening === field) {
    return;
  }
  closeMenu();
  opening = field;
  let token: string | null = null;
  try {
    const current = settings ?? (await checkLane());
    token = current?.fill ? await ask<string>({ type: 'login:menu' }) : null;
  } finally {
    opening = undefined;
  }
  // The focus may have moved on while the background answered.
  if (!token || typeof token !== 'string' || !field.matches(':focus') || menu) {
    return;
  }
  const opened: LoginMenu = new LoginMenu(field, token, {
    pick: (username) => {
      fill(field, username).catch((error) => console.error(error));
    },
    close: () => {
      if (menu === opened) {
        closeMenu();
      }
    }
  });
  menu = opened;
}

/** The field the menu opens for, when `event` started on one. */
function menuField(event: Event): HTMLInputElement | undefined {
  const field = inputOf(event);
  const token = field && fillable(field);
  return token && opensMenu(token) ? field : undefined;
}

document.addEventListener(
  'focusin',
  (event) => {
    const field = menuField(event);
    if (field && field === refocused) {
      refocused = undefined;
      return;
    }
    refocused = undefined;
    if (field) {
      openMenu(field).catch((error) => console.error(error));
    }
  },
  true
);

document.addEventListener(
  'focusout',
  (event) => {
    const open = menu;
    if (!open || inputOf(event) !== open.field) {
      return;
    }
    // A click in the menu moves the focus into its frame, which makes the menu's
    // element the active one. The frame takes its focus from another process, a
    // moment after the field lost it, so the check waits a little.
    setTimeout(() => {
      if (menu === open && document.activeElement !== open.host && !open.field.matches(':focus')) {
        closeMenu();
      }
    }, 150);
  },
  true
);

// A click on a field that already has the focus reopens a menu closed with Escape.
document.addEventListener(
  'click',
  (event) => {
    const field = menuField(event);
    if (field && !menu) {
      openMenu(field).catch((error) => console.error(error));
    }
  },
  true
);

// On the window, so the menu's keys come before any listener of the page.
window.addEventListener(
  'keydown',
  (event) => {
    if (menu && inputOf(event) === menu.field) {
      if (menu.key(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    const field = event.key === 'ArrowDown' ? menuField(event) : undefined;
    if (field) {
      openMenu(field).catch((error) => console.error(error));
    }
  },
  true
);

document.addEventListener(
  'submit',
  (event) => {
    // The values must be read now, since the page may navigate away before an answer.
    if (!settings?.remember || !(event.target instanceof HTMLFormElement)) {
      return;
    }
    const found = candidates(event.target, readable);
    for (const section of new Set(found.map((each) => each.token.section))) {
      const login = submitted(loginFields(found, section));
      if (login) {
        ask({ type: 'login:save', ...login });
        return;
      }
    }
  },
  true
);

chrome.runtime.onMessage.addListener((message: SettingsChanged, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'login:settings' || !settings) {
    return;
  }
  settings = parseSettings(message.settings);
  if (!settings.fill) {
    closeMenu();
  }
});

checkLane();
