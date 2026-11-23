import assert from 'node:assert/strict';
import { it } from 'node:test';
import { loginState } from '../src/popup/bridge';

/** A saved login of `username` on `lane`. */
function login(username: string, lane: string) {
  return { username, password: 'secret', lane, used: 1 };
}

it('counts the valid saved logins of each project from storage, sorted by project', () => {
  const state = loginState({
    settings: { fill: false, remember: 'yes' },
    'logins:shop': [login('buyer', 'shop@0')],
    'logins:acme': [login('alice', 'acme@0'), login('bob', 'acme@1'), { username: 'broken' }],
    // A project whose every entry is broken, or that has none, isn't listed.
    'logins:zeta': [{ username: 'broken' }],
    'logins:empty': [],
    snapshot: { status: { state: 'running' } }
  });
  assert.deepEqual(state, {
    // A setting of the wrong type keeps its default.
    settings: { fill: false, remember: true },
    saved: [
      { project: 'acme', count: 2 },
      { project: 'shop', count: 1 }
    ]
  });
});

it('gives the default settings and nothing saved for empty storage', () => {
  assert.deepEqual(loginState({}), { settings: { fill: true, remember: true }, saved: [] });
});
