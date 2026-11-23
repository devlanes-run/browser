import type { UseParams } from '@devlanes/protocol';
import {
  type PopupRequest,
  parseRecords,
  parseSettings,
  projectOf,
  SETTINGS_KEY,
  type Settings
} from '../logins';
import {
  type BackgroundMessage,
  POPUP_PORT,
  type PopupMessage,
  SNAPSHOT_KEY,
  type Snapshot,
  type UseMethod,
  type UseReply
} from '../state';

/** What the popup needs from the browser. The preview page passes a fake one. */
export interface Bridge {
  /** Calls `listener` with each snapshot from the background. Returns a function that stops it. */
  watch(listener: (snapshot: Snapshot) => void): () => void;
  /** Sends `use` or `stop_and_use` through the background. */
  use(method: UseMethod, params: UseParams): Promise<UseReply>;
  /** Drops a notice for every popup. */
  dismiss(notice: number): void;
  /** The URL of the active tab, when the extension may read it. */
  currentPage(): Promise<string | undefined>;
  /** Opens `url` in a new tab next to the current one. */
  open(url: string): void;
  /** Puts `text` on the clipboard. */
  copy(text: string): Promise<void>;
  /** Calls `listener` with the login settings and saved logins, now and on each change. Returns a function that stops it. */
  watchLogins(listener: (state: LoginState) => void): () => void;
  /** Turns one login setting on or off. */
  setLoginSetting(name: keyof Settings, on: boolean): Promise<void>;
  /** Deletes the saved logins of `project`. */
  forgetLogins(project: string): Promise<void>;
}

/** The login settings and how many logins each project has saved. */
export interface LoginState {
  settings: Settings;
  /** Projects with saved logins, by name. */
  saved: { project: string; count: number }[];
}

/** The login state stored in `items`, the whole of `chrome.storage.local`. */
export function loginState(items: Record<string, unknown>): LoginState {
  const saved = Object.entries(items).flatMap(([key, value]) => {
    const project = projectOf(key);
    const count = project === undefined ? 0 : parseRecords(value).length;
    return project !== undefined && count > 0 ? [{ project, count }] : [];
  });
  saved.sort((a, b) => a.project.localeCompare(b.project));
  return { settings: parseSettings(items[SETTINGS_KEY]), saved };
}

/**
 * The bridge over a `runtime` port to the background. Opening the port also
 * makes the background connect to the host when it isn't connected.
 */
export function chromeBridge(): Bridge {
  const port = chrome.runtime.connect({ name: POPUP_PORT });
  const listeners = new Set<(snapshot: Snapshot) => void>();
  const pending = new Map<number, (reply: UseReply) => void>();
  let last: Snapshot | undefined;
  let live: Snapshot | undefined;
  // The saved lanes, kept until a live snapshot carries a view of its own.
  let savedView: Snapshot['view'];
  let nextId = 1;

  /** Hands every listener the live snapshot, with the saved lanes while it has none. */
  const publish = (snapshot: Snapshot) => {
    last = snapshot.view || !savedView ? snapshot : { ...snapshot, view: savedView };
    for (const listener of listeners) {
      listener(last);
    }
  };

  // A stopped service worker can take a while to start and answer. The snapshot it
  // saved last lets the popup show the lanes before that, and the live one replaces it.
  chrome.storage.session.get(SNAPSHOT_KEY).then(
    (items) => {
      const saved = items[SNAPSHOT_KEY] as Snapshot | undefined;
      if (!saved || live?.view) {
        return;
      }
      savedView = saved.view;
      // The saved status may say "running" from an old port, which would enable the
      // box switch, so it reads as connecting until the background answers.
      publish(live ?? { ...saved, status: { state: 'connecting' } });
    },
    (error) => console.error(error)
  );

  port.onMessage.addListener((message: BackgroundMessage) => {
    if (message.type === 'snapshot') {
      live = message.snapshot;
      if (live.view) {
        savedView = undefined;
      }
      publish(live);
    } else {
      pending.get(message.id)?.(message.reply);
      pending.delete(message.id);
    }
  });

  return {
    watch(listener) {
      listeners.add(listener);
      if (last) {
        listener(last);
      }
      return () => listeners.delete(listener);
    },
    use(method, params) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        port.postMessage({ type: 'use', id, method, params } satisfies PopupMessage);
      });
    },
    dismiss(notice) {
      port.postMessage({ type: 'dismiss', notice } satisfies PopupMessage);
    },
    async currentPage() {
      // Without the `tabs` permission, `url` is only set on tabs the host permissions cover.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.url;
    },
    open(url) {
      // Next to the current tab, so the page and its copy in another lane sit side by side.
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => chrome.tabs.create(tab ? { url, index: tab.index + 1 } : { url }))
        .catch((error) => console.error(error));
    },
    copy(text) {
      return navigator.clipboard.writeText(text);
    },
    watchLogins(listener) {
      let stopped = false;
      /** Hands `listener` the stored state, unless the popup stopped watching meanwhile. */
      const read = () => {
        chrome.storage.local.get(null).then(
          (items) => {
            if (!stopped) {
              listener(loginState(items));
            }
          },
          (error) => console.error(error)
        );
      };
      /** Reads the state again after any change to `storage.local`. */
      const changed = (_: unknown, area: string) => {
        if (area === 'local') {
          read();
        }
      };
      chrome.storage.onChanged.addListener(changed);
      read();
      return () => {
        stopped = true;
        chrome.storage.onChanged.removeListener(changed);
      };
    },
    async setLoginSetting(name, on) {
      const request: PopupRequest = { type: 'popup:setting', name, on };
      await chrome.runtime.sendMessage(request);
    },
    async forgetLogins(project) {
      const request: PopupRequest = { type: 'popup:forget', project };
      await chrome.runtime.sendMessage(request);
    }
  };
}
