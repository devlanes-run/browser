import { LANE_URLS } from '@devlanes/extension/lane-urls';

/**
 * The Chrome Web Store item's public key. It fixes the extension id at
 * `konofbnhgejkgkonkleipkkpkphbfgee`, the id the devlanes native host allows.
 * The store holds the private key and signs store installs with it, so an
 * unpacked build with this key gets the same id as a store install.
 */
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAy3aCwoO0etAdsbEmRXOQUEOON2NfoZD4sgOwIgQ4ZCNMgXXOtboRGyLPEGEJyIhamvmxUWrepof+oa7qrznBLRz2G/lNW5B+Fb+WDQt+pAlEnjOOCc2oGxxjYi+o7NOMIacFyOuOKa5SQkp189u301/+ML1pTL7m3mIfzD8caZEgU/CK4BAt5j0rh6yDahjbn/CsGwognSnNKBYe4R3TTk4mG51Zb7O2Qs+V+mTzNZ80rF2fV2DpAfvD8rWn6LuL1a5+/fPrFf9z+t/5ZCeiP5MeG2/j1Yz9u/V/tBI6p6m+ZSdFV7ktJKdMqwoPmVmdcmCcJHZ/i5UxfTI1zEGtfwIDAQAB';

const ICONS = {
  '16': 'icons/icon-16.png',
  '32': 'icons/icon-32.png',
  '48': 'icons/icon-48.png',
  '128': 'icons/icon-128.png'
};

/** The extension's `manifest.json` at `version`. */
export function manifest(version: string): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: 'devlanes',
    version,
    // The store shows this as the summary and allows at most 132 characters.
    description:
      'Open a page in another devlanes lane, choose which box serves a lane, and fill test logins on every lane.',
    homepage_url: 'https://devlanes.run/docs/how-to/use-the-browser-extension/',
    minimum_chrome_version: '120',
    key: KEY,
    icons: ICONS,
    action: { default_popup: 'popup.html', default_icon: ICONS },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['nativeMessaging', 'storage'],
    // These also expose the URLs of `*.localhost` tabs, so the extension needs no `tabs` permission.
    host_permissions: [LANE_URLS],
    content_scripts: [
      {
        matches: [LANE_URLS],
        js: ['content.js'],
        // Lane pages often sign in inside frames, and `about:blank` or `blob:` frames
        // a lane page opens take its origin, so the fill reaches them too.
        all_frames: true,
        match_origin_as_fallback: true,
        run_at: 'document_idle'
      }
    ],
    web_accessible_resources: [
      {
        // The login menu shows in a frame of this page on lane pages.
        resources: ['menu.html'],
        matches: [LANE_URLS],
        // A new id each browser session, so a page can't build the URL to frame `menu.html`
        // itself. Chrome versions that don't enforce it yet still load the menu.
        use_dynamic_url: true
      }
    ]
  };
}
