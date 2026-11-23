import {
  array,
  boolean,
  count,
  has,
  nullableString,
  object,
  oneOf,
  ProtocolError,
  string
} from './read';
import { parseView, type View } from './view';

/** The protocol version this extension speaks, sent in `hello`. */
export const PROTOCOL_VERSION = 1;

/** The native messaging host name `devlanes setup --browser` registers. */
export const HOST_NAME = 'run.devlanes.browser';

/** `hello` params. */
export interface HelloParams {
  protocol: number;
  /** The extension's own version. */
  extension: string;
}

/** `use` and `stop_and_use` params. `box: null` means this machine. */
export interface UseParams {
  lane: string;
  box: string | null;
}

/** A request from the extension. The host allows these methods and no others. */
export type Request =
  | { id: number; method: 'hello'; params: HelloParams }
  | { id: number; method: 'watch' }
  | { id: number; method: 'use'; params: UseParams }
  | { id: number; method: 'stop_and_use'; params: UseParams };

/** Whether the host reaches a daemon it can work with. */
export type DaemonState = 'running' | 'stopped' | 'outdated';

const DAEMON_STATES: readonly DaemonState[] = ['running', 'stopped', 'outdated'];

/** `hello`'s result. */
export interface HelloResult {
  protocol: number;
  /** The devlanes version of the host. */
  devlanes: string;
  daemon: DaemonState;
}

/** `watch`'s result. The view follows as events. */
export type WatchResult = Record<string, never>;

/** What a pending choice waits for: the box to connect, or this machine to mirror its lane. */
export type WaitsFor = 'connect' | 'mirror';

const WAITS_FOR: readonly WaitsFor[] = ['connect', 'mirror'];

/** The result of `use` and `stop_and_use`. `box` and `previous` are `null` for this machine. */
export interface UseResult {
  lane: string;
  box: string | null;
  previous: string | null;
  mirrored: boolean;
  pending: boolean;
  waits_for: WaitsFor | null;
}

/** What keeps a local lane's ports: its processes, or only its containers. */
export type Holds = 'processes' | 'containers';

const HOLDS: readonly Holds[] = ['processes', 'containers'];

/**
 * Error codes protocol 1 defines without `data`. A plain error may also carry a
 * code a newer host added.
 */
export type PlainErrorCode =
  | 'hello_required'
  | 'invalid_request'
  | 'unknown_method'
  | 'box_unknown'
  | 'lane_not_on_box'
  | 'local_lane_unknown';

/** `local_lane_running`'s data. `commands` free the ports, one shell command each. */
export interface LocalLaneRunning {
  holds: Holds;
  local_lane: string;
  commands: string[];
}

/** An error the popup only shows by its `message`. */
export interface PlainError {
  code: PlainErrorCode | (string & {});
  message: string;
}

/**
 * An error reply's `error`. `message` is ready to show as it is. Codes whose
 * `data` the popup acts on are parsed strictly, and every other code is a
 * {@link PlainError}.
 */
export type HostError =
  | { code: 'protocol_mismatch'; message: string; data: { supported: number[] } }
  | { code: 'local_lane_running'; message: string; data: LocalLaneRunning }
  | { code: 'containers_hold_ports'; message: string; data: { commands: string[] } }
  | { code: 'daemon_failed'; message: string; data: { code: string } }
  | PlainError;

/** A daemon state change, with a sentence to show when the daemon isn't usable. */
export interface DaemonStatus {
  state: DaemonState;
  message?: string;
}

/** A `remote.warning` the popup shows. `from` and `to` are `null` for this machine. */
export type Notice =
  | { code: 'lane_switched'; lane: string; from: string | null; to: string | null; message: string }
  | { code: 'choice_cleared'; lane: string; local_lane: string; holds: Holds; message: string };

/** An event the host sends after `watch`. */
export type HostEvent =
  | { event: 'view'; data: View }
  | { event: 'daemon'; data: DaemonStatus }
  | { event: 'notice'; data: Notice };

/**
 * An event or notice a newer host added. The extension drops it, since devlanes
 * and the extension ship separately.
 */
export interface Ignored {
  ignored: true;
}

/** A successful reply. Read `result` with the parser for the request's method. */
export interface Reply {
  id: number;
  result: unknown;
}

/** An error reply. */
export interface ErrorReply {
  id: number;
  error: HostError;
}

/** Anything the host sends. */
export type HostMessage = Reply | ErrorReply | HostEvent | Ignored;

/**
 * Reads one message from the host. Replies keep `result` unchecked, since only
 * the caller knows which method the `id` belongs to. Unknown fields are dropped,
 * and an unknown event or notice code reads as {@link Ignored}. Throws
 * {@link ProtocolError} when a field protocol 1 defines has the wrong shape.
 */
export function parseHostMessage(value: unknown): HostMessage {
  const message = object(value, '$');
  if (has(message, 'event')) {
    return parseEvent(message.event, message.data);
  }
  const id = count(message.id, '$.id');
  if (has(message, 'error')) {
    return { id, error: parseError(message.error, '$.error') };
  }
  if (!has(message, 'result')) {
    throw new ProtocolError('$', 'a reply with result or error, or an event');
  }
  return { id, result: message.result };
}

/** Reads `hello`'s result. */
export function parseHelloResult(value: unknown): HelloResult {
  const result = object(value, '$.result');
  return {
    protocol: count(result.protocol, '$.result.protocol'),
    devlanes: string(result.devlanes, '$.result.devlanes'),
    daemon: oneOf(result.daemon, '$.result.daemon', DAEMON_STATES)
  };
}

/** Reads `watch`'s result, which is an empty object. */
export function parseWatchResult(value: unknown): WatchResult {
  object(value, '$.result');
  return {};
}

/** Reads the result of `use` or `stop_and_use`. */
export function parseUseResult(value: unknown): UseResult {
  const result = object(value, '$.result');
  return {
    lane: string(result.lane, '$.result.lane'),
    box: nullableString(result.box, '$.result.box'),
    previous: nullableString(result.previous, '$.result.previous'),
    mirrored: boolean(result.mirrored, '$.result.mirrored'),
    pending: boolean(result.pending, '$.result.pending'),
    waits_for:
      result.waits_for === null ? null : oneOf(result.waits_for, '$.result.waits_for', WAITS_FOR)
  };
}

/** Reads an event by its name. */
function parseEvent(name: unknown, data: unknown): HostEvent | Ignored {
  const event = string(name, '$.event');
  switch (event) {
    case 'view':
      return { event, data: parseView(data, '$.data') };
    case 'daemon':
      return { event, data: parseDaemonStatus(data) };
    case 'notice': {
      const notice = parseNotice(data);
      return notice ? { event, data: notice } : { ignored: true };
    }
    default:
      return { ignored: true };
  }
}

/** Reads a `daemon` event's data. A missing or `null` message reads as absent. */
function parseDaemonStatus(value: unknown): DaemonStatus {
  const data = object(value, '$.data');
  const status: DaemonStatus = { state: oneOf(data.state, '$.data.state', DAEMON_STATES) };
  if (data.message != null) {
    status.message = string(data.message, '$.data.message');
  }
  return status;
}

/** Reads a `notice` event's data, or returns `undefined` for a code it doesn't know. */
function parseNotice(value: unknown): Notice | undefined {
  const data = object(value, '$.data');
  const code = string(data.code, '$.data.code');
  if (code !== 'lane_switched' && code !== 'choice_cleared') {
    return undefined;
  }
  const lane = string(data.lane, '$.data.lane');
  const message = string(data.message, '$.data.message');
  if (code === 'lane_switched') {
    return {
      code,
      lane,
      from: nullableString(data.from, '$.data.from'),
      to: nullableString(data.to, '$.data.to'),
      message
    };
  }
  return {
    code,
    lane,
    local_lane: string(data.local_lane, '$.data.local_lane'),
    holds: oneOf(data.holds, '$.data.holds', HOLDS),
    message
  };
}

/**
 * Reads an error reply's `error`. Codes whose `data` the popup acts on must carry
 * it, and any other code reads as a plain error.
 */
function parseError(value: unknown, path: string): HostError {
  const error = object(value, path);
  const code = string(error.code, `${path}.code`);
  const message = string(error.message, `${path}.message`);
  switch (code) {
    case 'protocol_mismatch': {
      const data = object(error.data, `${path}.data`);
      return {
        code,
        message,
        data: { supported: array(data.supported, `${path}.data.supported`, count) }
      };
    }
    case 'local_lane_running': {
      const data = object(error.data, `${path}.data`);
      return {
        code,
        message,
        data: {
          holds: oneOf(data.holds, `${path}.data.holds`, HOLDS),
          local_lane: string(data.local_lane, `${path}.data.local_lane`),
          commands: array(data.commands, `${path}.data.commands`, string)
        }
      };
    }
    case 'containers_hold_ports': {
      const data = object(error.data, `${path}.data`);
      return {
        code,
        message,
        data: { commands: array(data.commands, `${path}.data.commands`, string) }
      };
    }
    case 'daemon_failed': {
      const data = object(error.data, `${path}.data`);
      return { code, message, data: { code: string(data.code, `${path}.data.code`) } };
    }
    default:
      return { code, message };
  }
}
