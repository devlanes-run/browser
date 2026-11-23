// A fake devlanes native host for the end-to-end tests. The browser starts it as
// `run.devlanes.browser`, so it speaks protocol 1 over native messaging framing:
// a 32-bit length in native byte order, then UTF-8 JSON.
//
// It takes the test's folder as its first argument. There it reads
// `scenario.json`, appends every request to `requests.jsonl`, and sends every
// line the test appends to `send.jsonl`. The browser's own arguments follow.

import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync
} from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('fake-host: the test folder is missing. Pass it as the first argument.\n');
  process.exit(1);
}

/** @type {import('../support/host.ts').Scenario} */
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const replies = {
  use: [...(scenario.use ?? [])],
  stop_and_use: [...(scenario.stop_and_use ?? [])]
};

/**
 * Writes one framed message to the browser.
 * @param {unknown} message
 */
function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const head = Buffer.alloc(4);
  // Native byte order: little-endian on every machine the tests run on.
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

/**
 * The reply to `use` or `stop_and_use`: the next one the scenario lists, else a switch that went through.
 * @param {'use' | 'stop_and_use'} method
 * @param {{ lane: string, box: string | null }} params
 */
function switchReply(method, params) {
  return (
    replies[method].shift() ?? {
      result: {
        lane: params.lane,
        box: params.box,
        previous: null,
        mirrored: true,
        pending: false,
        waits_for: null
      }
    }
  );
}

/**
 * Answers one request as the scenario says.
 * @param {{ id: number, method: string, params?: any }} request
 */
function answer(request) {
  if (request.method === 'hello') {
    const hello = scenario.hello ?? 'running';
    // A host that never answers leaves the extension waiting on hello.
    if (hello === 'silent') {
      return;
    }
    if (typeof hello === 'object') {
      send({ id: request.id, ...hello });
      return;
    }
    send({ id: request.id, result: { protocol: 1, devlanes: '0.0.0-e2e', daemon: hello } });
  } else if (request.method === 'watch') {
    send({ id: request.id, result: {} });
    if (scenario.view) {
      send({ event: 'view', data: scenario.view });
    }
  } else if (request.method === 'use' || request.method === 'stop_and_use') {
    send({ id: request.id, ...switchReply(request.method, request.params) });
  } else {
    send({
      id: request.id,
      error: { code: 'unknown_method', message: `${request.method} is not a method.` }
    });
  }
}

let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const size = input.readUInt32LE(0);
    if (input.length < 4 + size) {
      return;
    }
    const request = JSON.parse(input.subarray(4, 4 + size).toString('utf8'));
    input = input.subarray(4 + size);
    appendFileSync(join(dir, 'requests.jsonl'), `${JSON.stringify(request)}\n`);
    answer(request);
  }
});
// The browser closes stdin when the extension drops the port, and the host must exit then.
process.stdin.on('end', () => process.exit(0));

// Lines appended before this process started belong to an earlier connection.
const outbox = join(dir, 'send.jsonl');
let offset = existsSync(outbox) ? statSync(outbox).size : 0;
let pending = '';

/** Sends the lines the test appended to `send.jsonl` since the last look. */
function drain() {
  if (!existsSync(outbox)) {
    return;
  }
  const size = statSync(outbox).size;
  if (size <= offset) {
    return;
  }
  const fd = openSync(outbox, 'r');
  const buffer = Buffer.alloc(size - offset);
  readSync(fd, buffer, 0, buffer.length, offset);
  closeSync(fd);
  offset = size;
  pending += buffer.toString('utf8');
  const lines = pending.split('\n');
  pending = lines.pop() ?? '';
  for (const line of lines.filter(Boolean)) {
    send(JSON.parse(line));
  }
}

// Polling stands in for fs.watch, which Node documents as unreliable on network
// file systems such as NFS and SMB, where a test folder could sit.
setInterval(drain, 25);
