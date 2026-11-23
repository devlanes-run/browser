// Which form fields the login fill reads and writes. It goes by the standard
// `autocomplete` tokens only, so a field without them is the site's to fix.
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill

/** The autofill field names of a login. Every other name, such as `one-time-code` or `cc-number`, is ignored. */
export type FieldName = 'username' | 'email' | 'current-password' | 'new-password';

/** A field's login token: its field name and its section, `''` when it names none. */
export interface Token {
  section: string;
  field: FieldName;
}

const FIELD_NAMES = new Set<string>(['username', 'email', 'current-password', 'new-password']);

/** The input types the fill writes into. */
const FILLABLE_TYPES = new Set(['text', 'email', 'tel', 'password', 'search', 'url']);

/**
 * Reads an `autocomplete` attribute: an optional `section-*`, one login field name
 * and an optional `webauthn`, which passkey forms add. Any other token, a second
 * field name or a missing one gives `undefined`. Tokens are case-insensitive.
 */
export function parseAutocomplete(value: string | null | undefined): Token | undefined {
  const tokens = (value ?? '').trim().toLowerCase().split(/\s+/);
  if (tokens.at(-1) === 'webauthn') {
    tokens.pop();
  }
  let section = '';
  // `section-` alone names no section, so it falls through to the field check and fails.
  if (tokens.length === 2 && tokens[0]?.startsWith('section-') && tokens[0].length > 8) {
    section = tokens.shift() ?? '';
  }
  const [field] = tokens;
  if (tokens.length !== 1 || field === undefined || !FIELD_NAMES.has(field)) {
    return undefined;
  }
  return { section, field: field as FieldName };
}

/** What the fill needs to know about an input element, so tests need no DOM. */
export interface FieldLike {
  /** The normalised type, as `HTMLInputElement.type` gives it. */
  type: string;
  disabled: boolean;
  readOnly: boolean;
  getAttribute(name: string): string | null;
}

/**
 * The login token of `input` when the extension may read it. A hidden input
 * counts for a username or an email, because sign-in pages that ask for the
 * password alone keep the username in one, as the Chromium password form guide
 * suggests. A hidden password is never read, since nobody typed it.
 */
export function readable(input: FieldLike): Token | undefined {
  const token = parseAutocomplete(input.getAttribute('autocomplete'));
  if (input.type === 'hidden') {
    return token?.field === 'username' || token?.field === 'email' ? token : undefined;
  }
  return FILLABLE_TYPES.has(input.type) ? token : undefined;
}

/** The login token of `input` when the extension may also write it. */
export function fillable(input: FieldLike): Token | undefined {
  if (!FILLABLE_TYPES.has(input.type) || input.disabled || input.readOnly) {
    return undefined;
  }
  return parseAutocomplete(input.getAttribute('autocomplete'));
}

/** True for the fields whose focus opens the menu. A new password is never offered a saved one. */
export function opensMenu(token: Token): boolean {
  return token.field !== 'new-password';
}

/** A field with its token. */
export interface Candidate<T> {
  element: T;
  token: Token;
}

/** The login fields of one section of a form. */
export interface LoginFields<T> {
  /** The first `username` field, else the first `email` field. */
  username?: T;
  /** The first `current-password` field. */
  password?: T;
  /** The first `new-password` field. */
  newPassword?: T;
}

/** The login fields of `section` among `candidates`, which are in document order. */
export function loginFields<T>(candidates: Candidate<T>[], section: string): LoginFields<T> {
  const inSection = candidates.filter((candidate) => candidate.token.section === section);
  const first = (field: FieldName) =>
    inSection.find((candidate) => candidate.token.field === field)?.element;
  const fields: LoginFields<T> = {};
  const username = first('username') ?? first('email');
  const password = first('current-password');
  const newPassword = first('new-password');
  if (username !== undefined) {
    fields.username = username;
  }
  if (password !== undefined) {
    fields.password = password;
  }
  if (newPassword !== undefined) {
    fields.newPassword = newPassword;
  }
  return fields;
}

/**
 * The username and password a submitted form logs in with, or `undefined` when it
 * holds no complete pair. A new password wins over the current one, since that is
 * the one the next sign-in needs after a sign-up or a password change.
 */
export function submitted(
  fields: LoginFields<{ value: string }>
): { username: string; password: string } | undefined {
  const username = fields.username?.value.trim();
  const password = fields.newPassword?.value || fields.password?.value;
  return username && password ? { username, password } : undefined;
}
