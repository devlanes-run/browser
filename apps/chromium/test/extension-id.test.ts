import assert from 'node:assert/strict';
import { it } from 'node:test';
import { extensionId } from '../extension-id';
import { manifest } from '../manifest';

it('gives the extension the id the devlanes native host allows', () => {
  // The Chrome Web Store item's id, which the host's `allowed_origins` lists.
  // Changing the key breaks the connection to devlanes.
  assert.equal(extensionId(manifest('0.0.0').key!), 'konofbnhgejkgkonkleipkkpkphbfgee');
});

it('keeps the store summary within the 132 characters the store allows', () => {
  assert.ok(manifest('0.0.0').description!.length <= 132);
});
