// Views the fake host sends, after the examples in the native host contract.

import type { Lane, Route, Source, View } from '@devlanes/protocol';

/** A ready route of `service` on `host`. The native host sends a wildcard route with no URL. */
export function route(host: string, service: string): Route {
  return { host, url: host.startsWith('*.') ? null : `https://${host}`, service, state: 'ready' };
}

/** This machine's source of a lane. */
export function local(serving = true): Source {
  return { box: null, state: 'running', branch: 'main', serving };
}

/** A lane of `project`, named by the contract's rule, served by this machine unless `parts` says otherwise. */
export function lane(project: string, index: number, parts: Partial<Lane> = {}): Lane {
  return {
    ref: `${project}@${index}`,
    index,
    name: index === 0 ? 'main' : `lane${index}`,
    domain: index === 0 ? `${project}.localhost` : `${project}${index}.localhost`,
    served_by: null,
    sources: [local()],
    routes: [],
    ...parts
  };
}

/** Two acme lanes with a web and an api route each, and one shop lane. Only this machine serves them. */
export const LOCAL: View = {
  boxes: [],
  projects: [
    {
      name: 'acme',
      lanes: [
        lane('acme', 0, {
          routes: [route('app.acme.localhost', 'web'), route('api.acme.localhost', 'api')]
        }),
        lane('acme', 1, {
          routes: [route('app.acme1.localhost', 'web'), route('api.acme1.localhost', 'api')]
        })
      ]
    },
    { name: 'shop', lanes: [lane('shop', 0, { routes: [route('shop.localhost', 'web')] })] }
  ]
};

/**
 * The contract's example: fork-a serves acme@0, and fork-b has it too but the
 * daemon chose fork-a, so a plain `use` can switch to fork-b.
 */
export const BOXES: View = {
  boxes: [
    { name: 'fork-a', state: 'connected' },
    { name: 'fork-b', state: 'connected' }
  ],
  projects: [
    {
      name: 'acme',
      lanes: [
        lane('acme', 0, {
          served_by: 'fork-a',
          sources: [
            local(false),
            { box: 'fork-a', state: 'running', branch: null, serving: true },
            {
              box: 'fork-b',
              state: 'running',
              branch: null,
              serving: false,
              skipped: { cause: 'box_chosen', can_use: true }
            }
          ],
          routes: [route('app.acme.localhost', 'web')]
        }),
        lane('acme', 1, { routes: [route('app.acme1.localhost', 'web')] })
      ]
    }
  ]
};

/** Two acme lanes with an app and a wildcard for tenant sites, which has no URL. */
export const WILDCARD: View = {
  boxes: [],
  projects: [
    {
      name: 'acme',
      lanes: [
        lane('acme', 0, {
          routes: [route('app.acme.localhost', 'web'), route('*.sites.acme.localhost', 'sites')]
        }),
        lane('acme', 1, {
          routes: [route('app.acme1.localhost', 'web'), route('*.sites.acme1.localhost', 'sites')]
        })
      ]
    }
  ]
};
