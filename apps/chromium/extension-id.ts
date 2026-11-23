import { createHash } from 'node:crypto';

/**
 * The id Chrome gives an extension whose manifest has `key`, a base64 DER public
 * key. Chrome takes the first 32 hex digits of the key's SHA-256 and maps each
 * digit from `0-f` to `a-p`.
 */
export function extensionId(key: string): string {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return Array.from(hex, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('');
}
