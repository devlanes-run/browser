import { HOST_NAME, type View } from '@devlanes/protocol';
import { HostConnection, type NativePort } from './background/host';
import { Logins } from './background/logins';
import { badgeFor } from './lanes';
import { parseSettings, SETTINGS_KEY, type Settings, type SettingsChanged } from './logins';
import {
  type BackgroundMessage,
  POPUP_PORT,
  type PopupMessage,
  SNAPSHOT_KEY,
  type Snapshot,
  type UseReply
} from './state';

/** Badge colours from the devlanes palette: paint for this machine, the info blue for a box. */
const BADGE_LOCAL = { background: '#f5c542', text: '#24231f' };
const BADGE_BOX = { background: '#2f5f8f', text: '#ffffff' };

const popups = new Set<chrome.runtime.Port>();
let paintedView: View | undefined;

/** Opens the native port, reading the browser's reason when it closes. */
function connectNative(): NativePort {
  const port = chrome.runtime.connectNative(HOST_NAME);
  return {
    postMessage: (message) => port.postMessage(message),
    disconnect: () => port.disconnect(),
    onMessage: (listener) => port.onMessage.addListener((message) => listener(message)),
    // `lastError` only holds the reason inside this listener.
    onDisconnect: (listener) =>
      port.onDisconnect.addListener(() => listener(chrome.runtime.lastError?.message))
  };
}

const host = new HostConnection({
  connect: connectNative,
  version: chrome.runtime.getManifest().version,
  onChange: changed,
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  }
});

/** Sends the snapshot to open popups, saves it for the next service worker and repaints badges. */
function changed(snapshot: Snapshot): void {
  post({ type: 'snapshot', snapshot });
  // Saving before the restore read the old snapshot would overwrite its lanes with none.
  restored
    .then(() => chrome.storage.session.set({ [SNAPSHOT_KEY]: host.snapshot }))
    .catch((error) => console.error(error));
  // The host sends a view only when it differs, so identity is enough to skip repaints.
  if (snapshot.view !== paintedView) {
    paintedView = snapshot.view;
    paintAll().catch((error) => console.error(error));
  }
}

/** Sends `message` to every open popup. */
function post(message: BackgroundMessage): void {
  for (const port of popups) {
    port.postMessage(message);
  }
}

/** Sets the badge of the tab `tabId` on `url`. */
async function paint(tabId: number, url: string | undefined): Promise<void> {
  const badge = badgeFor(host.snapshot.view, url);
  const colours = badge?.box === undefined ? BADGE_LOCAL : BADGE_BOX;
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: badge?.text ?? '' }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: colours.background }),
    chrome.action.setBadgeTextColor({ tabId, color: colours.text }),
    chrome.action.setTitle({ tabId, title: badge?.title ?? 'devlanes' })
  ]);
}

/**
 * Repaints the badge of every lane tab. The host permissions let `tabs.query`
 * filter on `*.localhost` URLs without the `tabs` permission.
 */
async function paintAll(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://*.localhost/*' });
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : paint(tab.id, tab.url))));
}

/** Loads what the previous service worker saved, since Chrome stops idle workers. */
async function restore(): Promise<void> {
  const saved = (await chrome.storage.session.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as
    | Snapshot
    | undefined;
  if (saved) {
    // The saved status belonged to the previous worker's port, so only the data comes back.
    const { status: _, ...data } = saved;
    host.restore(data);
  }
}

/** Settles once the saved snapshot is back in {@link host}, or failed to load. */
const restored = restore().catch((error) => console.error(error));

// Passwords sit in `storage.local`, which content scripts can read by default. Every
// read goes through the background instead, which checks the frame's lane first.
// Chrome 120 can't restrict `storage.local`: in a test on 120.0.6099.109 the method
// was missing there, and a version that has it but refuses rejects into the catch.
// A call that threw here would stop the whole worker. On such a version page code
// still can't reach the storage, but a compromised page renderer could read it.
chrome.storage.local
  .setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch((error) => console.error(error));

const logins = new Logins({
  extensionId: chrome.runtime.id,
  view: async () => {
    // A content script can wake a stopped worker, which has no view until the saved one is back.
    await restored;
    return host.snapshot.view;
  },
  store: {
    get: async (key) => (await chrome.storage.local.get(key))[key],
    set: (key, value) => chrome.storage.local.set({ [key]: value }),
    remove: (key) => chrome.storage.local.remove(key)
  },
  now: Date.now,
  token: () => crypto.randomUUID()
});

/** Tells the content scripts of every lane tab about new settings. */
async function sendSettings(settings: Settings): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://*.localhost/*' });
  const message: SettingsChanged = { type: 'login:settings', settings };
  await Promise.all(
    tabs.map((tab) =>
      // A tab that loaded before the extension has no content script to answer.
      tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, message).catch(() => {})
    )
  );
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const answer = logins.answer(message, sender);
  if (!answer) {
    return false;
  }
  answer.then(respond, (error) => {
    console.error(error);
    respond(null);
  });
  // Keeps `respond` valid until the answer is ready.
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY];
  if (area === 'local' && change) {
    sendSettings(parseSettings(change.newValue)).catch((error) => console.error(error));
  }
});

/** Answers one request from a popup. */
async function answer(port: chrome.runtime.Port, message: PopupMessage): Promise<void> {
  if (message.type === 'dismiss') {
    host.dismiss(message.notice);
    return;
  }
  const reply: UseReply = await host.request(message.method, message.params);
  // The popup may have closed while `stop_and_use` waited for the lane to stop.
  if (popups.has(port)) {
    port.postMessage({ type: 'reply', id: message.id, reply } satisfies BackgroundMessage);
  }
}

// Connecting at startup and install lets the badge work before the popup ever opens.
chrome.runtime.onStartup.addListener(() => host.ensure());
chrome.runtime.onInstalled.addListener(() => host.ensure());

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== POPUP_PORT) {
    return;
  }
  popups.add(port);
  port.onDisconnect.addListener(() => popups.delete(port));
  port.onMessage.addListener((message: PopupMessage) => {
    answer(port, message).catch((error) => console.error(error));
  });
  // A popup opening after `devlanes setup` connects again, with no browser restart.
  host.ensure();
  // On a cold start the snapshot has no view until the saved one is back. Posting it
  // earlier would replace the lanes the popup already painted from storage.
  restored.then(() => {
    if (popups.has(port)) {
      port.postMessage({ type: 'snapshot', snapshot: host.snapshot } satisfies BackgroundMessage);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url !== undefined || change.status === 'complete') {
    paint(tabId, tab.url).catch((error) => console.error(error));
  }
});
