import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from '@devlanes/protocol';
import { HostConnection, type NativePort } from '../src/background/host';
import type { Snapshot } from '../src/state';

/** A native port the test drives by hand. */
class FakePort implements NativePort {
  sent: Request[] = [];
  closed = false;
  #message: ((message: unknown) => void) | undefined;
  #disconnect: ((error: string | undefined) => void) | undefined;

  /** Records `message`. */
  postMessage(message: Request): void {
    this.sent.push(message);
  }

  /** Marks the port closed by the extension. */
  disconnect(): void {
    this.closed = true;
  }

  /** Keeps the listener. */
  onMessage(listener: (message: unknown) => void): void {
    this.#message = listener;
  }

  /** Keeps the listener. */
  onDisconnect(listener: (error: string | undefined) => void): void {
    this.#disconnect = listener;
  }

  /** Delivers `message` as if the host sent it. */
  receive(message: unknown): void {
    this.#message?.(message);
  }

  /** Ends the port as if the browser closed it with `error`. */
  lose(error: string): void {
    this.#disconnect?.(error);
  }

  /** The id of the last request with `method`. */
  idOf(method: string): number {
    const request = this.sent.findLast((sent) => sent.method === method);
    assert.ok(request, `no ${method} was sent`);
    return request.id;
  }
}

/** A connection over fake ports, with the retries it scheduled. */
function setup() {
  const ports: FakePort[] = [];
  const retries: { run: () => void; ms: number }[] = [];
  let snapshot: Snapshot | undefined;
  const host = new HostConnection({
    connect: () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    version: '0.1.0',
    onChange: (next) => {
      snapshot = next;
    },
    schedule: (run, ms) => {
      retries.push({ run, ms });
      return () => {};
    }
  });
  return { host, ports, retries, state: () => snapshot?.status.state };
}

/** Answers `hello` on `port` with a running daemon. */
function hello(port: FakePort): void {
  port.receive({
    id: port.idOf('hello'),
    result: { protocol: 1, devlanes: '0.15.0', daemon: 'running' }
  });
}

describe('HostConnection', () => {
  it('sends watch only after hello answered, then follows the daemon state', () => {
    const { host, ports, state } = setup();
    host.ensure();
    const [port] = ports;
    assert.ok(port);
    assert.deepEqual(
      port.sent.map((sent) => sent.method),
      ['hello']
    );
    hello(port);
    assert.deepEqual(
      port.sent.map((sent) => sent.method),
      ['hello', 'watch']
    );
    assert.equal(state(), 'running');
    port.receive({ event: 'daemon', data: { state: 'stopped', message: null } });
    assert.equal(state(), 'daemon_stopped');
    assert.equal(host.snapshot.devlanes, '0.15.0');
  });

  it('stops on a protocol mismatch and on a missing host, until asked again', () => {
    const { host, ports, retries, state } = setup();
    host.ensure();
    ports[0]?.receive({
      id: 1,
      error: { code: 'protocol_mismatch', message: 'Use protocol 2.', data: { supported: [2] } }
    });
    assert.equal(state(), 'protocol_mismatch');
    assert.equal(ports[0]?.closed, true);

    host.ensure();
    ports[1]?.lose('Specified native messaging host not found.');
    assert.equal(state(), 'not_installed');
    assert.equal(retries.length, 0);

    host.ensure();
    assert.equal(ports.length, 3);
  });

  it('retries a host that went away with growing delays, and resets them once hello works', () => {
    const { host, ports, retries, state } = setup();
    host.ensure();
    for (let attempt = 0; attempt < 3; attempt++) {
      ports.at(-1)?.lose('Native host has exited.');
      retries.at(-1)?.run();
    }
    assert.deepEqual(
      retries.map((retry) => retry.ms),
      [1000, 2000, 5000]
    );
    const port = ports.at(-1);
    assert.ok(port);
    hello(port);
    assert.equal(state(), 'running');
    port.lose('Native host has exited.');
    assert.equal(state(), 'host_failed');
    assert.equal(retries.at(-1)?.ms, 1000);
  });

  it('answers a use that waits when the port closes', async () => {
    const { host, ports } = setup();
    host.ensure();
    const port = ports[0];
    assert.ok(port);
    hello(port);
    const reply = host.request('stop_and_use', { lane: 'acme@0', box: 'fork-b' });
    assert.equal(port.sent.at(-1)?.method, 'stop_and_use');
    port.lose('Native host has exited.');
    const answer = await reply;
    assert.equal(answer.ok, false);
    assert.equal(!answer.ok && answer.error.code, 'disconnected');
  });
});
