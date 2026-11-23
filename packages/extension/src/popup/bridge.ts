import type { UseParams } from '@devlanes/protocol';
import {
  type BackgroundMessage,
  POPUP_PORT,
  type PopupMessage,
  type Snapshot,
  type UseMethod,
  type UseReply
} from '../state';

/** What the popup needs from the browser. The preview page passes a fake one. */
export interface Bridge {
  /** Calls `listener` with each snapshot from the background. Returns a function that stops it. */
  watch(listener: (snapshot: Snapshot) => void): () => void;
  /** Sends `use` or `stop_and_use` through the background. */
  use(method: UseMethod, params: UseParams): Promise<UseReply>;
  /** Drops a notice for every popup. */
  dismiss(notice: number): void;
  /** The URL of the active tab, when the extension may read it. */
  currentPage(): Promise<string | undefined>;
  /** Opens `url` in a new tab. */
  open(url: string): void;
  /** Puts `text` on the clipboard. */
  copy(text: string): Promise<void>;
}

/**
 * The bridge over a `runtime` port to the background. Opening the port also
 * makes the background connect to the host when it isn't connected.
 */
export function chromeBridge(): Bridge {
  const port = chrome.runtime.connect({ name: POPUP_PORT });
  const listeners = new Set<(snapshot: Snapshot) => void>();
  const pending = new Map<number, (reply: UseReply) => void>();
  let last: Snapshot | undefined;
  let nextId = 1;

  port.onMessage.addListener((message: BackgroundMessage) => {
    if (message.type === 'snapshot') {
      last = message.snapshot;
      for (const listener of listeners) {
        listener(message.snapshot);
      }
    } else {
      pending.get(message.id)?.(message.reply);
      pending.delete(message.id);
    }
  });

  return {
    watch(listener) {
      listeners.add(listener);
      if (last) {
        listener(last);
      }
      return () => listeners.delete(listener);
    },
    use(method, params) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        port.postMessage({ type: 'use', id, method, params } satisfies PopupMessage);
      });
    },
    dismiss(notice) {
      port.postMessage({ type: 'dismiss', notice } satisfies PopupMessage);
    },
    async currentPage() {
      // Without the `tabs` permission, `url` is only set on tabs the host permissions cover.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.url;
    },
    open(url) {
      chrome.tabs.create({ url }).catch((error) => console.error(error));
    },
    copy(text) {
      return navigator.clipboard.writeText(text);
    }
  };
}
