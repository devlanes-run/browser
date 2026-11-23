// States as the popup shows them, after crates/mcp-ui/ui/src/utils/state.ts in devlanes.

import type { Box } from '@devlanes/protocol';

/** The status shapes the stylesheet draws: dot, ring, spinning arc, diamond. */
export type ShapeName = 'ok' | 'info' | 'warn' | 'busy' | 'fail' | 'idle';

/** The shape of a lane, source, route or box state. A state the popup doesn't know is a ring. */
export function shapeOf(state: string): ShapeName {
  switch (state) {
    case 'starting':
    case 'stopping':
    case 'connecting':
    case 'reconnecting':
      return 'busy';
    case 'running':
    case 'ready':
    case 'connected':
      return 'ok';
    case 'failed':
      return 'fail';
    case 'needs_auth':
    case 'needs_pairing':
    case 'unassigned':
    case 'no-config':
      return 'warn';
    default:
      return 'idle';
  }
}

/** The class that colours a state's word. Healthy states stay quiet. */
export function wordClass(state: string): string {
  switch (shapeOf(state)) {
    case 'fail':
      return 'danger';
    case 'warn':
      return 'warn';
    default:
      return 'sec';
  }
}

/** A state code as words: `no-config` is `no config`. */
export function words(state: string): string {
  return state.replace(/[_-]/g, ' ');
}

/**
 * Why the daemon doesn't mirror a box's lane, for the box button's tooltip, in the
 * TUI's words for a skipped lane: mirrored and chosen.
 */
export function skipWords(cause: string): string {
  switch (cause) {
    case 'local_running':
      return 'Not mirrored here. The lane runs on this machine.';
    case 'local_stopped':
      return 'Not mirrored here. The stopped lane on this machine keeps its hostnames.';
    case 'box_chosen':
      return 'Not mirrored here. Another box is chosen for the lane.';
    case 'box_earlier':
      return 'Not mirrored here. A box that connected earlier serves the lane.';
    default:
      return `Not mirrored here (${words(cause)}).`;
  }
}

/** One sentence for a box whose link is down, after the TUI's box pane. */
export function boxDown(box: Box): string {
  switch (box.state) {
    case 'needs_auth':
      return `${box.name} needs you to sign in again, so its lanes don't show.`;
    case 'needs_pairing':
      return `${box.name} needs a new pairing code, so its lanes don't show.`;
    case 'connecting':
    case 'reconnecting':
      return `${box.name} is reconnecting, so its lanes don't show.`;
    default:
      return `${box.name} is ${words(box.state)}, so its lanes don't show.`;
  }
}
