import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `manifest` without `key`. The Chrome Web Store refuses an upload whose
 * manifest has one, because the store signs the item with its own private key.
 */
export function storeManifest(manifest: chrome.runtime.ManifestV3): chrome.runtime.ManifestV3 {
  const { key: _, ...rest } = manifest;
  return rest;
}

/**
 * Copies the build in `dist` to `out` with {@link storeManifest} as its
 * `manifest.json`. `out` is replaced, so a file the build no longer emits
 * doesn't reach the store.
 */
export function writeStoreCopy(dist: string, out: string): void {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  rmSync(out, { recursive: true, force: true });
  cpSync(dist, out, { recursive: true });
  writeFileSync(
    join(out, 'manifest.json'),
    `${JSON.stringify(storeManifest(manifest), null, 2)}\n`
  );
}
