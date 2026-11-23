// The parsers against the canonical fixtures the devlanes host is tested with, so
// the two sides of protocol 1 read the same messages the same way.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  PROTOCOL_VERSION,
  parseHelloResult,
  parseHostMessage,
  parseUseResult,
  parseView,
  parseWatchResult
} from '../src/index';

const FIXTURES = new URL('./fixtures/', import.meta.url);

/** Reads the fixture `name` as JSON. */
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as T;
}

/** What `messages.json` holds. */
interface Messages {
  requests: { id: number; method: string; params?: Record<string, unknown> }[];
  replies: { id: number; result: unknown }[];
  events: { event: string; data: unknown }[];
  errors: { id: number; error: { code: string } }[];
}

const messages = fixture<Messages>('messages.json');

/** The result parser of each method, as the extension picks it by the request's id. */
const RESULTS: Record<string, (value: unknown) => unknown> = {
  hello: parseHelloResult,
  watch: parseWatchResult,
  use: parseUseResult,
  stop_and_use: parseUseResult
};

describe('the canonical views', () => {
  const views = readdirSync(FIXTURES).filter((name) => /^view-.*\.json$/.test(name));

  it('are all here', () => {
    assert.deepEqual(views.sort(), [
      'view-box-mirrored.json',
      'view-box-skipped.json',
      'view-local.json',
      'view-no-boxes.json',
      'view-two-boxes.json'
    ]);
  });

  for (const name of views) {
    it(`reads ${name} as it was sent`, () => {
      const view = fixture<unknown>(name);
      assert.deepEqual(parseView(view), view);
    });
  }
});

describe('the canonical messages', () => {
  it('ask only for methods the extension sends, in its protocol', () => {
    for (const request of messages.requests) {
      assert.ok(request.method in RESULTS, `${request.method} is a method the extension sends`);
    }
    const hello = messages.requests.find((request) => request.method === 'hello');
    assert.equal(hello?.params?.protocol, PROTOCOL_VERSION);
  });

  for (const reply of messages.replies) {
    const method = messages.requests.find((request) => request.id === reply.id)?.method ?? '';
    it(`reads the ${method} reply ${JSON.stringify(reply.result)}`, () => {
      const parse = RESULTS[method];
      assert.ok(parse, `reply ${reply.id} answers a request in the fixture`);
      assert.deepEqual(parseHostMessage(reply), reply);
      assert.deepEqual(parse(reply.result), reply.result);
    });
  }

  for (const event of messages.events) {
    it(`reads the ${event.event} event ${JSON.stringify(event.data).slice(0, 60)}`, () => {
      assert.deepEqual(parseHostMessage(event), event);
    });
  }

  for (const error of messages.errors) {
    it(`reads the ${error.error.code} error with its own code`, () => {
      assert.deepEqual(parseHostMessage(error), error);
    });
  }
});
