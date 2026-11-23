import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type TestInfo,
  type Worker
} from '@playwright/test';
import { EXTENSION_ID, FakeHost, type Scenario, TEST_FOLDER_PREFIX } from './host';
import { pageFor } from './pages';
import { type ExtensionScope, Popup, workerScope } from './popup';

/** The unpacked extension. `E2E_DIST` points at another build, such as an older commit's. */
const DIST =
  process.env.E2E_DIST ?? fileURLToPath(new URL('../../apps/chromium/dist', import.meta.url));

/** How a test starts the browser. */
export interface LaunchOptions {
  /** What the fake host answers. */
  scenario?: Scenario;
  /** False runs without any registered host, as before `devlanes setup`. */
  installed?: boolean;
}

/** The badge of a tab: its text and its background colour as RGBA. */
export interface Badge {
  text: string;
  color: number[];
}

/** A browser with the extension loaded and the fake host behind it. */
export interface Lab {
  context: BrowserContext;
  worker: Worker;
  host: FakeHost;
  /** Opens `url` in a new tab and waits for it to load. */
  open(url: string): Promise<Page>;
  /** Opens the action popup with `front` as the current tab. */
  popup(front: Page, opener?: ExtensionScope): Promise<Popup>;
  /** The badge the toolbar button shows on the tab of `page`. */
  badge(page: Page): Promise<Badge>;
  /** Waits until the background has a view from the host with the daemon running. */
  connected(): Promise<void>;
  /** Reads `key` from the extension's `chrome.storage.local`. */
  stored<T>(key: string): Promise<T | undefined>;
}

/** A launched browser with the popups its test opened, for the screenshots of a failure. */
interface Launched {
  context: BrowserContext;
  popups: Popup[];
}

/**
 * The `launch` fixture. Each test gets its own profile and host folder, so no
 * state crosses tests. The browser closes and the host registration goes back
 * to what it was, even when the test fails.
 */
export const test = base.extend<{ launch: (options?: LaunchOptions) => Promise<Lab> }>({
  // Playwright reads a fixture's dependencies from an object pattern in its first
  // argument and refuses an empty one, so this names a built-in fixture it ignores.
  launch: async ({ browserName: _ }, use, testInfo) => {
    if (!existsSync(join(DIST, 'manifest.json'))) {
      throw new Error(`${DIST} has no build. Run pnpm build, then run the tests again.`);
    }
    const cleanups: (() => Promise<void> | void)[] = [];
    const launched: Launched[] = [];
    await use(async ({ scenario = {}, installed = true } = {}) => {
      const folder = mkdtempSync(join(tmpdir(), TEST_FOLDER_PREFIX));
      cleanups.push(() => {
        try {
          rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {
          // A host process the browser is still stopping can hold a file on Windows for a
          // moment. A folder left in the temp directory is harmless, so that isn't an error.
        }
      });
      const host = new FakeHost(join(folder, 'host'), scenario);
      const profile = join(folder, 'profile');
      host.register(profile, installed);
      cleanups.push(() => host.unregister());
      const context = await chromium.launchPersistentContext(profile, {
        // The new headless mode runs extensions and their popups.
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]
      });
      cleanups.push(() => context.close());
      await context.route(/^https:\/\/([a-z0-9-]+\.)*localhost\//, (route) => {
        const url = new URL(route.request().url());
        return route.fulfill({ contentType: 'text/html', body: pageFor(url.pathname) });
      });
      const ours = (worker: Worker) => worker.url().includes(EXTENSION_ID);
      const worker =
        context.serviceWorkers().find(ours) ??
        (await context.waitForEvent('serviceworker', { predicate: ours }));
      const entry: Launched = { context, popups: [] };
      launched.push(entry);
      return lab(entry, worker, host);
    });
    if (testInfo.status !== testInfo.expectedStatus) {
      await screenshots(launched, testInfo);
    }
    // The last one set up closes first: the browser before the registry and the folder.
    // Every step runs even when one fails, so the registry always goes back.
    const errors: unknown[] = [];
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
  }
});

/**
 * Saves a screenshot of every page and popup still open into the test's output
 * folder, which CI keeps when a test fails. A page that can't be captured any
 * more is skipped, since the screenshots only help explain the failure.
 */
async function screenshots(launched: Launched[], testInfo: TestInfo): Promise<void> {
  for (const [index, { context, popups }] of launched.entries()) {
    for (const [tab, page] of context.pages().entries()) {
      await page
        .screenshot({ path: testInfo.outputPath(`browser-${index}-tab-${tab}.png`) })
        .catch(() => undefined);
    }
    for (const [number, popup] of popups.entries()) {
      await popup
        .screenshot(testInfo.outputPath(`browser-${index}-popup-${number}.png`))
        .catch(() => undefined);
    }
  }
}

/** The {@link Lab} of a launched browser. */
function lab({ context, popups }: Launched, worker: Worker, host: FakeHost): Lab {
  return {
    context,
    worker,
    host,
    async open(url) {
      const page = await context.newPage();
      await page.goto(url);
      return page;
    },
    async popup(front, opener = workerScope(worker)) {
      const popup = await Popup.open(context, opener, front);
      popups.push(popup);
      return popup;
    },
    async badge(page) {
      return worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url: 'https://*.localhost/*' });
        const tab = tabs.find((each) => each.url === url);
        if (tab?.id === undefined) {
          return { text: '', color: [] };
        }
        return {
          text: await chrome.action.getBadgeText({ tabId: tab.id }),
          color: await chrome.action.getBadgeBackgroundColor({ tabId: tab.id })
        };
      }, page.url());
    },
    async connected() {
      await expect
        .poll(
          () =>
            worker.evaluate(async () => {
              const { snapshot } = (await chrome.storage.session.get('snapshot')) as {
                snapshot?: { status?: { state?: string }; view?: unknown };
              };
              return snapshot?.status?.state === 'running' && snapshot.view !== undefined;
            }),
          { message: 'the background has a view from the fake host' }
        )
        .toBe(true);
    },
    async stored<T>(key: string) {
      return (await worker.evaluate(
        async (name) => (await chrome.storage.local.get(name))[name],
        key
      )) as T | undefined;
    }
  };
}

export { expect };
