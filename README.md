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

The popup lists the projects and lanes [devlanes](https://github.com/devlanes-run/devlanes) runs, with their URLs. It opens the current page in another lane of the same project, keeping the path, query and hash, and switches which machine serves a lane when remote boxes have it too. The toolbar badge shows the lane number of the current tab. Offering the logins typed on one lane on every other lane of the project is still in development.

The extension talks to devlanes through native messaging. The browser starts the devlanes binary as a native host, and the host passes a short list of requests to the daemon. Nothing listens on a port, and the extension never receives environments, secrets or logs.

## Build and load

You need Node.js 24.16 or later and pnpm 12.6.

```sh
pnpm install
pnpm build
```

Open `chrome://extensions` (`edge://extensions` in Edge), turn on Developer mode, click "Load unpacked" and pick `apps/chromium/dist`. The extension id is always `pggffblellmckocpflaaeligadjpkahj`, because the manifest carries a fixed public key.

The extension needs a devlanes release with the browser host, which isn't out yet. Once it is, register the host with `devlanes setup`.

`pnpm zip` packs the build into `apps/chromium/artifacts/`.

## Develop

The repository is a pnpm workspace:

- `packages/protocol` holds the types and parsers of the messages the devlanes native host sends.
- `packages/extension` holds the background and the popup, with no code tied to one browser.
- `apps/chromium` builds them with rsbuild into an extension for Chromium-based browsers.

`pnpm -C packages/extension preview` serves the popup with a fake background, and `?case=<name>` picks one of the states in `packages/extension/preview/cases.ts`. `pnpm -C packages/extension screenshots` renders every case at the popup's size in light and dark into `packages/extension/preview/screenshots/`, which Git ignores. It needs Playwright's Chromium, from `npx playwright install chromium`.

Before you push, run the checks CI runs:

```sh
pnpm lint-ci
pnpm build
pnpm test-types
pnpm test
pnpm zip
```

## License

Licensed under the **Apache-2.0 License**. See [`LICENSE`](https://github.com/devlanes-run/browser/blob/main/LICENSE) for more information.
