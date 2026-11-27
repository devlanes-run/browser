import assert from 'node:assert/strict';
import { it } from 'node:test';
import { isPopupSender, type PortSender } from '../src/background/popup-port';

const ID = 'konofbnhgejkgkonkleipkkpkphbfgee';
const POPUP: PortSender = { id: ID, url: `chrome-extension://${ID}/popup.html` };

it('lets only the action popup of this extension open the popup port', () => {
  assert.equal(isPopupSender(POPUP, ID), true);
  for (const [who, sender] of [
    ['no sender', undefined],
    ['another extension', { ...POPUP, id: 'abcdefghijklmnopabcdefghijklmnop' }],
    [
      'a content script on a lane page',
      { id: ID, url: 'https://app.acme.localhost/', tab: { id: 3 } }
    ],
    ['the popup page opened in a tab', { ...POPUP, tab: { id: 3 } }],
    ['another page of the extension', { id: ID, url: `chrome-extension://${ID}/menu.html` }],
    ['a popup path on another host', { id: ID, url: 'https://evil.example.invalid/popup.html' }],
    [
      'a popup path on another extension id',
      { id: ID, url: 'chrome-extension://other/popup.html' }
    ],
    ['no URL', { id: ID }]
  ] as const) {
    assert.equal(isPopupSender(sender, ID), false, who);
  }
});
