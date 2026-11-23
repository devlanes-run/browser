/** The parts of `chrome.runtime.MessageSender` the check reads. The browser sets them. */
export interface PortSender {
  id?: string | undefined;
  url?: string | undefined;
  tab?: unknown;
}

/**
 * True when `sender` is this extension's popup, the only page that may open the
 * popup port. The port hands out every lane and accepts `use` and `stop_and_use`,
 * so a content script, a lane page's renderer or an extension page in a tab gets
 * nothing. The action popup has no tab, and its URL is `/popup.html` on the
 * extension's own id.
 */
export function isPopupSender(sender: PortSender | undefined, extensionId: string): boolean {
  if (!sender || sender.id !== extensionId || sender.tab !== undefined) {
    return false;
  }
  if (!sender.url || !URL.canParse(sender.url)) {
    return false;
  }
  const url = new URL(sender.url);
  return (
    url.protocol === 'chrome-extension:' &&
    url.host === extensionId &&
    url.pathname === '/popup.html'
  );
}
