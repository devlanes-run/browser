import {
  type ErrorReply,
  type HostMessage,
  PROTOCOL_VERSION,
  parseHelloResult,
  parseHostMessage,
  parseUseResult,
  type Reply,
  type Request,
  type UseParams
} from '@devlanes/protocol';
import type { Disconnected, Shown, Snapshot, Status, UseMethod, UseReply } from '../state';

/** A native messaging port, as the background uses it. */
export interface NativePort {
  postMessage(message: Request): void;
  disconnect(): void;
  onMessage(listener: (message: unknown) => void): void;
  /** `error` is the browser's reason, such as "Specified native messaging host not found." */
  onDisconnect(listener: (error: string | undefined) => void): void;
}

/** What {@link HostConnection} needs from the browser. */
export interface HostDeps {
  /** Opens a new port to the native host. */
  connect(): NativePort;
  /** The extension's version, sent in `hello`. */
  version: string;
  /** Called after every change of the snapshot. */
  onChange(snapshot: Snapshot): void;
  /** Runs `run` after `ms` and returns a function that cancels it. */
  schedule(run: () => void, ms: number): () => void;
}

/** Seconds between reconnects, growing with each failure and staying at the last one. */
const BACKOFF = [1, 2, 5, 10, 30];

/**
 * Chrome's reason when no manifest registers the host. Chrome gives native
 * messaging errors as English messages only, with no codes.
 */
export const HOST_NOT_FOUND = 'Specified native messaging host not found.';

/** How many `lane_switched` notices the popup keeps. */
const NOTICES = 5;

const DISCONNECTED: Disconnected = {
  code: 'disconnected',
  message: "The extension isn't connected to devlanes. Reopen this popup and try again."
};

/** A request waiting for its reply. */
type Pending =
  | { method: 'hello' | 'watch' }
  | { method: UseMethod; resolve: (reply: UseReply) => void };

/**
 * The port to the devlanes native host: `hello`, then `watch`, then the view and
 * the daemon state as they change. It reconnects with backoff after the host
 * goes away. It doesn't retry a missing host or a protocol mismatch, since only
 * a new install fixes those, and the popup asks again when it opens.
 */
export class HostConnection {
  #deps: HostDeps;
  #port: NativePort | undefined;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #failures = 0;
  #cancelRetry: (() => void) | undefined;
  #nextNotice = 1;
  #snapshot: Snapshot = { status: { state: 'connecting' }, notices: [] };

  /** @param deps The browser parts, so tests can stand in for the native port. */
  constructor(deps: HostDeps) {
    this.#deps = deps;
  }

  /** What the popup should show now. */
  get snapshot(): Snapshot {
    return this.#snapshot;
  }

  /**
   * Takes back what a previous service worker saved, for the fields the host
   * hasn't sent again yet.
   */
  restore(saved: Omit<Snapshot, 'status'>): void {
    const current = this.#snapshot;
    const notices = current.notices.length > 0 ? current.notices : saved.notices;
    this.#nextNotice = Math.max(this.#nextNotice, ...notices.map((shown) => shown.id + 1));
    const view = current.view ?? saved.view;
    const devlanes = current.devlanes ?? saved.devlanes;
    this.#update({
      notices,
      ...(view && { view }),
      ...(devlanes !== undefined && { devlanes })
    });
  }

  /** Connects now unless a port is already open. A pending retry is replaced. */
  ensure(): void {
    if (this.#port) {
      return;
    }
    this.#cancelRetry?.();
    this.#cancelRetry = undefined;
    const port = this.#deps.connect();
    this.#port = port;
    port.onMessage((message) => this.#receive(port, message));
    port.onDisconnect((error) => this.#lost(port, error));
    // The status stays as it was until the host answers, so a popup that opens on a
    // missing host shows that at once instead of flashing "connecting" first.
    const id = this.#nextId++;
    this.#pending.set(id, { method: 'hello' });
    port.postMessage({
      id,
      method: 'hello',
      params: { protocol: PROTOCOL_VERSION, extension: this.#deps.version }
    });
  }

  /** Sends `use` or `stop_and_use`. The reply comes when the host answers or the port closes. */
  request(method: UseMethod, params: UseParams): Promise<UseReply> {
    const port = this.#port;
    if (!port || this.#snapshot.status.state !== 'running') {
      return Promise.resolve({ ok: false, error: DISCONNECTED });
    }
    return new Promise((resolve) => {
      const id = this.#nextId++;
      this.#pending.set(id, { method, resolve });
      port.postMessage({ id, method, params });
    });
  }

  /** Drops the notice the popup closed. */
  dismiss(id: number): void {
    this.#update({ notices: this.#snapshot.notices.filter((shown) => shown.id !== id) });
  }

  /** Handles one message from `port`. Messages from a port that was replaced are dropped. */
  #receive(port: NativePort, raw: unknown): void {
    if (port !== this.#port) {
      return;
    }
    let message: HostMessage;
    try {
      message = parseHostMessage(raw);
    } catch (error) {
      this.#malformed(port, raw, error);
      return;
    }
    if ('ignored' in message) {
      return;
    }
    if ('event' in message) {
      if (message.event === 'view') {
        this.#update({ view: message.data });
      } else if (message.event === 'daemon') {
        this.#setStatus(daemonStatus(message.data.state, message.data.message));
      } else if (message.data.code === 'lane_switched') {
        const shown: Shown = { id: this.#nextNotice++, notice: message.data };
        this.#update({ notices: [shown, ...this.#snapshot.notices].slice(0, NOTICES) });
      }
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) {
      return;
    }
    this.#pending.delete(message.id);
    if (pending.method === 'hello') {
      this.#hello(port, message);
    } else if (pending.method === 'watch') {
      if ('error' in message) {
        this.#fail(port, message.error.message);
      }
    } else if ('resolve' in pending) {
      pending.resolve(useReply(message));
    }
  }

  /**
   * Handles a message that doesn't parse. A broken event is dropped, so one bad
   * view doesn't cost the connection. A broken reply still ends its request,
   * since its caller would wait forever otherwise.
   */
  #malformed(port: NativePort, raw: unknown, error: unknown): void {
    console.error('The devlanes host sent a message protocol 1 does not define.', error);
    const id =
      typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'number'
        ? raw.id
        : undefined;
    const pending = id === undefined ? undefined : this.#pending.get(id);
    if (id === undefined || !pending) {
      return;
    }
    this.#pending.delete(id);
    if ('resolve' in pending) {
      pending.resolve({
        ok: false,
        error: { code: 'unknown', host_code: 'invalid_reply', message: String(error) }
      });
    } else {
      this.#fail(port, String(error));
    }
  }

  /** Reads `hello`'s reply, then starts `watch`, or closes the port when `hello` failed. */
  #hello(port: NativePort, message: Reply | ErrorReply): void {
    if ('error' in message) {
      const { error } = message;
      if (error.code === 'protocol_mismatch') {
        this.#close(port);
        this.#setStatus({ state: 'protocol_mismatch', supported: error.data.supported });
      } else {
        this.#fail(port, error.message);
      }
      return;
    }
    let daemon: 'running' | 'stopped' | 'outdated';
    try {
      const hello = parseHelloResult(message.result);
      daemon = hello.daemon;
      this.#update({ devlanes: hello.devlanes });
    } catch (error) {
      this.#fail(port, String(error));
      return;
    }
    this.#failures = 0;
    this.#setStatus(daemonStatus(daemon));
    const id = this.#nextId++;
    this.#pending.set(id, { method: 'watch' });
    port.postMessage({ id, method: 'watch' });
  }

  /** Handles the end of `port`, then retries unless only a new install can help. */
  #lost(port: NativePort, error: string | undefined): void {
    if (port !== this.#port) {
      return;
    }
    this.#port = undefined;
    this.#failPending();
    if (error === HOST_NOT_FOUND) {
      this.#setStatus({ state: 'not_installed' });
      return;
    }
    this.#retryLater(error ?? 'The host closed the connection.');
  }

  /** Closes `port` after the host answered something unusable, then retries later. */
  #fail(port: NativePort, detail: string): void {
    this.#close(port);
    this.#retryLater(detail);
  }

  /** Sets `host_failed` and schedules the next connect, waiting longer after each failure. */
  #retryLater(detail: string): void {
    console.warn('The connection to the devlanes host failed.', detail);
    this.#setStatus({ state: 'host_failed', detail });
    const delay = BACKOFF[Math.min(this.#failures, BACKOFF.length - 1)] ?? 30;
    this.#failures++;
    this.#cancelRetry = this.#deps.schedule(() => {
      this.#cancelRetry = undefined;
      this.ensure();
    }, delay * 1000);
  }

  /** Closes `port` on purpose. The browser doesn't call `onDisconnect` for that. */
  #close(port: NativePort): void {
    port.disconnect();
    this.#port = undefined;
    this.#failPending();
  }

  /** Answers every waiting `use` with {@link DISCONNECTED}. */
  #failPending(): void {
    for (const pending of this.#pending.values()) {
      if ('resolve' in pending) {
        pending.resolve({ ok: false, error: DISCONNECTED });
      }
    }
    this.#pending.clear();
  }

  /** Sets the status, keeping the rest of the snapshot. */
  #setStatus(status: Status): void {
    this.#update({ status });
  }

  /** Merges `change` into the snapshot and reports it. */
  #update(change: Partial<Snapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    this.#deps.onChange(this.#snapshot);
  }
}

/** The status for a daemon state the host reported. */
function daemonStatus(state: 'running' | 'stopped' | 'outdated', message?: string): Status {
  if (state === 'running') {
    return { state };
  }
  const status = { state: state === 'stopped' ? 'daemon_stopped' : 'outdated' } as const;
  return message === undefined ? status : { ...status, message };
}

/** Reads the reply to `use` or `stop_and_use`. */
function useReply(message: Reply | ErrorReply): UseReply {
  if ('error' in message) {
    return { ok: false, error: message.error };
  }
  try {
    return { ok: true, result: parseUseResult(message.result) };
  } catch (error) {
    return {
      ok: false,
      error: { code: 'unknown', host_code: 'invalid_reply', message: String(error) }
    };
  }
}
