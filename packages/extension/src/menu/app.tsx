import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Claimed, FromMenu, ToMenu } from '../logins';
import { Mark } from '../mark';

/** The private channel to the content script that opened the menu. The preview passes a fake one. */
export interface MenuChannel {
  post(message: FromMenu): void;
  /** Calls `listener` with each message from the content script. Returns a function that stops it. */
  listen(listener: (message: ToMenu) => void): () => void;
}

/** The props of {@link Menu}. */
export interface MenuProps {
  claimed: Claimed;
  channel: MenuChannel;
  /** The login highlighted at first, for the preview. */
  selected?: number;
}

/** What screen readers hear when the menu opens. */
function offer(project: string, count: number): string {
  return count === 1
    ? `devlanes has 1 saved login for ${project}. Press Down to choose it.`
    : `devlanes has ${count} saved logins for ${project}. Press Down to choose one.`;
}

/**
 * The list of a project's saved logins under a sign-in field. The keyboard stays
 * in the page's field, so the content script sends the arrow keys and Enter
 * here. The menu's own keys work too once someone clicks into it.
 */
export function Menu({ claimed, channel, selected: initial = -1 }: MenuProps) {
  const { project, logins } = claimed;
  const [selected, setSelected] = useState(initial);
  const list = useRef<HTMLDivElement>(null);
  // The listener outlives renders, so it reads the latest highlight through a ref.
  const current = useRef(selected);
  current.current = selected;

  /** Hands the login at `index` to the content script. */
  const pick = (index: number) => {
    const login = logins[index];
    if (login) {
      channel.post({ type: 'pick', username: login.username });
    }
  };

  /** Highlights `index` and tells the content script, which owns the highlight for the page's keys. */
  const hover = (index: number) => {
    setSelected(index);
    channel.post({ type: 'hover', index });
  };

  useEffect(
    () =>
      channel.listen((message) => {
        if (message.type === 'select') {
          setSelected(message.index);
        } else {
          pick(current.current);
        }
      }),
    [channel]
  );

  // The frame starts with no height, so the content script sizes it from this.
  useLayoutEffect(() => {
    const height = Math.ceil(list.current?.getBoundingClientRect().height ?? 0);
    channel.post({ type: 'ready', count: logins.length, height });
    channel.post({ type: 'say', text: offer(project, logins.length) });
  }, [channel, project, logins.length]);

  // The focus stays in the page's field, so screen readers hear each highlight through the content script.
  useEffect(() => {
    const login = logins[selected];
    if (login) {
      channel.post({
        type: 'say',
        text: `${login.username}, ${login.lane}, ${selected + 1} of ${logins.length}.`
      });
    }
  }, [channel, logins, selected]);

  // Scrolls only the list. `scrollIntoView` would also scroll the page around the menu.
  useEffect(() => {
    const option = list.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    const box = option?.parentElement;
    if (!option || !box) {
      return;
    }
    if (option.offsetTop < box.scrollTop) {
      box.scrollTop = option.offsetTop;
    } else if (option.offsetTop + option.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight;
    }
  }, [selected]);

  /** The menu's own keys, for when it has the focus. */
  const onKeyDown = (event: KeyboardEvent) => {
    const last = logins.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: selected >= last ? 0 : selected + 1,
      ArrowUp: selected <= 0 ? last : selected - 1,
      Home: 0,
      End: last
    };
    const to = moves[event.key];
    if (to !== undefined) {
      event.preventDefault();
      hover(to);
    } else if (event.key === 'Enter' && selected >= 0) {
      event.preventDefault();
      pick(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      channel.post({ type: 'close' });
    }
  };

  return (
    <div class="menu" ref={list}>
      <header class="hd">
        <Mark />
        <span class="brand">devlanes</span>
        <span class="project">{project}</span>
      </header>
      <div
        class="options"
        role="listbox"
        tabIndex={0}
        aria-label={`Saved logins for ${project}`}
        aria-activedescendant={selected >= 0 ? `login-${selected}` : undefined}
        onKeyDown={onKeyDown}
      >
        {logins.map((login, index) => (
          // The listbox holds the focus and the keys, so an option only takes the pointer.
          // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keys.
          <div
            key={login.username}
            id={`login-${index}`}
            data-index={index}
            class="option"
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            aria-label={`${login.username}, last used on ${login.lane}`}
            // A long username is cut short in the list, so the full one shows on hover.
            title={login.username}
            onPointerMove={() => index !== selected && hover(index)}
            onClick={() => pick(index)}
          >
            <span class="user">{login.username}</span>
            <span class="lane">{login.lane}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
