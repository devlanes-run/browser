// The popup's preview cases, built from the examples in the native host contract.
// They use fake names only (acme, shop, fork-a).

import type { Lane, Route, Source, View } from '@devlanes/protocol';
import type { Snapshot, UseMethod, UseReply } from '../src/state';

/** One state of the popup, with the answers its fake background gives. */
export interface Case {
  name: string;
  title: string;
  snapshot: Snapshot;
  /** The URL of the active tab. */
  page?: string;
  /** The reply to `use` and `stop_and_use`. Without it, every switch succeeds. */
  answer?: (method: UseMethod) => UseReply;
  /** What the screenshot clicks first, by accessible name. */
  clicks?: string[];
}

/** A ready route of `service` on `host`. */
function route(host: string, service: string, state = 'ready'): Route {
  return { host, url: `https://${host}`, service, state };
}

/** This machine's source of a lane. */
function local(state: string, branch: string, serving = true): Source {
  return { box: null, state, branch, serving };
}

/** A lane of `project`, with the name rule of the contract. */
function lane(
  project: string,
  index: number,
  parts: { name?: string; sources: Source[]; routes: Route[]; served_by?: string | null }
): Lane {
  const domain = index === 0 ? `${project}.localhost` : `${project}${index}.localhost`;
  const shaped: Lane = {
    ref: `${project}@${index}`,
    index,
    name: parts.name ?? (index === 0 ? 'main' : `lane${index}`),
    domain: parts.routes.length > 0 ? domain : null,
    sources: parts.sources,
    routes: parts.routes
  };
  if (parts.served_by !== undefined) {
    shaped.served_by = parts.served_by;
  }
  return shaped;
}

const ACME_LOCAL: Lane[] = [
  lane('acme', 0, {
    served_by: null,
    sources: [local('running', 'main')],
    routes: [route('app.acme.localhost', 'web'), route('api.acme.localhost', 'api')]
  }),
  lane('acme', 1, {
    served_by: null,
    sources: [local('running', 'feat/checkout')],
    routes: [route('app.acme1.localhost', 'web'), route('api.acme1.localhost', 'api', 'starting')]
  }),
  lane('acme', 2, {
    name: 'perf',
    served_by: null,
    sources: [local('failed', 'agent/perf-review-of-the-checkout-flow')],
    routes: [route('app.acme2.localhost', 'web', 'failed')]
  }),
  lane('acme', 3, {
    served_by: null,
    sources: [local('idle', 'fix/login')],
    routes: []
  })
];

const SHOP: View['projects'][number] = {
  name: 'shop',
  lanes: [
    lane('shop', 0, {
      served_by: null,
      sources: [local('idle', 'main')],
      routes: [route('shop.localhost', 'storefront', 'idle'), route('*.shop.localhost', 'tenants')]
    })
  ]
};

const LOCAL_VIEW: View = { boxes: [], projects: [{ name: 'acme', lanes: ACME_LOCAL }, SHOP] };

/** The contract's example lane: fork-a serves it, fork-b has it but was passed over. */
const MIRRORED = lane('acme', 0, {
  served_by: 'fork-a',
  sources: [
    local('idle', 'main', false),
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
});

const BOXES_VIEW: View = {
  boxes: [
    { name: 'fork-a', state: 'connected' },
    { name: 'fork-b', state: 'connected' },
    { name: 'fork-c', state: 'reconnecting' }
  ],
  projects: [
    {
      name: 'acme',
      lanes: [
        MIRRORED,
        lane('acme', 1, {
          served_by: 'fork-b',
          sources: [{ box: 'fork-b', state: 'starting', branch: null, serving: true }],
          routes: [route('app.acme1.localhost', 'web', 'starting')]
        }),
        lane('acme', 2, {
          sources: [{ box: 'fork-a', state: 'running', branch: null, serving: false }],
          routes: []
        })
      ]
    }
  ]
};

/** acme@0 runs here, so a plain switch to fork-b would be refused. */
const RUNNING_HERE: View = {
  boxes: [{ name: 'fork-b', state: 'connected' }],
  projects: [
    {
      name: 'acme',
      lanes: [
        lane('acme', 0, {
          served_by: null,
          sources: [
            local('running', 'main'),
            {
              box: 'fork-b',
              state: 'running',
              branch: null,
              serving: false,
              skipped: { cause: 'local_running', can_use: false }
            }
          ],
          routes: [route('app.acme.localhost', 'web'), route('api.acme.localhost', 'api')]
        }),
        ACME_LOCAL[1] as Lane
      ]
    }
  ]
};

const running: Snapshot['status'] = { state: 'running' };

/** A switch of acme@0 to fork-b that went through. */
const switched = {
  lane: 'acme@0',
  box: 'fork-b',
  previous: null,
  mirrored: true,
  pending: false,
  waits_for: null
};

/** Every preview case, in the order the index lists them. */
export const CASES: Case[] = [
  {
    name: 'local',
    title: 'Local lanes only',
    snapshot: { status: running, devlanes: '0.15.0', view: LOCAL_VIEW, notices: [] },
    page: 'https://app.acme.localhost/orders?page=2#latest'
  },
  {
    name: 'boxes',
    title: 'Boxes with a skipped lane',
    snapshot: {
      status: running,
      devlanes: '0.15.0',
      view: BOXES_VIEW,
      notices: [
        {
          id: 1,
          notice: {
            code: 'lane_switched',
            lane: 'acme@1',
            from: 'fork-a',
            to: 'fork-b',
            message: 'acme@1 now comes from fork-b'
          }
        }
      ]
    },
    page: 'https://app.acme.localhost/'
  },
  {
    name: 'refusal',
    title: 'Switching a lane that runs here',
    snapshot: { status: running, devlanes: '0.15.0', view: RUNNING_HERE, notices: [] },
    clicks: ['fork-b']
  },
  {
    name: 'containers',
    title: 'Containers hold the ports',
    snapshot: { status: running, devlanes: '0.15.0', view: RUNNING_HERE, notices: [] },
    answer: (method) =>
      method === 'stop_and_use'
        ? {
            ok: false,
            error: {
              code: 'containers_hold_ports',
              message: 'The containers of acme@0 still hold its ports.',
              data: {
                commands: ['docker compose -p acme stop', 'docker stop acme-redis-1 acme-mail-1']
              }
            }
          }
        : { ok: true, result: switched },
    clicks: ['fork-b', 'Stop and switch']
  },
  {
    name: 'daemon-stopped',
    title: 'Daemon stopped',
    snapshot: {
      status: {
        state: 'daemon_stopped',
        message: "devlanes isn't running. Run devlanes in a terminal."
      },
      devlanes: '0.15.0',
      view: LOCAL_VIEW,
      notices: []
    }
  },
  {
    name: 'not-installed',
    title: 'Host not installed',
    snapshot: { status: { state: 'not_installed' }, notices: [] }
  },
  {
    name: 'outdated',
    title: 'Daemon outdated',
    snapshot: {
      status: {
        state: 'outdated',
        message:
          'The devlanes daemon is older than this host. Restart the daemon with devlanes daemon restart.'
      },
      devlanes: '0.15.0',
      notices: []
    }
  },
  {
    name: 'protocol-mismatch',
    title: 'Protocol mismatch',
    snapshot: { status: { state: 'protocol_mismatch', supported: [2] }, notices: [] }
  },
  {
    name: 'host-failed',
    title: 'Host stopped',
    snapshot: {
      status: { state: 'host_failed', detail: 'Native host has exited.' },
      devlanes: '0.15.0',
      view: LOCAL_VIEW,
      notices: []
    }
  }
];
