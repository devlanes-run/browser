import type { HostError, Notice, UseParams, UseResult, View } from '@devlanes/protocol';

/**
 * Where the connection to devlanes stands, as the popup shows it.
 * `running` is the only state where the popup can switch boxes.
 */
export type Status =
  | { state: 'connecting' }
  | { state: 'running' }
  | { state: 'daemon_stopped'; message?: string }
  | { state: 'outdated'; message?: string }
  | { state: 'not_installed' }
  | { state: 'not_allowed' }
  | { state: 'protocol_mismatch'; supported: number[] }
  | { state: 'host_failed'; detail: string };

/** A `lane_switched` notice, with the number the popup dismisses it by. */
export interface Shown {
  id: number;
  notice: Extract<Notice, { code: 'lane_switched' }>;
}

/** Everything the popup renders, as the background last saw it. */
export interface Snapshot {
  status: Status;
  /** The devlanes version of the host, once `hello` answered. */
  devlanes?: string;
  /** The last view, kept while the daemon or the host is away. */
  view?: View;
  notices: Shown[];
}

/** The two requests that switch the box of a lane. */
export type UseMethod = 'use' | 'stop_and_use';

/** The error a request gets when the port to the host closed or never opened. */
export interface Disconnected {
  code: 'disconnected';
  message: string;
}

/** The answer to `use` or `stop_and_use`. */
export type UseReply =
  | { ok: true; result: UseResult }
  | { ok: false; error: HostError | Disconnected };

/** What the popup sends the background over its port. */
export type PopupMessage =
  | { type: 'use'; id: number; method: UseMethod; params: UseParams }
  | { type: 'dismiss'; notice: number };

/** What the background sends the popup over its port. */
export type BackgroundMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'reply'; id: number; reply: UseReply };

/** The name of the port the popup opens to the background. */
export const POPUP_PORT = 'popup';

/**
 * The `chrome.storage.session` key of the last snapshot. The background writes it
 * on every change. The popup reads it to paint before the background answers.
 */
export const SNAPSHOT_KEY = 'snapshot';

/** What the popup shows before any snapshot arrives. */
export const CONNECTING: Snapshot = { status: { state: 'connecting' }, notices: [] };
