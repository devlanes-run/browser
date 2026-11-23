import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lane, UseResult } from '@devlanes/protocol';
import { replyFlow } from '../src/popup/flow';

const LANE: Lane = {
  ref: 'acme@0',
  index: 0,
  name: 'main',
  domain: 'acme.localhost',
  served_by: null,
  sources: [{ box: null, state: 'running', branch: 'main', serving: true }],
  routes: []
};

/** A `use` result for acme@0 on fork-b. */
function result(pending: boolean, waits_for: UseResult['waits_for']): UseResult {
  return { lane: 'acme@0', box: 'fork-b', previous: null, mirrored: !pending, pending, waits_for };
}

describe('replyFlow', () => {
  it('asks before stopping processes, and lists commands for containers', () => {
    const refusal = (holds: 'processes' | 'containers') =>
      replyFlow(LANE, 'fork-b', {
        ok: false,
        error: {
          code: 'local_lane_running',
          message: 'acme@0 runs on this machine.',
          data: { holds, local_lane: 'acme@0', commands: ['docker compose -p acme stop'] }
        }
      });
    assert.deepEqual(refusal('processes'), { kind: 'confirm', box: 'fork-b', localLane: 'acme@0' });
    const containers = refusal('containers');
    assert.equal(containers?.kind, 'commands');
    assert.deepEqual(containers?.kind === 'commands' && containers.commands, [
      'docker compose -p acme stop'
    ]);
  });

  it('lists the commands stop_and_use gives back when containers hold the ports', () => {
    const flow = replyFlow(LANE, 'fork-b', {
      ok: false,
      error: {
        code: 'containers_hold_ports',
        message: 'Containers hold the ports.',
        data: { commands: ['docker stop acme-redis-1'] }
      }
    });
    assert.equal(flow?.kind, 'commands');
    assert.deepEqual(flow?.kind === 'commands' && flow.box, 'fork-b');
  });

  it('says what a pending switch waits for, and nothing once it went through', () => {
    const text = (pending: boolean, waits: UseResult['waits_for']) => {
      const flow = replyFlow(LANE, 'fork-b', { ok: true, result: result(pending, waits) });
      return flow?.kind === 'note' ? flow.text : flow;
    };
    assert.equal(text(true, 'connect'), 'acme@0 switches to fork-b once fork-b connects.');
    assert.equal(text(true, 'mirror'), 'acme@0 switches to fork-b once this machine mirrors it.');
    assert.equal(text(true, null), 'The switch of acme@0 to fork-b is pending.');
    assert.equal(text(false, null), undefined);
  });

  it("shows an unknown error's message as it is", () => {
    assert.deepEqual(
      replyFlow(LANE, 'fork-b', {
        ok: false,
        error: { code: 'unknown', host_code: 'box_on_fire', message: 'fork-b is on fire.' }
      }),
      { kind: 'error', text: 'fork-b is on fire.' }
    );
  });
});
