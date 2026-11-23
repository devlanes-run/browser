// The saved logins and their settings, as `chrome.storage.local` holds them, and
// the messages the content script and the menu send the background about them.

/** The login settings of this browser. Both are on until someone turns them off. */
export interface Settings {
  /** Offer the project's saved logins on lane pages. */
  fill: boolean;
  /** Save the username and password of a login form when it is submitted. */
  remember: boolean;
}

/** The `chrome.storage.local` key of {@link Settings}. */
export const SETTINGS_KEY = 'settings';

/** The settings before anyone changed them. */
export const DEFAULT_SETTINGS: Settings = { fill: true, remember: true };

/** The prefix of the `chrome.storage.local` keys that hold a project's logins. */
export const LOGINS_PREFIX = 'logins:';

/** One saved login of a project. */
export interface LoginRecord {
  username: string;
  password: string;
  /** The lane the login was last submitted or filled on, such as `acme@1`. */
  lane: string;
  /** When the login was last submitted or filled, in milliseconds since the epoch. */
  used: number;
}

/** A saved login as the menu shows it, without its password. */
export type Listed = Omit<LoginRecord, 'password'>;

/** How many logins a project keeps. The least recently used goes first. */
export const MAX_LOGINS = 20;

/** The longest username and password the extension saves, so one form can't fill the storage. */
const MAX_LENGTH = 1024;

/** The `chrome.storage.local` key of the logins of `project`. */
export function loginsKey(project: string): string {
  return `${LOGINS_PREFIX}${project}`;
}

/** The project of a `chrome.storage.local` key, or `undefined` when the key holds no logins. */
export function projectOf(key: string): string | undefined {
  return key.startsWith(LOGINS_PREFIX) ? key.slice(LOGINS_PREFIX.length) : undefined;
}

/** Reads stored settings. A missing or broken value keeps its default. */
export function parseSettings(value: unknown): Settings {
  const stored = typeof value === 'object' && value !== null ? (value as Partial<Settings>) : {};
  return {
    fill: typeof stored.fill === 'boolean' ? stored.fill : DEFAULT_SETTINGS.fill,
    remember: typeof stored.remember === 'boolean' ? stored.remember : DEFAULT_SETTINGS.remember
  };
}

/**
 * True when `username` and `password` are worth saving. An empty username has
 * nothing to offer in the menu, and an empty password is a form sent half filled.
 */
export function savable(username: string, password: string): boolean {
  return (
    username.trim().length > 0 &&
    password.length > 0 &&
    username.length <= MAX_LENGTH &&
    password.length <= MAX_LENGTH
  );
}

/**
 * Reads the stored logins of a project, newest first. Entries of another shape are
 * dropped, so a value an older build wrote never breaks the menu.
 */
export function parseRecords(value: unknown): LoginRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const records = value.filter(
    (entry): entry is LoginRecord =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.username === 'string' &&
      typeof entry.password === 'string' &&
      typeof entry.lane === 'string' &&
      typeof entry.used === 'number' &&
      savable(entry.username, entry.password)
  );
  return newestFirst(
    records.map(({ username, password, lane, used }) => ({ username, password, lane, used }))
  );
}

/** `records` sorted by when they were last used, newest first. */
function newestFirst<T extends { used: number }>(records: T[]): T[] {
  return [...records].sort((a, b) => b.used - a.used);
}

/**
 * `records` with `login` saved as the newest. A username has one record per
 * project, so a new password on any lane replaces the old one.
 */
export function remember(
  records: LoginRecord[],
  login: Omit<LoginRecord, 'used'>,
  now: number
): LoginRecord[] {
  const others = records.filter((record) => record.username !== login.username);
  return newestFirst([{ ...login, used: now }, ...others]).slice(0, MAX_LOGINS);
}

/** `records` with the login of `username` marked as used now on `lane`. */
export function touch(
  records: LoginRecord[],
  username: string,
  lane: string,
  now: number
): LoginRecord[] {
  return newestFirst(
    records.map((record) =>
      record.username === username ? { ...record, lane, used: now } : record
    )
  );
}

/** `records` as the menu lists them, without passwords. */
export function listed(records: LoginRecord[]): Listed[] {
  return records.map(({ username, lane, used }) => ({ username, lane, used }));
}

/** What a content script asks the background. The background reads the page from the sender. */
export type ContentRequest =
  /** Answered with {@link Settings} when the frame is on a lane route, else `null`. */
  | { type: 'login:lane' }
  /** Answered with a menu token when the menu has logins to show, else `null`. */
  | { type: 'login:menu' }
  /** Answered with the username and password to fill, else `null`. */
  | { type: 'login:get'; username: string }
  /** Answered with `true` when the login was saved. */
  | { type: 'login:save'; username: string; password: string };

/** What the menu frame asks the background: the logins for the token its content script sent it. */
export interface MenuRequest {
  type: 'menu:claim';
  token: string;
}

/** The background's answer to a valid `menu:claim`. */
export interface Claimed {
  project: string;
  logins: Listed[];
}

/** What the background sends the content scripts of lane tabs when the settings change. */
export interface SettingsChanged {
  type: 'login:settings';
  settings: Settings;
}

/** What the content script sends the menu frame over their private channel. */
export type ToMenu =
  /** Highlights the login at `index`, or none at -1. */
  | { type: 'select'; index: number }
  /** Picks the highlighted login, as Enter in the page's field does. */
  | { type: 'choose' };

/** What the menu frame sends its content script over their private channel. */
export type FromMenu =
  /** The menu rendered `count` logins and needs `height` CSS pixels. */
  | { type: 'ready'; count: number; height: number }
  /** The pointer or the menu's own keys moved the highlight. */
  | { type: 'hover'; index: number }
  /** Someone picked the login of `username`. */
  | { type: 'pick'; username: string }
  /** Someone pressed Escape inside the menu, or the menu has nothing to show. */
  | { type: 'close' };

/**
 * The first message the content script posts to the menu frame. It carries the
 * channel's port. The menu trusts the port only after the background accepts
 * `token`, since the page can post the frame a message of the same shape.
 */
export interface MenuHello {
  devlanes: 'menu';
  token: string;
}
