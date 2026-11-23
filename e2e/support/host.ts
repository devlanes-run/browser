import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { View } from '@devlanes/protocol';
import { expect } from '@playwright/test';

/** The extension's fixed id, from the `key` in its manifest. */
export const EXTENSION_ID = 'pggffblellmckocpflaaeligadjpkahj';

/** The native messaging host name the extension connects to. */
const HOST_NAME = 'run.devlanes.browser';

/**
 * Where Playwright's Chromium looks up the host on Windows. Chromium-branded
 * builds read the `Chromium` key first, under the current user.
 */
const WINDOWS_KEY = `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`;

const SCRIPT = fileURLToPath(new URL('../host/fake-host.mjs', import.meta.url));

/** A reply the fake host sends to `use` or `stop_and_use`: a `result` or an `error`. */
export type SwitchReply = { result: unknown } | { error: unknown };

/** What the fake host does, in the order the extension asks. */
export interface Scenario {
  /**
   * The answer to `hello`. A daemon state answers with it, `silent` never
   * answers, and an object is sent as the reply after the `id`.
   * Defaults to `running`.
   */
  hello?: 'running' | 'stopped' | 'outdated' | 'silent' | { error: unknown };
  /** The view sent right after `watch`. */
  view?: View;
  /** Replies to `use` in order. Past the list, every switch goes through. */
  use?: SwitchReply[];
  /** Replies to `stop_and_use` in order. Past the list, every switch goes through. */
  stop_and_use?: SwitchReply[];
}

/** A request the extension sent the host. */
export interface Logged {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * The fake devlanes host of one test, in the test's own folder. It registers
 * itself where the browser looks: the profile's `NativeMessagingHosts` folder on
 * Linux and macOS, the current user's registry on Windows.
 */
export class FakeHost {
  readonly dir: string;
  #manifest: string;
  /** The Windows registry value before this test, `null` when there was none. */
  #previous: string | null | undefined;

  /**
   * @param dir The test's folder, which holds the scenario and the logs.
   * @param scenario What the host answers.
   */
  constructor(dir: string, scenario: Scenario) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
    this.#manifest = join(dir, `${HOST_NAME}.json`);
    writeFileSync(
      this.#manifest,
      JSON.stringify({
        name: HOST_NAME,
        description: 'The fake devlanes host of the end-to-end tests',
        path: this.#launcher(),
        type: 'stdio',
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
      })
    );
  }

  /**
   * Writes the program the manifest names. The browser starts it with its own
   * environment, so it names this Node binary by its full path.
   */
  #launcher(): string {
    if (process.platform === 'win32') {
      const path = join(this.dir, 'fake-host.bat');
      writeFileSync(path, `@echo off\r\n"${process.execPath}" "${SCRIPT}" "${this.dir}" %*\r\n`);
      return path;
    }
    const path = join(this.dir, 'fake-host.sh');
    writeFileSync(path, `#!/bin/sh\nexec "${process.execPath}" "${SCRIPT}" "${this.dir}" "$@"\n`);
    chmodSync(path, 0o755);
    return path;
  }

  /**
   * Makes the browser of `userDataDir` find this host. With `installed` false,
   * it makes sure no host is found, as on a machine without `devlanes setup`.
   */
  register(userDataDir: string, installed: boolean): void {
    if (process.platform !== 'win32') {
      if (installed) {
        const folder = join(userDataDir, 'NativeMessagingHosts');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, `${HOST_NAME}.json`), readFileSync(this.#manifest));
      }
      return;
    }
    this.#previous = readDefault();
    if (installed) {
      reg('add', WINDOWS_KEY, '/ve', '/t', 'REG_SZ', '/d', this.#manifest, '/f');
    } else if (this.#previous !== null) {
      reg('delete', WINDOWS_KEY, '/f');
    }
  }

  /** Puts back the Windows registry value from before {@link register}. */
  unregister(): void {
    if (process.platform !== 'win32' || this.#previous === undefined) {
      return;
    }
    if (this.#previous === null) {
      if (readDefault() !== null) {
        reg('delete', WINDOWS_KEY, '/f');
      }
    } else {
      reg('add', WINDOWS_KEY, '/ve', '/t', 'REG_SZ', '/d', this.#previous, '/f');
    }
    this.#previous = undefined;
  }

  /** Sends `message` to the extension through every connected host process. */
  send(message: unknown): void {
    appendFileSync(join(this.dir, 'send.jsonl'), `${JSON.stringify(message)}\n`);
  }

  /** Every request the extension sent, in order. */
  requests(): Logged[] {
    const log = join(this.dir, 'requests.jsonl');
    if (!existsSync(log)) {
      return [];
    }
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Logged);
  }

  /** Waits until the extension sent a `method` request and returns the latest one. */
  async request(method: string): Promise<Logged> {
    await expect
      .poll(() => this.requests().some((each) => each.method === method), {
        message: `the extension sends ${method}`
      })
      .toBe(true);
    return this.requests().findLast((each) => each.method === method) as Logged;
  }
}

/** Runs `reg` with `args` and returns its output, or `undefined` when it fails. */
function reg(...args: string[]): string | undefined {
  try {
    return execFileSync('reg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

/**
 * The default value of the Windows host key, or `null` when it is missing. A
 * value that points into a test folder an earlier run left behind counts as
 * missing, so a crashed run never becomes the value to put back.
 */
function readDefault(): string | null {
  const value = reg('query', WINDOWS_KEY, '/ve')
    ?.match(/REG_SZ\s+(.*)/)?.[1]
    ?.trim();
  return value && !value.includes(TEST_FOLDER_PREFIX) ? value : null;
}

/** The start of every test folder's name, so leftovers can be told apart from a real host. */
export const TEST_FOLDER_PREFIX = 'devlanes-browser-e2e-';
