import { render } from 'preact';
import type { Claimed, FromMenu, MenuHello, MenuRequest, ToMenu } from '../logins';
import { Menu, type MenuChannel } from './app';
import './style.css';

/** True when `data` has the shape of the content script's first message. */
function isHello(data: unknown): data is MenuHello {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as MenuHello).devlanes === 'menu' &&
    typeof (data as MenuHello).token === 'string'
  );
}

/** The channel over the port the content script sent. */
function portChannel(port: MessagePort): MenuChannel {
  return {
    post: (message: FromMenu) => port.postMessage(message),
    listen(listener) {
      port.onmessage = (event: MessageEvent<ToMenu>) => {
        const message = event.data;
        if (message?.type === 'select' && typeof message.index === 'number') {
          listener(message);
        } else if (message?.type === 'choose') {
          listener(message);
        }
      };
      return () => {
        port.onmessage = null;
      };
    }
  };
}

let accepted = false;

/**
 * Waits for the content script's port. The page can post this frame messages
 * too, so a port counts only once the background accepts the token that came
 * with it. The background made that token for the content script, and the page
 * never sees it.
 */
async function onMessage(event: MessageEvent): Promise<void> {
  const [port] = event.ports;
  if (accepted || event.source !== window.parent || !port || !isHello(event.data)) {
    return;
  }
  const request: MenuRequest = { type: 'menu:claim', token: event.data.token };
  const claimed: Claimed | null = await chrome.runtime.sendMessage(request);
  if (accepted || !claimed) {
    return;
  }
  accepted = true;
  const channel = portChannel(port);
  if (claimed.logins.length === 0) {
    channel.post({ type: 'close' });
    return;
  }
  render(<Menu claimed={claimed} channel={channel} />, document.getElementById('root')!);
}

window.addEventListener('message', (event) => {
  onMessage(event).catch((error) => console.error(error));
});
