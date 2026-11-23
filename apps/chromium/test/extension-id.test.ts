import assert from 'node:assert/strict';
import { it } from 'node:test';
import { extensionId } from '../extension-id';
import { manifest } from '../manifest';

it('gives the extension the id the devlanes native host allows', () => {
  // The id in the host's `allowed_origins`. Changing the key breaks the connection to devlanes.
  assert.equal(extensionId(manifest('0.0.0').key!), 'pggffblellmckocpflaaeligadjpkahj');
});
