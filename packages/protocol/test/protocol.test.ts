import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ProtocolError,
  parseHelloResult,
  parseHostMessage,
  parseUseResult,
  parseView,
  parseWatchResult
} from '../src/index';

// One of each host message protocol 1 defines.
const MESSAGES = [
  { id: 1, result: { protocol: 1, devlanes: '0.15.0', daemon: 'running' } },
  { id: 2, result: {} },
  { event: 'view', data: { boxes: [], projects: [] } },
  {
    event: 'daemon',
    data: { state: 'stopped', message: "devlanes isn't running. Run devlanes in a terminal." }
  },
  {
    event: 'notice',
    data: {
      code: 'lane_switched',
      lane: 'acme@0',
      from: 'fork-a',
      to: 'fork-b',
      message: 'acme@0 now comes from fork-b'
    }
  },
  {
    event: 'notice',
    data: {
      code: 'choice_cleared',
      lane: 'acme@0',
      local_lane: 'acme@0',
      holds: 'processes',
      message: '...'
    }
  },
  {
    id: 3,
    result: {
      lane: 'acme@0',
      box: 'fork-b',
      previous: 'fork-a',
      mirrored: true,
      pending: false,
      waits_for: null
    }
  },
  {
    id: 4,
    error: {
      code: 'local_lane_running',
      message:
        'acme@0 runs on this machine. Stop it with devlanes stop --lane acme@0. Then run devlanes remote use fork-b acme@0.',
      data: {
        holds: 'processes',
        local_lane: 'acme@0',
        commands: ['devlanes stop --lane acme@0']
      }
    }
  },
  {
    id: 5,
    error: {
      code: 'containers_hold_ports',
      message: '...',
      data: { commands: ['docker compose -p acme-0 stop'] }
    }
  },
  { id: 6, error: { code: 'protocol_mismatch', message: '...', data: { supported: [1] } } },
  { id: 7, error: { code: 'unknown_method', message: '...' } },
  { id: 8, error: { code: 'hello_required', message: '...' } },
  { id: 9, error: { code: 'invalid_request', message: '...' } },
  { id: 10, error: { code: 'daemon_failed', message: '...', data: { code: 'lane_unknown' } } }
];

// A view with a local source, a serving box and a skipped box.
const VIEW = {
  boxes: [{ name: 'fork-a', state: 'connected' }],
  projects: [
    {
      name: 'acme',
      lanes: [
        {
          ref: 'acme@0',
          index: 0,
          name: 'main',
          domain: 'acme.localhost',
          served_by: 'fork-a',
          sources: [
            { box: null, state: 'idle', branch: 'main', serving: false },
            { box: 'fork-a', state: 'running', branch: null, serving: true },
            {
              box: 'fork-b',
              state: 'running',
              branch: null,
              serving: false,
              skipped: { cause: 'box_chosen', can_use: true }
            }
          ],
          routes: [
            {
              host: 'app.acme.localhost',
              url: 'https://app.acme.localhost',
              service: 'web',
              state: 'ready'
            }
          ]
        }
      ]
    }
  ]
};

/** A copy of `VIEW` with its first lane changed by `edit`. */
function viewWithLane(edit: (lane: Record<string, unknown>) => void): unknown {
  const view = structuredClone(VIEW);
  edit(view.projects[0]!.lanes[0] as unknown as Record<string, unknown>);
  return view;
}

/** Asserts that `parse` refuses `value` at `path`. */
function assertRefused(parse: (value: unknown) => unknown, value: unknown, path: string): void {
  assert.throws(
    () => parse(value),
    (error: unknown) => error instanceof ProtocolError && error.path === path
  );
}

describe('parseHostMessage', () => {
  it('reads every message of protocol 1 as it was sent', () => {
    for (const message of MESSAGES) {
      assert.deepEqual(parseHostMessage(message), message);
    }
  });

  it('ignores events and notice codes a newer host added', () => {
    const notice = { code: 'lane_renamed', lane: 'acme@0', message: '...' };
    assert.deepEqual(parseHostMessage({ event: 'lane', data: {} }), { ignored: true });
    assert.deepEqual(parseHostMessage({ event: 'notice', data: notice }), { ignored: true });
  });

  it('keeps a choice_cleared holds value a newer daemon added', () => {
    const data = {
      code: 'choice_cleared',
      lane: 'acme@0',
      local_lane: 'acme@0',
      holds: 'volumes',
      message: '...'
    };
    assert.deepEqual(parseHostMessage({ event: 'notice', data }), { event: 'notice', data });
  });

  it('reads an unknown error code as unknown, keeping the host code', () => {
    const message = {
      id: 1,
      error: { code: 'lane_locked', message: 'acme@0 is locked.', data: { since: 0 } }
    };
    assert.deepEqual(parseHostMessage(message), {
      id: 1,
      error: { code: 'unknown', host_code: 'lane_locked', message: 'acme@0 is locked.' }
    });
  });

  it('narrows an error on its code', () => {
    const reply = parseHostMessage(MESSAGES.find((message) => message.id === 4));
    assert.ok('error' in reply);
    // Reading `data` here only type-checks while `HostError` narrows on `code`.
    if (reply.error.code !== 'local_lane_running') {
      assert.fail(`read ${reply.error.code}`);
    }
    assert.deepEqual(reply.error.data.commands, ['devlanes stop --lane acme@0']);
  });

  it('reads a missing or null daemon message as absent', () => {
    for (const data of [{ state: 'running' }, { state: 'running', message: null }]) {
      assert.deepEqual(parseHostMessage({ event: 'daemon', data }), {
        event: 'daemon',
        data: { state: 'running' }
      });
    }
  });

  it('drops unknown fields', () => {
    const data = { code: 'lane_switched', lane: 'acme@0', from: null, to: 'fork-b', message: '' };
    const message = { event: 'notice', data: { ...data, at_ms: 1 }, seq: 4 };
    assert.deepEqual(parseHostMessage(message), { event: 'notice', data });
  });

  it('refuses messages outside protocol 1', () => {
    const cases: [unknown, string][] = [
      [[], '$'],
      [{ id: 1 }, '$'],
      [{ id: -1, result: {} }, '$.id'],
      [{ event: 'daemon', data: { state: 'sleeping' } }, '$.data.state'],
      [
        { event: 'notice', data: { code: 'lane_switched', lane: 'acme@0', message: '' } },
        '$.data.from'
      ],
      [
        { id: 1, error: { code: 'local_lane_running', message: '', data: { holds: 'processes' } } },
        '$.error.data.local_lane'
      ],
      [{ id: 1, error: { code: 'daemon_failed', message: '', data: {} } }, '$.error.data.code']
    ];
    for (const [value, path] of cases) {
      assertRefused(parseHostMessage, value, path);
    }
  });
});

describe('result parsers', () => {
  it('read the results of hello, watch and use', () => {
    const [hello, watch] = MESSAGES as { result: unknown }[];
    const use = MESSAGES[6] as { result: unknown };
    assert.deepEqual(parseHelloResult(hello!.result), hello!.result);
    assert.deepEqual(parseWatchResult(watch!.result), {});
    assert.deepEqual(parseUseResult(use.result), use.result);
  });

  it('refuse a use result without waits_for or with an unknown one', () => {
    const { waits_for: _, ...missing } = (MESSAGES[6] as { result: Record<string, unknown> })
      .result;
    assertRefused(parseUseResult, missing, '$.result.waits_for');
    assertRefused(parseUseResult, { ...missing, waits_for: 'sync' }, '$.result.waits_for');
  });
});

describe('parseView', () => {
  it('reads a view as it was sent', () => {
    assert.deepEqual(parseView(VIEW), VIEW);
  });

  it('keeps source states and skip causes a newer daemon added', () => {
    const view = viewWithLane((lane) => {
      const sources = lane.sources as { state: string; skipped?: { cause: string } }[];
      sources[1]!.state = 'paused';
      sources[2]!.skipped!.cause = 'box_busy';
    });
    assert.deepEqual(parseView(view), view);
  });

  it('reads a missing or null domain as null', () => {
    for (const edit of [
      (lane: Record<string, unknown>) => delete lane.domain,
      (lane: Record<string, unknown>) => (lane.domain = null)
    ]) {
      assert.equal(parseView(viewWithLane(edit)).projects[0]?.lanes[0]?.domain, null);
    }
  });

  it('drops unknown fields', () => {
    const view = viewWithLane((lane) => {
      lane.path = '/home/acme';
      (lane.sources as Record<string, unknown>[])[0]!.units = [];
    });
    assert.deepEqual(parseView({ ...(view as object), version: 2 }), VIEW);
  });

  it('tells a lane served by this machine from one nothing serves', () => {
    const local = parseView(viewWithLane((lane) => (lane.served_by = null)));
    const unserved = parseView(viewWithLane((lane) => delete lane.served_by));
    assert.equal(local.projects[0]?.lanes[0]?.served_by, null);
    assert.equal(Object.hasOwn(unserved.projects[0]!.lanes[0]!, 'served_by'), false);
  });

  it('refuses views outside protocol 1', () => {
    const lane = '$.projects[0].lanes[0]';
    const cases: [unknown, string][] = [
      [
        viewWithLane((lane) => {
          (lane.sources as { serving: boolean }[])[0]!.serving = true;
        }),
        `${lane}.sources`
      ],
      [
        viewWithLane((lane) => {
          (lane.sources as { state: unknown }[])[1]!.state = 1;
        }),
        `${lane}.sources[1].state`
      ],
      [
        viewWithLane((lane) => {
          (lane.sources as { skipped: { can_use: unknown } }[])[2]!.skipped.can_use = 'yes';
        }),
        `${lane}.sources[2].skipped.can_use`
      ],
      [viewWithLane((lane) => delete lane.routes), `${lane}.routes`]
    ];
    for (const [value, path] of cases) {
      assertRefused(parseView, value, path);
    }
  });
});
