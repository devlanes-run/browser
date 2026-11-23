import type { Lane, Project, Route, Source, View } from '@devlanes/protocol';

/** A lane of the view, with its project and the route that matched. */
export interface RouteAt {
  project: Project;
  lane: Lane;
  route: Route;
}

/** The name below which a wildcard host such as `*.acme.localhost` matches, or `undefined`. */
function wildcardBase(host: string): string | undefined {
  return host.startsWith('*.') ? host.slice(2).toLowerCase() : undefined;
}

/** True when `route` routes `hostname`: the same host, or a name below a wildcard host. */
function routes(route: Route, hostname: string): boolean {
  const base = wildcardBase(route.host);
  return base === undefined ? route.host.toLowerCase() === hostname : hostname.endsWith(`.${base}`);
}

/**
 * `hostname` as routes write it: lower case, without the trailing dot of a fully
 * qualified name such as `app.acme.localhost.`, which reaches the same proxy.
 */
function normalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

/**
 * Finds the lane whose routes hold `hostname`. An exact host wins over a wildcard,
 * and a longer wildcard over a shorter one, so a tenant wildcard beats a fallback
 * under the lane's domain.
 */
export function findRoute(view: View, hostname: string): RouteAt | undefined {
  const name = normalHost(hostname);
  let best: RouteAt | undefined;
  let bestRank = -1;
  for (const project of view.projects) {
    for (const lane of project.lanes) {
      for (const route of lane.routes) {
        if (!routes(route, name)) {
          continue;
        }
        const base = wildcardBase(route.host);
        // Any exact host outranks every wildcard, whose rank is the length of its base.
        const rank = base === undefined ? Number.MAX_SAFE_INTEGER : base.length;
        if (rank > bestRank) {
          best = { project, lane, route };
          bestRank = rank;
        }
      }
    }
  }
  return best;
}

/** The routes of `lane` for `service`, wildcard or exact as `wildcard` says. */
function serviceRoutes(lane: Lane, service: string, wildcard: boolean): Route[] {
  return lane.routes.filter(
    (route) => route.service === service && (wildcardBase(route.host) !== undefined) === wildcard
  );
}

/** `route.url` as a URL, or `undefined` when it doesn't parse. */
function parse(route: Route): URL | undefined {
  return URL.canParse(route.url) ? new URL(route.url) : undefined;
}

/** True when `url` is a web URL, the only kind the popup opens in a tab. */
function isWeb(url: URL | undefined): boolean {
  return url?.protocol === 'https:' || url?.protocol === 'http:';
}

/**
 * `route.url` with `hostname` in place of its host, keeping its scheme and port,
 * or `undefined` when that isn't a web URL. A wildcard route's URL may hold the
 * `*` or be no URL at all, so HTTPS is the fallback.
 */
function withHost(route: Route, hostname: string): URL | undefined {
  const url = parse(route) ?? new URL('https://localhost');
  if (!isWeb(url)) {
    return undefined;
  }
  url.hostname = hostname;
  return url;
}

/**
 * The URL of `page` in the lane `target`, or `undefined` when `target` has no
 * route a browser can open. `page` must be on a route of `from`.
 *
 * The target route is the one at the same place among the routes of the same
 * service, so a service with two hostnames maps each to its counterpart. A
 * wildcard page keeps the labels in front of the wildcard, so a tenant page stays
 * on its tenant. Without a route for the service, the target lane's first exact
 * route opens at its own path, since the page's path means nothing there.
 */
export function pageIn(from: RouteAt, page: URL, target: Lane): string | undefined {
  const { service } = from.route;
  const base = wildcardBase(from.route.host);
  let url: URL | undefined;
  if (base !== undefined) {
    const route = serviceRoutes(target, service, true).at(
      Math.max(0, serviceRoutes(from.lane, service, true).indexOf(from.route))
    );
    const targetBase = route && wildcardBase(route.host);
    if (route && targetBase !== undefined) {
      const labels = normalHost(page.hostname).slice(0, -base.length - 1);
      url = withHost(route, `${labels}.${targetBase}`);
    }
  }
  if (!url) {
    const exact = serviceRoutes(target, service, false);
    const index =
      base === undefined ? serviceRoutes(from.lane, service, false).indexOf(from.route) : 0;
    const route = exact[Math.max(0, index)] ?? exact[0];
    url = route && openable(route) ? parse(route) : undefined;
  }
  if (!url) {
    return firstRoute(target)?.url;
  }
  url.pathname = page.pathname;
  url.search = page.search;
  url.hash = page.hash;
  return url.href;
}

/**
 * True when `route` has a single host and a web URL. The popup opens route URLs
 * in tabs, so a URL the host sent with another scheme never reaches `tabs.create`.
 */
export function openable(route: Route): boolean {
  return wildcardBase(route.host) === undefined && isWeb(parse(route));
}

/** The first route of `lane` a browser can open. */
export function firstRoute(lane: Lane): Route | undefined {
  return lane.routes.find(openable);
}

/** The source that serves `lane`, else this machine's, else the first one. */
export function mainSource(lane: Lane): Source | undefined {
  return (
    lane.sources.find((source) => source.serving) ??
    lane.sources.find((source) => source.box === null) ??
    lane.sources[0]
  );
}

/** The badge of a tab on `url`: the lane's index, marked when a box serves the lane. */
export interface Badge {
  text: string;
  title: string;
  /** The box that serves the lane, or `undefined` for this machine or nothing. */
  box: string | undefined;
}

/** The badge for a tab on `url`, or `undefined` when no lane routes its host. */
export function badgeFor(view: View | undefined, url: string | undefined): Badge | undefined {
  if (!view || !url) {
    return undefined;
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined;
  }
  const at = findRoute(view, hostname);
  if (!at) {
    return undefined;
  }
  const { lane } = at;
  const box = lane.served_by ?? undefined;
  let title: string;
  if (lane.served_by === undefined) {
    title = `${lane.ref} ${lane.name}. Nothing serves it.`;
  } else {
    title = `${lane.ref} ${lane.name}, served by ${lane.served_by ?? 'this machine'}`;
  }
  return {
    // A badge fits about four characters, so the mark is a single dot.
    text: box === undefined ? `${lane.index}` : `${lane.index}\u2022`,
    title,
    box
  };
}
