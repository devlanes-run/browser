import type { View } from '@devlanes/protocol';
import { findRoute } from '../lanes';
import {
  type Claimed,
  type LoginRecord,
  listed,
  loginsKey,
  parseRecords,
  parseSettings,
  remember,
  SETTINGS_KEY,
  type Settings,
  savable,
  touch
} from '../logins';

/** A key-value store, as `chrome.storage.local` is to the background. */
export interface Store {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The parts of `chrome.runtime.MessageSender` the background trusts. The browser sets them. */
export interface Sender {
  id?: string | undefined;
  url?: string | undefined;
  origin?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
}

/** What {@link Logins} needs from the browser. */
export interface LoginDeps {
  /** This extension's id. Only its own content scripts and pages are answered. */
  extensionId: string;
  /** The last view from the host, once the saved one is back. */
  view(): Promise<View | undefined>;
  store: Store;
  now(): number;
  /** A fresh unguessable token. */
  token(): string;
}

/** How long a menu token waits for its frame to claim it. */
const TOKEN_TTL = 30_000;

/** A menu token waiting for its frame: the tab it was made for and the project it lists. */
interface Pending {
  tabId: number;
  project: string;
  expires: number;
}

/** The lane a content script's frame is on, from the sender the browser filled in. */
interface Place {
  project: string;
  lane: string;
}

/**
 * Answers the content scripts and the menu frame about saved logins. The page a
 * request comes from is read from its sender, never from the message, so a frame
 * only reaches the logins of the project whose lane it is on.
 */
export class Logins {
  #deps: LoginDeps;
  #tokens = new Map<string, Pending>();
  // Saves read, change and write one key, so two forms sent at once must not interleave.
  // The popup's changes go through it too, so a delete can't lose to a save already running.
  #queue: Promise<unknown> = Promise.resolve();

  /** @param deps The browser parts, so tests can stand in for storage and the view. */
  constructor(deps: LoginDeps) {
    this.#deps = deps;
  }

  /**
   * Answers `message` from `sender`, or gives `undefined` when the message isn't a
   * login request, so other listeners may answer it.
   */
  answer(message: unknown, sender: Sender): Promise<unknown> | undefined {
    if (typeof message !== 'object' || message === null || !('type' in message)) {
      return undefined;
    }
    const request = message as Record<string, unknown>;
    switch (request.type) {
      case 'login:lane':
        return this.#lane(sender);
      case 'login:menu':
        return this.#menu(sender);
      case 'login:get':
        return typeof request.username === 'string'
          ? this.#serial(() => this.#get(sender, request.username as string))
          : Promise.resolve(null);
      case 'login:save':
        return typeof request.username === 'string' && typeof request.password === 'string'
          ? this.#serial(() =>
              this.#save(sender, request.username as string, request.password as string)
            )
          : Promise.resolve(false);
      case 'menu:claim':
        return typeof request.token === 'string'
          ? this.#claim(sender, request.token)
          : Promise.resolve(null);
      case 'popup:setting':
        return (request.name === 'fill' || request.name === 'remember') &&
          typeof request.on === 'boolean' &&
          this.#isPage(sender, '/popup.html')
          ? this.#serial(() => this.#setting(request.name as keyof Settings, request.on as boolean))
          : Promise.resolve(false);
      case 'popup:forget':
        return typeof request.project === 'string' && this.#isPage(sender, '/popup.html')
          ? this.#serial(() => this.#forget(request.project as string))
          : Promise.resolve(false);
      default:
        return undefined;
    }
  }

  /** Turns one setting on or off. */
  async #setting(name: keyof Settings, on: boolean): Promise<boolean> {
    await this.#deps.store.set(SETTINGS_KEY, { ...(await this.#settings()), [name]: on });
    return true;
  }

  /** Deletes the saved logins of `project`. */
  async #forget(project: string): Promise<boolean> {
    await this.#deps.store.remove(loginsKey(project));
    return true;
  }

  /**
   * The settings for a frame on a lane, `null` for any other frame, or `'no-view'`
   * while the background has no view from devlanes to tell.
   */
  async #lane(sender: Sender): Promise<Settings | null | 'no-view'> {
    if (await this.#place(sender)) {
      return this.#settings();
    }
    // Without a view, no hostname is known yet, and the frame asks again later.
    return (await this.#deps.view()) ? null : 'no-view';
  }

  /** A token for the menu frame when there are logins to offer, else `null`. */
  async #menu(sender: Sender): Promise<string | null> {
    const place = await this.#place(sender);
    const tabId = sender.tab?.id;
    if (!place || tabId === undefined || !(await this.#settings()).fill) {
      return null;
    }
    if ((await this.#records(place.project)).length === 0) {
      return null;
    }
    const now = this.#deps.now();
    for (const [token, pending] of this.#tokens) {
      if (pending.expires <= now) {
        this.#tokens.delete(token);
      }
    }
    const token = this.#deps.token();
    this.#tokens.set(token, { tabId, project: place.project, expires: now + TOKEN_TTL });
    return token;
  }

  /**
   * The logins for the menu frame that holds `token`. A token works once, and only
   * for a menu page in the tab it was made for.
   */
  async #claim(sender: Sender, token: string): Promise<Claimed | null> {
    const pending = this.#tokens.get(token);
    if (!pending || !this.#isPage(sender, '/menu.html') || sender.tab?.id !== pending.tabId) {
      return null;
    }
    this.#tokens.delete(token);
    if (pending.expires <= this.#deps.now() || !(await this.#settings()).fill) {
      return null;
    }
    return { project: pending.project, logins: listed(await this.#records(pending.project)) };
  }

  /** The login of `username` to fill, marked as used on the sender's lane. */
  async #get(
    sender: Sender,
    username: string
  ): Promise<{ username: string; password: string } | null> {
    const place = await this.#place(sender);
    if (!place || !(await this.#settings()).fill) {
      return null;
    }
    const records = await this.#records(place.project);
    const record = records.find((each) => each.username === username);
    if (!record) {
      return null;
    }
    await this.#write(place.project, touch(records, username, place.lane, this.#deps.now()));
    return { username: record.username, password: record.password };
  }

  /** Saves a submitted login for the sender's project, unless remembering is off. */
  async #save(sender: Sender, username: string, password: string): Promise<boolean> {
    const place = await this.#place(sender);
    if (!place || !savable(username, password) || !(await this.#settings()).remember) {
      return false;
    }
    const records = await this.#records(place.project);
    const login = { username, password, lane: place.lane };
    await this.#write(place.project, remember(records, login, this.#deps.now()));
    return true;
  }

  /** Runs `task` after every task queued before it. */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The project and lane of the sender's frame, when it is a content script of
   * this extension on an HTTPS lane route. `origin` is the frame's own origin,
   * which also covers the `about:blank` frames `match_origin_as_fallback` reaches.
   */
  async #place(sender: Sender): Promise<Place | undefined> {
    if (sender.id !== this.#deps.extensionId || sender.tab?.id === undefined) {
      return undefined;
    }
    const origin = sender.origin ?? sender.url;
    if (!origin || !URL.canParse(origin)) {
      return undefined;
    }
    const url = new URL(origin);
    const view = await this.#deps.view();
    if (url.protocol !== 'https:' || !view) {
      return undefined;
    }
    const at = findRoute(view, url.hostname);
    return at && { project: at.project.name, lane: at.lane.ref };
  }

  /**
   * True when `sender` is this extension's page at `path`, such as `/menu.html`.
   * Content scripts send with the page's URL, so they can't pass for one. The
   * host may be a dynamic id.
   */
  #isPage(sender: Sender, path: string): boolean {
    if (sender.id !== this.#deps.extensionId || !sender.url || !URL.canParse(sender.url)) {
      return false;
    }
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.pathname === path;
  }

  /** The current settings. */
  async #settings(): Promise<Settings> {
    return parseSettings(await this.#deps.store.get(SETTINGS_KEY));
  }

  /** The saved logins of `project`, newest first. */
  async #records(project: string): Promise<LoginRecord[]> {
    return parseRecords(await this.#deps.store.get(loginsKey(project)));
  }

  /** Replaces the saved logins of `project`. */
  async #write(project: string, records: LoginRecord[]): Promise<void> {
    await this.#deps.store.set(loginsKey(project), records);
  }
}
