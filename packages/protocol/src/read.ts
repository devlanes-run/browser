/**
 * A host message that doesn't match protocol 1. `path` points at the field
 * that failed, such as `data.projects[0].lanes[1].sources`.
 */
export class ProtocolError extends Error {
  readonly path: string;

  /**
   * @param path Where in the message the field sits, `$` for the message itself.
   * @param expected What the field should have been.
   */
  constructor(path: string, expected: string) {
    super(`${path} must be ${expected}`);
    this.name = 'ProtocolError';
    this.path = path;
  }
}

/** A JSON object whose fields are still unchecked. */
export type Fields = Readonly<Record<string, unknown>>;

/** Returns `value` as an object, or throws when it is not a plain JSON object. */
export function object(value: unknown, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(path, 'an object');
  }
  return value as Fields;
}

/**
 * True when `fields` has `key`, even with the value `null`. Fields where absent
 * and `null` mean different things, such as `served_by`, need it.
 */
export function has(fields: Fields, key: string): boolean {
  return Object.hasOwn(fields, key);
}

/** Returns `value` as a string, or throws. */
export function string(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ProtocolError(path, 'a string');
  }
  return value;
}

/** Returns `value` as a string or `null`, or throws. A missing field is not `null`. */
export function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

/** Returns `value` as a boolean, or throws. */
export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ProtocolError(path, 'a boolean');
  }
  return value;
}

/** Returns `value` as a non-negative integer, or throws. */
export function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProtocolError(path, 'a non-negative integer');
  }
  return value;
}

/** Returns `value` when it is one of `values`, or throws. */
export function oneOf<const T extends string>(
  value: unknown,
  path: string,
  values: readonly T[]
): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new ProtocolError(path, `one of ${values.join(', ')}`);
  }
  return value as T;
}

/** Returns `value` as an array with each item read by `item`, or throws. */
export function array<T>(
  value: unknown,
  path: string,
  item: (value: unknown, path: string) => T
): T[] {
  if (!Array.isArray(value)) {
    throw new ProtocolError(path, 'an array');
  }
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}
