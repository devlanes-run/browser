import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lane, Route, View } from '@devlanes/protocol';
import { badgeFor, findRoute, pageIn } from '../src/lanes';

/** A route of `service` on `host`, served over HTTPS on the proxy's default port. */
function route(host: string, service: string): Route {
  // A wildcard route has no single URL, so the host sends `null`, as in the contract.
  return { host, url: host.startsWith('*.') ? null : `https://${host}`, service, state: 'ready' };
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
    ['app.acme.localhost.', 'acme@0', 'app.acme.localhost'],
    ['t1.sites.acme.localhost.', 'acme@0', '*.sites.acme.localhost'],
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
    ['https://t1.sites.acme.localhost./about', LANE1, 'https://t1.sites.acme1.localhost/about'],
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

  it("maps a wildcard page with the page's own port, since a wildcard route has no URL", () => {
    const tenant = new URL('https://t1.sites.acme.localhost:8443/about?x=1#y');
    const from = findRoute(VIEW, tenant.hostname);
    assert.ok(from);
    assert.equal(pageIn(from, tenant, LANE1), 'https://t1.sites.acme1.localhost:8443/about?x=1#y');
  });

  it('never opens a route whose URL is not a web URL', () => {
    const target = lane(5, [
      { host: 'app.acme5.localhost', url: 'javascript:alert(1)', service: 'web', state: 'ready' }
    ]);
    const url = new URL('https://app.acme.localhost/a');
    const from = findRoute(VIEW, url.hostname);
    assert.ok(from);
    assert.equal(pageIn(from, url, target), undefined);

    const wild = lane(6, [
      {
        host: '*.sites.acme6.localhost',
        url: 'javascript:alert(1)',
        service: 'sites',
        state: 'ready'
      }
    ]);
    const tenant = new URL('https://t1.sites.acme.localhost/about');
    const fromTenant = findRoute(VIEW, tenant.hostname);
    assert.ok(fromTenant);
    assert.equal(pageIn(fromTenant, tenant, wild), undefined);
  });

  it('gives nothing for a lane that routes only wildcards for other services', () => {
    const target = lane(4, [route('*.acme4.localhost', 'gateway')]);
    const url = new URL('https://app.acme.localhost/a');
    const from = findRoute(VIEW, url.hostname);
    assert.ok(from);
    assert.equal(pageIn(from, url, target), undefined);
  });
});

describe('badgeFor', () => {
  /** A one-lane view where `served_by` is set as given, or left out for `'missing'`. */
  function servedBy(by: string | null | 'missing'): View {
    const shaped = lane(2, [route('app.acme2.localhost', 'web')]);
    if (by === 'missing') {
      delete shaped.served_by;
    } else {
      shaped.served_by = by;
    }
    return { boxes: [], projects: [{ name: 'acme', lanes: [shaped] }] };
  }

  for (const [by, text, title, box] of [
    [null, '2', 'acme@2 lane2, served by this machine', undefined],
    ['fork-a', '2\u2022', 'acme@2 lane2, served by fork-a', 'fork-a'],
    ['missing', '2', 'acme@2 lane2. Nothing serves it.', undefined]
  ] as const) {
    it(`marks a lane served by ${by}`, () => {
      assert.deepEqual(badgeFor(servedBy(by), 'https://app.acme2.localhost/cart'), {
        text,
        title,
        box
      });
    });
  }

  it('shows nothing for a tab no lane routes', () => {
    assert.equal(badgeFor(servedBy(null), 'https://shop.localhost/'), undefined);
    assert.equal(badgeFor(servedBy(null), 'chrome://newtab/'), undefined);
  });
});
