import { writeFileSync } from 'node:fs';
import {
  type BrowserContext,
  type CDPSession,
  expect,
  type Page,
  type Worker
} from '@playwright/test';

/** Something that can run code with the extension's APIs: its service worker or one of its pages. */
export interface ExtensionScope {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
}

/**
 * How long one command to the popup may take. Polls retry within the expect
 * timeout, so this only ends a command whose answer was lost.
 */
const COMMAND_TIMEOUT = 5_000;

/** The JSON answer of a CDP command sent to the popup. */
interface Answer {
  id: number;
  result?: {
    result?: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  };
  error?: { message: string };
}

/**
 * The real action popup, the one the toolbar button opens. Playwright doesn't
 * list it among the context's pages, so this talks to its target over CDP from
 * a page's session. Playwright's session can't address a child session, so the
 * commands go wrapped in `Target.sendMessageToTarget`.
 */
export class Popup {
  #cdp: CDPSession;
  #session: string;
  #target: string;
  #nextId = 1;
  #waiting = new Map<
    number,
    { resolve: (answer: Answer) => void; reject: (error: Error) => void }
  >();
  /** Why the popup's session ended, once it has. */
  #gone: Error | undefined;

  /**
   * @param cdp A CDP session of a page in the same browser.
   * @param target The popup's target id.
   * @param session The id of the session attached to it.
   */
  private constructor(cdp: CDPSession, target: string, session: string) {
    this.#cdp = cdp;
    this.#target = target;
    this.#session = session;
    cdp.on('Target.receivedMessageFromTarget', (event) => {
      if (event.sessionId !== this.#session) {
        return;
      }
      const answer = JSON.parse(event.message) as Answer;
      this.#waiting.get(answer.id)?.resolve(answer);
      this.#waiting.delete(answer.id);
    });
    // A popup that closes or crashes never answers, so every command waiting on it fails.
    cdp.on('Target.detachedFromTarget', (event) => {
      if (event.sessionId !== this.#session) {
        return;
      }
      this.#gone = new Error('The popup closed before it answered.');
      for (const { reject } of this.#waiting.values()) {
        reject(this.#gone);
      }
      this.#waiting.clear();
    });
  }

  /**
   * Sends one CDP command to the popup and waits for its answer, for at most
   * {@link COMMAND_TIMEOUT} milliseconds.
   */
  async #command(method: string, params: Record<string, unknown>): Promise<Answer> {
    if (this.#gone) {
      throw this.#gone;
    }
    const id = this.#nextId++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answered = new Promise<Answer>((resolve, reject) => {
      this.#waiting.set(id, { resolve, reject });
      timer = setTimeout(() => {
        this.#waiting.delete(id);
        reject(new Error(`The popup didn't answer ${method} within ${COMMAND_TIMEOUT} ms.`));
      }, COMMAND_TIMEOUT);
    });
    try {
      await this.#cdp.send('Target.sendMessageToTarget', {
        sessionId: this.#session,
        message: JSON.stringify({ id, method, params })
      });
      return await answered;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Opens the popup over `front`, which becomes the tab the popup calls current.
   * `opener` calls `chrome.action.openPopup`. Pass an extension page when the test
   * keeps the service worker busy.
   */
  static async open(context: BrowserContext, opener: ExtensionScope, front: Page): Promise<Popup> {
    await front.bringToFront();
    const cdp = await context.newCDPSession(front);
    const popups = async () =>
      (await cdp.send('Target.getTargets')).targetInfos.filter((target) =>
        target.url.endsWith('/popup.html')
      );
    const before = new Set((await popups()).map((target) => target.targetId));
    const opened = await opener.evaluate(() =>
      chrome.action.openPopup().then(
        () => 'opened',
        (error: unknown) => String(error)
      )
    );
    expect(opened, 'chrome.action.openPopup opens the popup').toBe('opened');
    let target: string | undefined;
    await expect
      .poll(
        async () => {
          target = (await popups()).find((each) => !before.has(each.targetId))?.targetId;
          return target;
        },
        { message: 'the popup target appears' }
      )
      .toBeDefined();
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId: target as string,
      flatten: false
    });
    const popup = new Popup(cdp, target as string, sessionId);
    await popup.waitFor(
      () => document.querySelector('header.top') !== null,
      undefined,
      'the header'
    );
    return popup;
  }

  /**
   * Runs `fn` in the popup with `arg` and returns its JSON result. `fn` is sent as
   * source, so it can't use anything from the test's scope.
   */
  async evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
    const answer = await this.#command('Runtime.evaluate', {
      expression: `(${fn.toString()})(${JSON.stringify(arg ?? null)})`,
      returnByValue: true,
      awaitPromise: true
    });
    const thrown = answer.result?.exceptionDetails;
    if (answer.error || thrown) {
      throw new Error(
        answer.error?.message ?? thrown?.exception?.description ?? thrown?.text ?? 'evaluate failed'
      );
    }
    return answer.result?.result?.value as R;
  }

  /** Waits until `fn` returns something truthy in the popup. */
  async waitFor<A>(fn: (arg: A) => unknown, arg: A, what: string): Promise<void> {
    await expect
      .poll(async () => Boolean(await this.evaluate(fn, arg)), {
        message: `the popup shows ${what}`
      })
      .toBe(true);
  }

  /** The popup's text. */
  text(): Promise<string> {
    return this.evaluate(() => document.body.textContent ?? '');
  }

  /** Waits until the popup's text holds `text`. */
  async waitForText(text: string): Promise<void> {
    await expect.poll(() => this.text(), { message: `the popup says "${text}"` }).toContain(text);
  }

  /**
   * Clicks the button or link whose accessible label or text is `name`, once it
   * exists and is enabled.
   */
  async click(name: string): Promise<void> {
    /** Finds the control named `wanted`. Runs in the popup. */
    const find = (wanted: string) =>
      [...document.querySelectorAll<HTMLElement>('button, a')].find(
        (each) =>
          (each.getAttribute('aria-label') ?? each.textContent?.trim()) === wanted &&
          !(each as HTMLButtonElement).disabled
      ) !== undefined;
    await this.waitFor(find, name, `an enabled "${name}"`);
    await this.evaluate((wanted: string) => {
      const control = [...document.querySelectorAll<HTMLElement>('button, a')].find(
        (each) => (each.getAttribute('aria-label') ?? each.textContent?.trim()) === wanted
      );
      control?.click();
    }, name);
  }

  /** Clicks the first element matching `selector` whose text holds `text`, once it exists. */
  async clickIn(selector: string, text: string): Promise<void> {
    await this.waitFor(
      ([css, wanted]: [string, string]) =>
        [...document.querySelectorAll<HTMLElement>(css)].some((each) =>
          each.textContent?.includes(wanted)
        ),
      [selector, text],
      `"${text}" in ${selector}`
    );
    await this.evaluate(
      ([css, wanted]: [string, string]) =>
        [...document.querySelectorAll<HTMLElement>(css)]
          .find((each) => each.textContent?.includes(wanted))
          ?.click(),
      [selector, text]
    );
  }

  /** The text of every element matching `selector`. */
  texts(selector: string): Promise<string[]> {
    return this.evaluate(
      (css: string) =>
        [...document.querySelectorAll<HTMLElement>(css)].map((each) => each.textContent ?? ''),
      selector
    );
  }

  /** The browser's first contentful paint of the popup, in milliseconds since its navigation started. */
  async firstContentfulPaint(): Promise<number> {
    await this.waitFor(
      () => performance.getEntriesByName('first-contentful-paint').length > 0,
      undefined,
      'its first contentful paint'
    );
    return this.evaluate(
      () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Number.NaN
    );
  }

  /** Saves a PNG of the popup at `path`. */
  async screenshot(path: string): Promise<void> {
    const answer = await this.#command('Page.captureScreenshot', { format: 'png' });
    const data = (answer.result as { data?: string } | undefined)?.data;
    if (!data) {
      throw new Error(answer.error?.message ?? 'The popup gave no screenshot.');
    }
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  /** Closes the popup, as a click outside it would. */
  async close(): Promise<void> {
    await this.#cdp.send('Target.closeTarget', { targetId: this.#target }).catch(() => undefined);
    // The browser refuses to open a popup while the last one is still going away.
    await expect
      .poll(
        async () =>
          (await this.#cdp.send('Target.getTargets')).targetInfos.some(
            (target) => target.targetId === this.#target
          ),
        { message: 'the popup closes' }
      )
      .toBe(false);
    await this.#cdp.detach().catch(() => undefined);
  }
}

/** The service worker as an {@link ExtensionScope}. */
export function workerScope(worker: Worker): ExtensionScope {
  return { evaluate: (fn) => worker.evaluate(fn) };
}
