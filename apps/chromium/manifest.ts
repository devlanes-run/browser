/**
 * The public key that fixes the extension id at `pggffblellmckocpflaaeligadjpkahj`,
 * the id the devlanes native host allows. Its private key was deleted, since an
 * unpacked build needs only this one.
 */
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlQ1Gi5NPRlhTw9l3L4qH4+TbE1a+fxDlYj7sh7mpADw+omKi28jyHOstx5xL5PZYS0j2FRXOoAJ8fVI0EvFqRsHymWubqq61ybdzPLmjTHRuMm2BZ5ofoN1J1oYXJB0vyjH/QQjSbG6tKirFey/Tdzzw0XRbFLULX2qLDndd64qtjPVSe3gKnsxt+hqljv4HfmDBg8VaELOLr9kMR/AVQK7yzEpQ9W6ae0xBx2X8N85bcLAbYJcOOhgbXwg7Y65qKY1jfnnsTZk/fSkd0zQVLmSB6zpae9eq/EL2N53DgUI6HdRdS1aQ/LvAvSu5vpxgTrFznw81EanAxZ21Wk3OAQIDAQAB';

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
    description: 'Shows your devlanes lanes and their URLs.',
    minimum_chrome_version: '120',
    key: KEY,
    icons: ICONS,
    action: { default_popup: 'popup.html', default_icon: ICONS },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['nativeMessaging', 'storage'],
    // These also expose the URLs of `*.localhost` tabs, so the extension needs no `tabs` permission.
    host_permissions: ['https://*.localhost/*']
  };
}
