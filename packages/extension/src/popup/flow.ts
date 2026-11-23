import type { Lane, UseResult } from '@devlanes/protocol';
import type { UseReply } from '../state';

/** What a lane shows under its routes while a switch runs or after it answered. */
export type Flow =
  | { kind: 'busy'; text: string }
  | { kind: 'confirm'; box: string | null; localLane: string }
  | { kind: 'commands'; text: string; box: string | null; commands: string[] }
  | { kind: 'note'; text: string }
  | { kind: 'error'; text: string };

/** Where a source runs, in words. */
export function placeOf(box: string | null): string {
  return box ?? 'this machine';
}

/** The line a successful switch leaves, or `undefined` when the view says it all. */
export function resultFlow(result: UseResult): Flow | undefined {
  if (!result.pending) {
    return undefined;
  }
  const to = placeOf(result.box);
  switch (result.waits_for) {
    case 'connect':
      return { kind: 'note', text: `${result.lane} switches to ${to} once ${to} connects.` };
    case 'mirror':
      return {
        kind: 'note',
        text: `${result.lane} switches to ${to} once this machine mirrors ${to}'s ${result.lane}.`
      };
    default:
      return { kind: 'note', text: `${result.lane} switches to ${to} soon.` };
  }
}

/** The flow that follows `reply` to a switch of `lane` to `box`. */
export function replyFlow(lane: Lane, box: string | null, reply: UseReply): Flow | undefined {
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
