import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lane, Route, View } from '@devlanes/protocol';
import { findRoute, pageIn } from '../src/lanes';

/** A route of `service` on `host`, served over HTTPS on the proxy's default port. */
function route(host: string, service: string): Route {
  return { host, url: `https://${host}`, service, state: 'ready' };
}

/** A local lane of acme with `routes`. */
function lane(index: number, routes: Route[]): Lane {
  return {
    ref: `acme@${index}`,
    index,
    name: index === 0 ? 'main' : `lane${index}`,
    domain: index === 0 ? 'acme.localhost' : `acme${index}.localhost`,
    served_by: null,
    sources: [{ box: null, state: 'running', branch: 'main', serving: true }],
    routes
  };
}

const MAIN = lane(0, [
  route('app.acme.localhost', 'web'),
  route('admin.acme.localhost', 'web'),
  route('api.acme.localhost', 'api'),
  route('*.sites.acme.localhost', 'sites'),
  route('*.acme.localhost', 'gateway')
]);
const LANE1 = lane(1, [
  route('app.acme1.localhost', 'web'),
  route('admin.acme1.localhost', 'web'),
  route('*.sites.acme1.localhost', 'sites'),
  route('*.acme1.localhost', 'gateway')
]);
const BARE = lane(2, [route('docs.acme2.localhost', 'docs')]);
const VIEW: View = { boxes: [], projects: [{ name: 'acme', lanes: [MAIN, LANE1, BARE] }] };

describe('findRoute', () => {
  for (const [hostname, ref, host] of [
    ['app.acme.localhost', 'acme@0', 'app.acme.localhost'],
    ['APP.acme.localhost', 'acme@0', 'app.acme.localhost'],
    ['t1.sites.acme.localhost', 'acme@0', '*.sites.acme.localhost'],
    ['other.acme.localhost', 'acme@0', '*.acme.localhost'],
    ['app.acme1.localhost', 'acme@1', 'app.acme1.localhost']
  ] as const) {
    it(`finds ${host} for ${hostname}`, () => {
      const at = findRoute(VIEW, hostname);
      assert.equal(at?.lane.ref, ref);
      assert.equal(at?.route.host, host);
    });
  }

  it('finds nothing for a host no lane routes, or the bare wildcard base', () => {
    assert.equal(findRoute(VIEW, 'shop.localhost'), undefined);
    assert.equal(findRoute(VIEW, 'sites.acme.localhost')?.route.host, '*.acme.localhost');
    assert.equal(findRoute(VIEW, 'acme.localhost'), undefined);
  });
});

describe('pageIn', () => {
  for (const [page, target, expected] of [
    [
      'https://app.acme.localhost/orders/7?tab=items#total',
      LANE1,
      'https://app.acme1.localhost/orders/7?tab=items#total'
    ],
    ['https://admin.acme.localhost/users', LANE1, 'https://admin.acme1.localhost/users'],
    ['https://t1.sites.acme.localhost/about', LANE1, 'https://t1.sites.acme1.localhost/about'],
    ['https://a.b.acme.localhost/x', LANE1, 'https://a.b.acme1.localhost/x'],
    // acme@1 has no api route, so the page opens on its first route, at that route's own path.
    ['https://api.acme.localhost/v1/orders', LANE1, 'https://app.acme1.localhost'],
    ['https://app.acme1.localhost/orders', MAIN, 'https://app.acme.localhost/orders'],
    ['https://app.acme.localhost/orders', BARE, 'https://docs.acme2.localhost']
  ] as const) {
    it(`maps ${page} to ${target.ref}`, () => {
      const url = new URL(page);
      const from = findRoute(VIEW, url.hostname);
      assert.ok(from);
      assert.equal(pageIn(from, url, target), expected);
    });
  }

  it('keeps the port of the target route', () => {
    const target = lane(3, [
      {
        host: 'app.acme3.localhost',
        url: 'https://app.acme3.localhost:8443',
        service: 'web',
        state: 'ready'
      }
    ]);
    const url = new URL('https://app.acme.localhost/a?b=1');
    const from = findRoute(VIEW, url.hostname);
    assert.ok(from);
    assert.equal(pageIn(from, url, target), 'https://app.acme3.localhost:8443/a?b=1');
  });

  it('gives nothing for a lane that routes only wildcards for other services', () => {
    const target = lane(4, [route('*.acme4.localhost', 'gateway')]);
    const url = new URL('https://app.acme.localhost/a');
    const from = findRoute(VIEW, url.hostname);
    assert.ok(from);
    assert.equal(pageIn(from, url, target), undefined);
  });
});
