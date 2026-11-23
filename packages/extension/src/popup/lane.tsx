import type { Lane, Source, UseResult } from '@devlanes/protocol';
import { useEffect, useState } from 'preact/hooks';
import { mainSource, openable, pageIn, type RouteAt } from '../lanes';
import type { UseMethod, UseReply } from '../state';
import type { Bridge } from './bridge';
import { shapeOf, skipWords, wordClass, words } from './words';

/** What a lane shows under its routes while a switch runs or after it answered. */
type Flow =
  | { kind: 'busy'; text: string }
  | { kind: 'confirm'; box: string | null; localLane: string }
  | { kind: 'commands'; text: string; box: string | null; commands: string[] }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string };

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

/** The 8 px shape of a state, with the state as its accessible name. */
export function Shape({ state }: { state: string }) {
  return <span class={`st ${shapeOf(state)}`} role="img" aria-label={words(state)} />;
}

/** Where a source runs, in words. */
function placeOf(box: string | null): string {
  return box ?? 'this machine';
}

/** The line a successful switch leaves, or `undefined` when the view says it all. */
function resultFlow(result: UseResult): Flow | undefined {
  if (!result.pending) {
    return undefined;
  }
  const to = placeOf(result.box);
  const once =
    result.waits_for === 'connect' ? `once ${to} connects` : 'once this machine mirrors it';
  return { kind: 'note', text: `${result.lane} switches to ${to} ${once}.` };
}

/** The flow that follows `reply` to a switch of `lane` to `box`. */
function replyFlow(lane: Lane, box: string | null, reply: UseReply): Flow | undefined {
  if (reply.ok) {
    return resultFlow(reply.result);
  }
  const { error } = reply;
  if (error.code === 'local_lane_running') {
    const { holds, local_lane, commands } = error.data;
    return holds === 'processes'
      ? { kind: 'confirm', box, localLane: local_lane }
      : {
          kind: 'commands',
          text: `The containers of ${local_lane} hold its ports. Run these commands, then switch again.`,
          box,
          commands
        };
  }
  if (error.code === 'containers_hold_ports') {
    return {
      kind: 'commands',
      text: `${lane.ref} stopped on this machine, but its containers still hold the ports. Run these commands, then switch again.`,
      box,
      commands: error.data.commands
    };
  }
  return { kind: 'error', text: error.message };
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
        aria-label={`Copy ${command}`}
        onClick={() => {
          bridge.copy(command).then(
            () => setCopied(true),
            (error) => console.error(error)
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </li>
  );
}

/**
 * One lane: its state, reference, name and branch, every route as a link, the
 * box picker when more than one machine has the lane, and "Open this page in"
 * when the current tab is on it.
 */
export function LaneItem({ bridge, lane, siblings, here, live }: LaneProps) {
  const [flow, setFlow] = useState<Flow | undefined>();
  const source = mainSource(lane);
  const state = source?.state ?? 'idle';
  const branch = lane.sources.find((each) => each.branch !== null)?.branch;
  const picker = lane.sources.length > 1;
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
        <span class={`end ${wordClass(state)}`}>{words(state)}</span>
      </div>
      {(branch || !picker) && (
        <p class="meta">
          {branch && branch !== lane.name && <span class="branch">{branch}</span>}
          {!picker && lane.served_by !== null && (
            <span>
              {lane.served_by === undefined
                ? 'Nothing serves this lane.'
                : `Served by ${lane.served_by}`}
            </span>
          )}
        </p>
      )}
      {lane.routes.length > 0 && (
        <ul class="routes">
          {lane.routes.map((route) => (
            <li key={route.host}>
              {openable(route) ? (
                <a
                  class="lk"
                  href={route.url}
                  title={route.url}
                  onClick={(event) => {
                    event.preventDefault();
                    bridge.open(route.url);
                  }}
                >
                  {URL.canParse(route.url) ? new URL(route.url).host : route.host}
                </a>
              ) : (
                <span class="wild" title="A wildcard host, which has no single page to open">
                  {route.host}
                </span>
              )}
              <span class="ter">{route.service}</span>
              {route.state !== 'ready' && (
                <span class={wordClass(route.state)}>{words(route.state)}</span>
              )}
            </li>
          ))}
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
      {picker && (
        <fieldset class="picker" aria-label={`Machine that serves ${lane.ref}`}>
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
              <Shape state={each.state} />
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
          onClose={() => setFlow(undefined)}
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
  switch (flow.kind) {
    case 'busy':
      return (
        <div class="flow" role="status">
          <span class="st busy" aria-hidden="true" />
          <p>{flow.text}</p>
        </div>
      );
    case 'confirm':
      return (
        <div class="flow ask" role="alert">
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
        <div class="flow ask" role="alert">
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
          <button type="button" class="x" aria-label="Dismiss" onClick={onClose}>
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
