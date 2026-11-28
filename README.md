<p align="center">
   <b>Using devlanes?</b> Please consider <a href="https://github.com/sponsors/arthurfiorette" target="_blank">donating</a> to support my open source work ❤️
  <br />
  <sup>
   Help devlanes grow! Star and share this amazing repository with your friends and co-workers!
  </sup>
</p>

<br />

<p align="center" title="devlanes">
  <a href="https://devlanes.run" target="_blank" rel="noopener noreferrer">
    <img src="https://devlanes.run/assets/banner.png" alt="devlanes: Sandboxes for your agents. localhost for you." />
  </a>
</p>

<br />

<p align="center">
  <a title="Apache-2.0 license" target="_blank" href="https://github.com/devlanes-run/browser/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/devlanes-run/browser"></a>
  <a title="CI" target="_blank" href="https://github.com/devlanes-run/browser/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/devlanes-run/browser/ci.yml?branch=main&label=ci"></a>
  <a title="Last commit" target="_blank" href="https://github.com/devlanes-run/browser/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/devlanes-run/browser"></a>
</p>

<br />
<br />

# devlanes browser extension

> Your lanes in Chrome, Chromium, Brave and Edge.

<br />

The popup lists the projects and lanes [devlanes](https://github.com/devlanes-run/devlanes) runs, with their URLs. It opens the current page in another lane of the same project, keeping the path, query and hash, and switches which machine serves a lane when remote boxes have it too. The toolbar badge shows the lane number of the current tab.

When you sign in on a lane, the extension saves the username and password and offers them in a menu on every lane of the same project. It reads only fields marked with the standard `autocomplete` tokens `username`, `email`, `current-password` and `new-password`. It saves a login only when the form sends a `submit` event, so forms sent with `form.submit()` or plain `fetch` aren't saved. The popup's login settings turn the fill and the saved passwords off, and delete a project's saved logins. Passwords are stored unencrypted in the browser, so use this for test accounts only.

The extension talks to devlanes through native messaging. The browser starts the devlanes binary as a native host, and the host passes a short list of requests to the daemon. Nothing listens on a port, and the extension never receives environments, secrets or logs.

## Build and load

You need Node.js 24.16 or later and pnpm 12.6.

```sh
pnpm install
pnpm build
```

Open `chrome://extensions` (`edge://extensions` in Edge), turn on Developer mode, click "Load unpacked" and pick `apps/chromium/dist`. The extension id is always `konofbnhgejkgkonkleipkkpkphbfgee`. The manifest carries the public key of the extension's Chrome Web Store item, so an unpacked build gets the same id as a store install.

The extension needs devlanes 0.16.0 or later. Run `devlanes setup` to register devlanes as the extension's native host, then reopen the popup. [Use the browser extension](https://devlanes.run/docs/how-to/use-the-browser-extension/) lists the browsers setup registers and shows how to add another Chromium browser.

`pnpm zip` packs the build into `apps/chromium/artifacts/`.

## Chrome Web Store

The extension id comes from the store listing, which isn't public yet. `pnpm zip-store` writes the zip to upload to `apps/chromium/artifacts/devlanes-<version>-store.zip`. Its manifest has no `key`, because the store refuses an upload that has one. The listing's privacy policy is https://devlanes.run/privacy/.

## Develop

The repository is a pnpm workspace:

- `packages/protocol` holds the types and parsers of the messages the devlanes native host sends.
- `packages/extension` holds the background, the popup, and the content script and menu of the login fill, with no code tied to one browser.
- `apps/chromium` builds them with rsbuild into an extension for Chromium-based browsers.
- `e2e` tests the built extension in Playwright's Chromium, with a fake devlanes host.

`pnpm -C packages/extension preview` serves the popup with a fake background, and `?case=<name>` picks one of the states in `packages/extension/preview/cases.ts`. `menu.html?menu=<name>` shows the login menu the same way. `pnpm -C packages/extension screenshots` renders every case at its real size in light and dark into `packages/extension/preview/screenshots/`, which Git ignores. It needs Playwright's Chromium, from `npx playwright install chromium`.

Before you push, run the checks CI runs:

```sh
pnpm lint-ci
pnpm build
pnpm test-types
pnpm test
pnpm zip
pnpm zip-store
pnpm e2e
```

`pnpm e2e` builds the extension and runs the end-to-end tests in `e2e/tests/`. Install Playwright's Chromium once with `pnpm --filter @devlanes/e2e exec playwright install chromium`. On Linux, add `--with-deps` the first time, so Playwright installs the libraries Chromium needs. To test another build, such as an older commit's, set `E2E_DIST` to its `dist` folder and run `pnpm --filter @devlanes/e2e e2e`, which skips the build.

Each test starts the browser with its own profile and a fake host that answers as devlanes would, so no devlanes install is needed. On Linux and macOS the host manifest goes into each test's own profile, so nothing outside it changes. On Windows the tests point `HKCU\Software\Chromium\NativeMessagingHosts\run.devlanes.browser` at the fake host and put back the value they found. They run one at a time for that reason. If a run is killed, the next run puts the value back before its first test. A Chromium you run during the tests finds the fake host too.

## License

Licensed under the **Apache-2.0 License**. See [`LICENSE`](https://github.com/devlanes-run/browser/blob/main/LICENSE) for more information.
