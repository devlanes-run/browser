import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { manifest } from '../manifest';
import { writeStoreCopy } from '../store';

it('copies the build for the store without the manifest key', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'devlanes-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  const out = join(root, 'store');
  mkdirSync(join(dist, 'icons'), { recursive: true });
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest('1.2.3')));
  writeFileSync(join(dist, 'icons', 'icon-16.png'), 'png');
  // A file from an earlier copy that the build no longer emits.
  mkdirSync(out);
  writeFileSync(join(out, 'old.js'), '');

  writeStoreCopy(dist, out);

  const copied = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal('key' in copied, false);
  const { key: _, ...expected } = manifest('1.2.3');
  assert.deepEqual(copied, expected);
  assert.equal(readFileSync(join(out, 'icons', 'icon-16.png'), 'utf8'), 'png');
  assert.equal(existsSync(join(out, 'old.js')), false);
  // The unpacked build keeps its key, so its id stays the store's.
  assert.ok(JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')).key);
});
