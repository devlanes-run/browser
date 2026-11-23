import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type FieldLike,
  fillable,
  loginFields,
  parseAutocomplete,
  readable,
  submitted
} from '../src/content/fields';

/** An input of `type` with `autocomplete`. */
function input(
  type: string,
  autocomplete: string | null,
  state: Partial<FieldLike> = {}
): FieldLike {
  return {
    type,
    disabled: false,
    readOnly: false,
    getAttribute: (name) => (name === 'autocomplete' ? autocomplete : null),
    ...state
  };
}

describe('parseAutocomplete', () => {
  it('reads login field names with an optional section and webauthn', () => {
    const cases: [string | null, ReturnType<typeof parseAutocomplete>][] = [
      ['username', { section: '', field: 'username' }],
      ['  EMAIL ', { section: '', field: 'email' }],
      ['current-password', { section: '', field: 'current-password' }],
      ['section-admin new-password', { section: 'section-admin', field: 'new-password' }],
      ['username webauthn', { section: '', field: 'username' }],
      ['section-a current-password webauthn', { section: 'section-a', field: 'current-password' }]
    ];
    for (const [value, expected] of cases) {
      assert.deepEqual(parseAutocomplete(value), expected, String(value));
    }
  });

  it('refuses one-time codes, cards, other names and malformed lists', () => {
    for (const value of [
      null,
      '',
      'on',
      'off',
      'one-time-code',
      'cc-number',
      'cc-csc',
      'section-pay cc-exp',
      'name',
      'section- username',
      'username current-password',
      'billing email',
      'section-a section-b username',
      'webauthn'
    ]) {
      assert.equal(parseAutocomplete(value), undefined, String(value));
    }
  });
});

describe('readable and fillable', () => {
  it('reads hidden usernames but writes only visible text inputs that accept input', () => {
    const cases: [FieldLike, boolean, boolean][] = [
      [input('text', 'username'), true, true],
      [input('password', 'current-password'), true, true],
      [input('hidden', 'username'), true, false],
      [input('text', 'username', { disabled: true }), true, false],
      [input('text', 'username', { readOnly: true }), true, false],
      [input('checkbox', 'username'), false, false],
      [input('text', null), false, false],
      [input('text', 'one-time-code'), false, false]
    ];
    for (const [field, read, write] of cases) {
      const label = `${field.type} ${field.getAttribute('autocomplete')}`;
      assert.equal(readable(field) !== undefined, read, `readable ${label}`);
      assert.equal(fillable(field) !== undefined, write, `fillable ${label}`);
    }
  });
});

describe('submitted', () => {
  /** The candidates of a form whose fields hold `values`, keyed by autocomplete. */
  function form(values: [string, string][]) {
    return values.flatMap(([autocomplete, value]) => {
      const token = parseAutocomplete(autocomplete);
      return token ? [{ element: { value }, token }] : [];
    });
  }

  it('pairs the username with the new password over the current one, within one section', () => {
    const fields = form([
      ['username', ' alice '],
      ['current-password', 'old'],
      ['new-password', 'new'],
      ['section-other username', 'bob'],
      ['section-other current-password', 'bob-pass']
    ]);
    assert.deepEqual(submitted(loginFields(fields, '')), { username: 'alice', password: 'new' });
    assert.deepEqual(submitted(loginFields(fields, 'section-other')), {
      username: 'bob',
      password: 'bob-pass'
    });
  });

  it('prefers a username field to an email field and needs both halves', () => {
    const both = form([
      ['email', 'a@example.invalid'],
      ['username', 'alice'],
      ['current-password', 'pass']
    ]);
    assert.deepEqual(submitted(loginFields(both, '')), { username: 'alice', password: 'pass' });
    assert.equal(submitted(loginFields(form([['username', 'alice']]), '')), undefined);
    assert.equal(submitted(loginFields(form([['current-password', 'pass']]), '')), undefined);
    assert.equal(
      submitted(
        loginFields(
          form([
            ['username', '  '],
            ['current-password', 'pass']
          ]),
          ''
        )
      ),
      undefined
    );
  });
});
