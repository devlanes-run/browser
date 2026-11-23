import type { FromMenu, MenuHello, ToMenu } from '../logins';

/**
 * The tag name of the menu's host element, the only part of the menu the page can
 * reach. A plain `div`, since a page could claim a custom element name first.
 */
const TAG = 'div';

/** The gap between the field and the menu. */
const GAP = 4;
/** The closest the menu comes to the window's edges. */
const MARGIN = 8;
const MIN_WIDTH = 240;
const MAX_WIDTH = 360;
/** How often an open menu checks that its field is still on the page and in the same place. */
const WATCH_MS = 250;

/**
 * The frame's look and the hidden live region. They live in the closed shadow
 * root, so page styles reach only the host element, whose styles are inline.
 */
const SHADOW_CSS = `
iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%), 0 1px 3px rgb(0 0 0 / 12%);
}
.say {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;

/**
 * The host's own styles. `all: initial` comes first and everything is
 * `!important`, which beats any page rule for the host. The properties a page
 * could use to hide the menu or let clicks pass through it are set again by name.
 */
const HOST_STYLES: Record<string, string> = {
  all: 'initial',
  position: 'fixed',
  inset: 'auto',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  overflow: 'visible',
  // The frame lays out at the menu's width before it shows, so it can measure its height.
  display: 'block',
  visibility: 'hidden',
  opacity: '1',
  transform: 'none',
  filter: 'none',
  'clip-path': 'none',
  'pointer-events': 'auto',
  contain: 'none',
  'color-scheme': 'normal'
};

/** What {@link LoginMenu} reports to the content script. */
export interface MenuEvents {
  /** Someone picked the login of `username`. */
  pick(username: string): void;
  /** The menu should close: Escape, nothing to show, or its field went away. */
  close(): void;
}

/**
 * The saved logins under `field`, in an extension frame inside a closed shadow
 * root. The frame shows in the top layer through `popover="manual"`, so the
 * page's stacking and overflow can't hide or clip it, and nothing but the
 * content script closes it.
 */
export class LoginMenu {
  readonly field: HTMLInputElement;
  /** The element on the page. While the menu frame has the focus, it is the document's active element. */
  readonly host: HTMLElement;
  #port: MessagePort;
  #events: MenuEvents;
  /** Where screen readers hear what the menu offers, since the keyboard stays in the page's field. */
  #say: HTMLElement;
  #count = 0;
  #selected = -1;
  #height = 0;
  #frame = 0;
  #watch: ReturnType<typeof setInterval>;

  /**
   * Builds the menu for `field` and starts loading its frame. It shows once the
   * frame says how tall it is. It throws when the page's code keeps it from
   * building its shadow root.
   *
   * @param token The background's token for this menu, which the frame claims its logins with.
   */
  constructor(field: HTMLInputElement, token: string, events: MenuEvents) {
    this.field = field;
    this.#events = events;
    this.host = document.createElement(TAG);
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    const frame = document.createElement('iframe');
    const src = chrome.runtime.getURL('menu.html');
    frame.src = src;
    frame.title = 'devlanes saved logins';
    this.#say = document.createElement('div');
    this.#say.className = 'say';
    this.#say.setAttribute('aria-live', 'polite');
    root.append(style, frame, this.#say);

    this.host.popover = 'manual';
    this.#style(HOST_STYLES);

    const channel = new MessageChannel();
    this.#port = channel.port1;
    this.#port.onmessage = (event: MessageEvent<FromMenu>) => this.#receive(event.data);
    // The target origin keeps the token and the port from reaching anything but
    // the extension's page, should the frame be navigated elsewhere. The frame's
    // URL may carry a dynamic id, but the page it loads has the extension's own origin.
    frame.addEventListener(
      'load',
      () => {
        const hello: MenuHello = { devlanes: 'menu', token };
        frame.contentWindow?.postMessage(hello, `chrome-extension://${chrome.runtime.id}`, [
          channel.port2
        ]);
      },
      { once: true }
    );

    window.addEventListener('scroll', this.#schedule, { capture: true, passive: true });
    window.addEventListener('resize', this.#schedule, { passive: true });
    // Scrolls and resizes don't cover a field the page removes or moves on its own.
    this.#watch = setInterval(() => this.#placeOrClose(), WATCH_MS);
    document.documentElement.append(this.host);
    this.#place();
  }

  /**
   * Handles a key pressed in the page's field and gives `true` when the menu used
   * it, so the page never sees it.
   */
  key(event: KeyboardEvent): boolean {
    if (this.#count === 0) {
      return false;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const last = this.#count - 1;
      const down = event.key === 'ArrowDown';
      this.#selected = down
        ? this.#selected >= last
          ? 0
          : this.#selected + 1
        : this.#selected <= 0
          ? last
          : this.#selected - 1;
      this.#send({ type: 'select', index: this.#selected });
      return true;
    }
    if (event.key === 'Enter' && this.#selected >= 0) {
      this.#send({ type: 'choose' });
      return true;
    }
    if (event.key === 'Escape') {
      this.#events.close();
      return true;
    }
    return false;
  }

  /** Removes the menu from the page. */
  close(): void {
    window.removeEventListener('scroll', this.#schedule, { capture: true });
    window.removeEventListener('resize', this.#schedule);
    cancelAnimationFrame(this.#frame);
    clearInterval(this.#watch);
    this.#port.close();
    this.host.remove();
  }

  /** Handles a message from the menu frame. */
  #receive(message: FromMenu): void {
    switch (message?.type) {
      case 'ready':
        if (message.count <= 0) {
          this.#events.close();
          return;
        }
        this.#count = message.count;
        this.#height = message.height;
        if (!this.#place()) {
          this.#events.close();
          return;
        }
        this.#style({ visibility: 'visible' });
        this.host.showPopover();
        return;
      case 'hover':
        this.#selected = message.index;
        return;
      case 'say':
        // Set as text, never as HTML, though it comes from the extension's own frame.
        if (typeof message.text === 'string') {
          this.#say.textContent = message.text;
        }
        return;
      case 'pick':
        if (typeof message.username === 'string') {
          this.#events.pick(message.username);
        }
        return;
      case 'close':
        this.#events.close();
        return;
    }
  }

  /** Sends `message` to the menu frame. */
  #send(message: ToMenu): void {
    this.#port.postMessage(message);
  }

  /** Places the menu again on the next frame, after a scroll or a resize. */
  #schedule = () => {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#placeOrClose());
  };

  /** Places the menu, or closes it when its field or its own element left the page. */
  #placeOrClose(): void {
    if (!this.host.isConnected || !this.#place()) {
      this.#events.close();
    }
  }

  /**
   * Puts the menu under its field, or above it when there's no room below. Gives
   * `false` when the field left the page or has no box any more.
   */
  #place(): boolean {
    const rect = this.field.getBoundingClientRect();
    if (!this.field.isConnected || (rect.width === 0 && rect.height === 0)) {
      return false;
    }
    const width = Math.min(Math.max(rect.width, MIN_WIDTH), MAX_WIDTH, innerWidth - 2 * MARGIN);
    const left = Math.min(Math.max(rect.left, MARGIN), innerWidth - width - MARGIN);
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - this.#height;
    const top = below + this.#height > innerHeight - MARGIN && above >= MARGIN ? above : below;
    this.#style({
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: `${Math.round(width)}px`,
      height: `${this.#height}px`
    });
    return true;
  }

  /**
   * Sets `styles` on the host with `!important`. Inline important styles win over
   * every page rule, so a page stylesheet can't move or hide the menu.
   */
  #style(styles: Record<string, string>): void {
    for (const [name, value] of Object.entries(styles)) {
      this.host.style.setProperty(name, value, 'important');
    }
  }
}
