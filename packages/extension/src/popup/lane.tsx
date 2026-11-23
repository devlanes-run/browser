import type { Lane, Source } from '@devlanes/protocol';
import { useEffect, useRef, useState } from 'preact/hooks';
import { mainSource, openUrl, pageIn, type RouteAt } from '../lanes';
import type { UseMethod } from '../state';
import type { Bridge } from './bridge';
import { type Flow, placeOf, replyFlow } from './flow';
import { shapeOf, skipWords, wordClass, words } from './words';

/** The props of {@link LaneItem}. */
export interface LaneProps {
  bridge: Bridge;
  lane: Lane;
  /** The other lanes of the project, for "Open this page in". */
  siblings: Lane[];
  /** Set when the current tab is on a route of this lane. */
  here: { at: RouteAt; page: URL } | undefined;
  /** False while the daemon or the host is away, which disables the box switch. */
  live: boolean;
}

/** The 8 px shape of a state. Hidden from screen readers, since a word next to it says the state. */
export function Shape({ state }: { state: string }) {
  return <span class={`st ${shapeOf(state)}`} aria-hidden="true" />;
}

/**
 * A route as a link that opens `url` in a new tab. The text is the host and port,
 * so a URL with a path gets its full form as the hover text.
 */
function RouteLink({ bridge, url }: { bridge: Bridge; url: URL }) {
  const hidden = url.pathname !== '/' || url.search !== '' || url.hash !== '';
  return (
    <a
      class="lk"
      href={url.href}
      title={hidden ? url.href : undefined}
      onClick={(event) => {
        event.preventDefault();
        bridge.open(url.href);
      }}
    >
      {url.host}
    </a>
  );
}

/** A command on one line, with a button that copies it. */
function Command({ bridge, command }: { bridge: Bridge; command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <li class="cmd">
      <code>{command}</code>
      <button
        type="button"
        class="copy"
        aria-label={copied ? `Copied ${command}` : `Copy ${command}`}
        onClick={() => {
          bridge.copy(command).then(
            () => setCopied(true),
            (error) => console.error(error)
          );
        }}
      >
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </li>
  );
}

/** What to do about a lane nothing serves. */
function Unserved({ lane }: { lane: Lane }) {
  return lane.sources.some((source) => source.box === null) ? (
    <p class="line2 warn">
      Nothing serves {lane.ref}. Start it with <code>devlanes start --lane {lane.ref}</code>.
    </p>
  ) : (
    <p class="line2 warn">
      Nothing serves {lane.ref}. It comes back when a box that has it connects.
    </p>
  );
}

/**
 * One lane: its state, reference, name and branch, every route as a link, the
 * box picker when more than one machine has the lane, and "Open this page in"
 * when the current tab is on it.
 */
export function LaneItem({ bridge, lane, siblings, here, live }: LaneProps) {
  const [flow, setFlow] = useState<Flow | undefined>();
  const picker = useRef<HTMLFieldSetElement>(null);
  const source = mainSource(lane);
  const state = source?.state ?? 'idle';
  const unserved = lane.served_by === undefined;
  const branch = lane.sources.find((each) => each.branch !== null)?.branch;
  const many = lane.sources.length > 1;
  const busy = flow?.kind === 'busy';

  /** Sends `method` to switch the lane to `box`, showing its progress and answer. */
  const send = (method: UseMethod, box: string | null) => {
    const to = placeOf(box);
    setFlow({
      kind: 'busy',
      text:
        method === 'use'
          ? `Switching ${lane.ref} to ${to}.`
          : `Stopping ${lane.ref} on this machine, then switching to ${to}. This can take 30 seconds.`
    });
    bridge.use(method, { lane: lane.ref, box }).then((reply) => {
      setFlow(replyFlow(lane, box, reply));
    });
  };

  /** Switches to `target`, asking first when a plain switch would be refused. */
  const choose = (target: Source) => {
    if (target.skipped && !target.skipped.can_use) {
      setFlow({ kind: 'confirm', box: target.box, localLane: lane.ref });
      return;
    }
    send('use', target.box);
  };

  /** Closes the panel and gives the focus back to the picker it came from. */
  const close = () => {
    setFlow(undefined);
    // The picker's buttons are disabled while a switch runs, so this waits for the render.
    requestAnimationFrame(() =>
      picker.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    );
  };

  const targets = here
    ? siblings.flatMap((other) => {
        const url = pageIn(here.at, here.page, other);
        return url ? [{ lane: other, url }] : [];
      })
    : [];

  return (
    <li class={`lane${here ? ' here' : ''}`} aria-current={here ? 'page' : undefined}>
      <div class="hd">
        <Shape state={state} />
        <span class="ref">{lane.ref}</span>
        <span class="sub">{lane.name}</span>
        {here && <span class="pill accent">This tab</span>}
        <span class={`end ${unserved ? 'warn' : wordClass(state)}`}>{words(state)}</span>
      </div>
      {((branch && branch !== lane.name) || (!many && lane.served_by)) && (
        <p class="meta">
          {branch && branch !== lane.name && <span class="branch">{branch}</span>}
          {!many && lane.served_by && <span>Served by {lane.served_by}</span>}
        </p>
      )}
      {unserved && <Unserved lane={lane} />}
      {lane.routes.length > 0 && (
        <ul class="routes">
          {lane.routes.map((route) => {
            const url = openUrl(route);
            return (
              <li key={route.host}>
                {url ? (
                  <RouteLink bridge={bridge} url={url} />
                ) : (
                  <span class="wild" title="A wildcard host, which has no single page to open">
                    {route.host}
                  </span>
                )}
                <span class="sec">{route.service}</span>
                {route.state !== 'ready' && (
                  <span class={wordClass(route.state)}>{words(route.state)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {targets.length > 0 && (
        <div class="open">
          <p class="label">Open this page in</p>
          <div class="chips">
            {targets.map(({ lane: other, url }) => (
              <button
                key={other.ref}
                type="button"
                class="chip"
                title={url}
                onClick={() => bridge.open(url)}
              >
                <span class="ref">{other.ref}</span>
                <span class="sec">{other.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {many && (
        <fieldset ref={picker} class="picker" aria-label={`Machine that serves ${lane.ref}`}>
          <span class="label">Served by</span>
          {lane.sources.map((each) => (
            <button
              key={each.box ?? ''}
              type="button"
              class="seg"
              aria-pressed={each.serving}
              disabled={!live || busy || each.serving}
              title={each.skipped ? skipWords(each.skipped.cause) : words(each.state)}
              onClick={() => choose(each)}
            >
              {/* The title carries the state, so the name stays the machine's. */}
              <span class={`st ${shapeOf(each.state)}`} aria-hidden="true" />
              {each.box ?? 'This machine'}
            </button>
          ))}
        </fieldset>
      )}
      {flow && (
        <FlowView
          bridge={bridge}
          flow={flow}
          lane={lane}
          live={live}
          onSend={send}
          onClose={close}
        />
      )}
    </li>
  );
}

/** The props of {@link FlowView}. */
interface FlowProps {
  bridge: Bridge;
  flow: Flow;
  lane: Lane;
  live: boolean;
  onSend: (method: UseMethod, box: string | null) => void;
  onClose: () => void;
}

/** The state of a switch: progress, the stop question, commands to run, or the answer. */
function FlowView({ bridge, flow, lane, live, onSend, onClose }: FlowProps) {
  const panel = useRef<HTMLDivElement>(null);
  const asks = flow.kind === 'confirm' || flow.kind === 'commands';
  // A panel that asks for a decision takes the focus, so keyboard users land on it.
  useEffect(() => {
    if (asks) {
      panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [flow.kind, asks]);

  switch (flow.kind) {
    case 'busy':
      return (
        <div class="flow" role="status">
          <Shape state="starting" />
          <p>{flow.text}</p>
        </div>
      );
    case 'confirm':
      return (
        <div ref={panel} class="flow ask" role="alert">
          <p>{`${flow.localLane} runs on this machine. Stop it and switch?`}</p>
          <div class="acts">
            <button type="button" class="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={!live}
              onClick={() => onSend('stop_and_use', flow.box)}
            >
              Stop and switch
            </button>
          </div>
        </div>
      );
    case 'commands':
      return (
        <div ref={panel} class="flow ask" role="alert">
          <p>{flow.text}</p>
          <ul class="cmds" aria-label={`Commands that free the ports of ${lane.ref}`}>
            {flow.commands.map((command) => (
              <Command key={command} bridge={bridge} command={command} />
            ))}
          </ul>
          <div class="acts">
            <button type="button" class="btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={!live}
              onClick={() => onSend('use', flow.box)}
            >
              Switch again
            </button>
          </div>
        </div>
      );
    case 'note':
    case 'error':
      return (
        <div class={`flow ${flow.kind}`} role="status">
          <p>{flow.text}</p>
          <button type="button" class="x" aria-label="Dismiss message" onClick={onClose}>
            <Cross />
          </button>
        </div>
      );
  }
}

/** The close icon. */
export function Cross() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
