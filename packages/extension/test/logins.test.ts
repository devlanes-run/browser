import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lane, View } from '@devlanes/protocol';
import { Logins, type Sender } from '../src/background/logins';
import { MAX_LOGINS, parseRecords, remember } from '../src/logins';

const ID = 'konofbnhgejkgkonkleipkkpkphbfgee';

/** A local lane of `project` on `host`. */
function lane(project: string, index: number, host: string): Lane {
  return {
    ref: `${project}@${index}`,
    index,
    name: index === 0 ? 'main' : `lane${index}`,
    domain: host,
    served_by: null,
    sources: [{ box: null, state: 'running', branch: 'main', serving: true }],
    routes: [{ host, url: `https://${host}`, service: 'web', state: 'ready' }]
  };
}

const VIEW: View = {
  boxes: [],
  projects: [
    {
      name: 'acme',
      lanes: [lane('acme', 0, 'app.acme.localhost'), lane('acme', 1, 'app.acme1.localhost')]
    },
    { name: 'shop', lanes: [lane('shop', 0, 'shop.localhost')] }
  ]
};

/** A content script's sender in tab `tab` on `origin`. */
function page(origin: string, tab = 1): Sender {
  return { id: ID, origin, url: `${origin}/login`, tab: { id: tab } };
}

/** The menu frame's sender in tab `tab`, at a dynamic URL. */
function menuFrame(tab = 1): Sender {
  return { id: ID, url: 'chrome-extension://1b2c3d4e-0000/menu.html', tab: { id: tab } };
}

/** A background over an in-memory store, with a clock the test moves and `view` from the host, `null` for none yet. */
function setup(view: View | null = VIEW) {
  const store = new Map<string, unknown>();
  const clock = { now: 1_000 };
  let tokens = 0;
  const logins = new Logins({
    extensionId: ID,
    view: () => Promise.resolve(view ?? undefined),
    store: {
      get: (key) => Promise.resolve(structuredClone(store.get(key))),
      set: (key, value) => {
        store.set(key, structuredClone(value));
        return Promise.resolve();
      },
      remove: (key) => {
        store.delete(key);
        return Promise.resolve();
      }
    },
    now: () => clock.now,
    token: () => `token-${++tokens}`
  });
  const ask = (message: unknown, sender: Sender) => logins.answer(message, sender);
  return { store, clock, ask };
}

const ACME0 = 'https://app.acme.localhost';
const ACME1 = 'https://app.acme1.localhost';

describe('Logins', () => {
  it('offers a login saved on one lane on another lane of the project, and not in another project', async () => {
    const { store, clock, ask } = setup();
    const alice = { type: 'login:save', username: 'alice', password: 'pw' };
    assert.equal(await ask(alice, page(ACME0)), true);
    clock.now = 2_000;
    const get = { type: 'login:get', username: 'alice' };
    assert.deepEqual(await ask(get, page(ACME1)), { username: 'alice', password: 'pw' });
    assert.deepEqual(store.get('logins:acme'), [
      { username: 'alice', password: 'pw', lane: 'acme@1', used: 2_000 }
    ]);
    assert.equal(await ask(get, page('https://shop.localhost')), null);
    assert.equal(await ask({ type: 'login:menu' }, page('https://shop.localhost')), null);
  });

  it('answers only content scripts of this extension on HTTPS lane routes', async () => {
    const { store, ask } = setup();
    const save = { type: 'login:save', username: 'eve', password: 'pw' };
    const senders: [string, Sender][] = [
      ['a host no lane routes', page('https://other.localhost')],
      ['plain HTTP', page('http://app.acme.localhost')],
      ['another extension', { ...page(ACME0), id: 'abcdefghijklmnopabcdefghijklmnop' }],
      ['no tab', { id: ID, origin: ACME0 }],
      ['an opaque origin', { ...page(ACME0), origin: 'null', url: 'about:blank' }]
    ];
    for (const [name, sender] of senders) {
      assert.equal(await ask({ type: 'login:lane' }, sender), null, name);
      assert.equal(await ask(save, sender), false, name);
    }
    assert.equal(store.size, 0);
    assert.deepEqual(await ask({ type: 'login:lane' }, page(ACME0)), {
      fill: true,
      remember: true
    });
  });

  it('tells a frame to ask again only while it has no view', async () => {
    const lane = { type: 'login:lane' };
    assert.equal(await setup(null).ask(lane, page(ACME0)), 'no-view');
    assert.equal(await setup().ask(lane, page('https://other.localhost')), null);
  });

  it('follows the settings', async () => {
    const { store, ask } = setup();
    await ask({ type: 'login:save', username: 'alice', password: 'pw' }, page(ACME0));
    store.set('settings', { fill: true, remember: false });
    assert.equal(
      await ask({ type: 'login:save', username: 'bob', password: 'pw' }, page(ACME0)),
      false
    );
    assert.equal((store.get('logins:acme') as unknown[]).length, 1);
    store.set('settings', { fill: false, remember: true });
    assert.equal(await ask({ type: 'login:menu' }, page(ACME1)), null);
    assert.equal(await ask({ type: 'login:get', username: 'alice' }, page(ACME1)), null);
  });

  it('gives the logins without passwords to the menu frame of the tab, once per token', async () => {
    const { clock, ask } = setup();
    await ask({ type: 'login:save', username: 'alice', password: 'pw' }, page(ACME0));
    const token = await ask({ type: 'login:menu' }, page(ACME1, 7));
    assert.equal(typeof token, 'string');
    const claim = { type: 'menu:claim', token };
    assert.equal(await ask(claim, page(ACME1, 7)), null, 'a content script claimed');
    assert.equal(await ask(claim, menuFrame(8)), null, 'another tab claimed');
    assert.deepEqual(await ask(claim, menuFrame(7)), {
      project: 'acme',
      logins: [{ username: 'alice', lane: 'acme@0', used: 1_000 }]
    });
    assert.equal(await ask(claim, menuFrame(7)), null, 'a token worked twice');
    assert.equal(await ask({ type: 'menu:claim', token: 'forged' }, menuFrame(7)), null);

    const late = await ask({ type: 'login:menu' }, page(ACME1, 7));
    clock.now += 60_000;
    assert.equal(await ask({ type: 'menu:claim', token: late }, menuFrame(7)), null, 'expired');
  });

  it('keeps every login when two forms are sent at once', async () => {
    const { store, ask } = setup();
    await Promise.all(
      ['alice', 'bob', 'carol'].map((username) =>
        ask({ type: 'login:save', username, password: 'pw' }, page(ACME0))
      )
    );
    assert.equal((store.get('logins:acme') as unknown[]).length, 3);
  });

  it('takes setting changes and deletes from the popup only', async () => {
    const { store, ask } = setup();
    await ask({ type: 'login:save', username: 'alice', password: 'pw' }, page(ACME0));
    const popup: Sender = { id: ID, url: `chrome-extension://${ID}/popup.html` };
    const forget = { type: 'popup:forget', project: 'acme' };
    const off = { type: 'popup:setting', name: 'remember', on: false };
    for (const sender of [page(ACME0), menuFrame()]) {
      assert.equal(await ask(forget, sender), false);
      assert.equal(await ask(off, sender), false);
    }
    assert.ok(store.has('logins:acme'));
    assert.equal(store.get('settings'), undefined);
    assert.equal(await ask(off, popup), true);
    assert.deepEqual(store.get('settings'), { fill: true, remember: false });
    assert.equal(await ask(forget, popup), true);
    assert.equal(store.has('logins:acme'), false);
  });

  it('leaves messages that are not about logins to other listeners', () => {
    const { ask } = setup();
    for (const message of [null, 'login:lane', { type: 'use' }, {}]) {
      assert.equal(ask(message, page(ACME0)), undefined);
    }
  });
});

describe('records', () => {
  it('keeps one record per username, newest first, up to the limit', () => {
    let records = remember([], { username: 'alice', password: 'old', lane: 'acme@0' }, 1);
    records = remember(records, { username: 'bob', password: 'pw', lane: 'acme@0' }, 2);
    records = remember(records, { username: 'alice', password: 'new', lane: 'acme@1' }, 3);
    assert.deepEqual(records, [
      { username: 'alice', password: 'new', lane: 'acme@1', used: 3 },
      { username: 'bob', password: 'pw', lane: 'acme@0', used: 2 }
    ]);
    for (let used = 4; used < 4 + MAX_LOGINS; used++) {
      records = remember(
        records,
        { username: `user${used}`, password: 'pw', lane: 'acme@0' },
        used
      );
    }
    assert.equal(records.length, MAX_LOGINS);
    assert.ok(!records.some((record) => record.username === 'bob' || record.username === 'alice'));
  });

  it('drops stored entries of another shape and stray fields', () => {
    const good = { username: 'alice', password: 'pw', lane: 'acme@0', used: 5 };
    assert.deepEqual(
      parseRecords([
        { ...good, extra: 'x' },
        { username: 'bob', password: 'pw', lane: 'acme@0' },
        { username: '', password: 'pw', lane: 'acme@0', used: 1 },
        'alice',
        null
      ]),
      [good]
    );
    assert.deepEqual(parseRecords({ alice: good }), []);
  });
});
