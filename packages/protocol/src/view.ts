import { array, boolean, count, has, nullableString, object, ProtocolError, string } from './read';

/**
 * A lane source's state. Box sources only use `idle`, `starting`, `running` and
 * `failed`. A newer daemon may send other states, which the popup shows as they are.
 */
export type SourceState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'failed'
  | 'stopping'
  | 'unassigned'
  | 'no-config'
  | (string & {});

/** Why the daemon doesn't mirror a box's lane. A newer daemon may send other causes. */
export type SkipCause =
  | 'local_running'
  | 'local_stopped'
  | 'box_chosen'
  | 'box_earlier'
  | (string & {});

/**
 * A remote box this machine knows. `state` is the daemon's link state, such as
 * `connected`, `connecting`, `reconnecting` or `needs_auth`.
 */
export interface Box {
  name: string;
  state: string;
}

/** Set on a box source that doesn't serve the lane. */
export interface Skipped {
  cause: SkipCause;
  /** False when a plain `use` would be refused and the local lane has to stop first. */
  can_use: boolean;
}

/** A machine that has the lane: this machine when `box` is `null`, or a box. */
export interface Source {
  box: string | null;
  state: SourceState;
  /** Always `null` for a box, whose registry doesn't carry branches. */
  branch: string | null;
  serving: boolean;
  skipped?: Skipped;
}

/** A hostname this machine routes for the lane. `state` is a route state such as `ready` or `idle`. */
export interface Route {
  /** The hostname, or a wildcard such as `*.app.acme.localhost` that matches every name below it. */
  host: string;
  /** The URL that opens the route. It is `null` for a wildcard host, which has no single page. */
  url: string | null;
  service: string;
  state: string;
}

/** One lane reference, with every machine that has it. */
export interface Lane {
  ref: string;
  index: number;
  name: string;
  /** `null` for a lane that routes no hostname. The host may also leave it out. */
  domain: string | null;
  /** `null` for this machine, a box name for a box, and absent when nothing serves the lane. */
  served_by?: string | null;
  sources: Source[];
  routes: Route[];
}

/** A project and its lanes. */
export interface Project {
  name: string;
  lanes: Lane[];
}

/** What the popup shows: the boxes and every project's lanes. */
export interface View {
  boxes: Box[];
  projects: Project[];
}

/**
 * Reads a `view` event's `data`. Unknown fields are dropped. States and skip
 * causes stay open strings, so a new daemon value doesn't reject the whole view
 * in an older extension.
 */
export function parseView(value: unknown, path = '$'): View {
  const view = object(value, path);
  return {
    boxes: array(view.boxes, `${path}.boxes`, parseBox),
    projects: array(view.projects, `${path}.projects`, parseProject)
  };
}

/** Reads one entry of `boxes`. */
function parseBox(value: unknown, path: string): Box {
  const box = object(value, path);
  return {
    name: string(box.name, `${path}.name`),
    state: string(box.state, `${path}.state`)
  };
}

/** Reads one entry of `projects`. */
function parseProject(value: unknown, path: string): Project {
  const project = object(value, path);
  return {
    name: string(project.name, `${path}.name`),
    lanes: array(project.lanes, `${path}.lanes`, parseLane)
  };
}

/** Reads one lane and checks that at most one of its sources serves it. */
function parseLane(value: unknown, path: string): Lane {
  const lane = object(value, path);
  const sources = array(lane.sources, `${path}.sources`, parseSource);
  if (sources.filter((source) => source.serving).length > 1) {
    throw new ProtocolError(`${path}.sources`, 'a list where at most one source serves');
  }
  const parsed: Lane = {
    ref: string(lane.ref, `${path}.ref`),
    index: count(lane.index, `${path}.index`),
    name: string(lane.name, `${path}.name`),
    domain: nullableString(lane.domain ?? null, `${path}.domain`),
    sources,
    routes: array(lane.routes, `${path}.routes`, parseRoute)
  };
  if (has(lane, 'served_by')) {
    parsed.served_by = nullableString(lane.served_by, `${path}.served_by`);
  }
  return parsed;
}

/** Reads one entry of a lane's `sources`. */
function parseSource(value: unknown, path: string): Source {
  const source = object(value, path);
  const parsed: Source = {
    box: nullableString(source.box, `${path}.box`),
    state: string(source.state, `${path}.state`),
    branch: nullableString(source.branch, `${path}.branch`),
    serving: boolean(source.serving, `${path}.serving`)
  };
  if (has(source, 'skipped')) {
    const skipped = object(source.skipped, `${path}.skipped`);
    parsed.skipped = {
      cause: string(skipped.cause, `${path}.skipped.cause`),
      can_use: boolean(skipped.can_use, `${path}.skipped.can_use`)
    };
  }
  return parsed;
}

/** Reads one entry of a lane's `routes`. */
function parseRoute(value: unknown, path: string): Route {
  const route = object(value, path);
  return {
    host: string(route.host, `${path}.host`),
    url: nullableString(route.url, `${path}.url`),
    service: string(route.service, `${path}.service`),
    state: string(route.state, `${path}.state`)
  };
}
