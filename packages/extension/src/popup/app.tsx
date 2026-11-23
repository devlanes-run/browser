import { PROTOCOL_VERSION, type Project } from '@devlanes/protocol';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { findRoute } from '../lanes';
import type { Snapshot, Status } from '../state';
import type { Bridge } from './bridge';
import { Cross, LaneItem } from './lane';
import { boxDown, type ShapeName } from './words';

/** The devlanes mark: three rounded bars staggered right, the top one in paint. */
function Mark() {
  return (
    <svg class="mark" viewBox="8 16 48 32" aria-hidden="true" focusable="false">
      <rect x="8" y="16" width="32" height="8" rx="4" fill="var(--paint)" />
      <rect x="16" y="28" width="32" height="8" rx="4" />
      <rect x="24" y="40" width="32" height="8" rx="4" />
    </svg>
  );
}

/** The short word and the shape of each status, for the header. */
const STATUS: Record<Status['state'], { word: string; shape: ShapeName }> = {
  connecting: { word: 'Connecting', shape: 'busy' },
  running: { word: 'Running', shape: 'ok' },
  daemon_stopped: { word: 'Stopped', shape: 'idle' },
  outdated: { word: 'Outdated', shape: 'warn' },
  not_installed: { word: 'Not set up', shape: 'warn' },
  protocol_mismatch: { word: 'Incompatible', shape: 'fail' },
  host_failed: { word: 'Host stopped', shape: 'fail' }
};

/** Shell commands inside a sentence, in the mono font. */
function Cmd({ children }: { children: ComponentChildren }) {
  return <code>{children}</code>;
}

/** What's wrong with the connection and what to do, or nothing while it works. */
function StatusLine({ status }: { status: Status }) {
  switch (status.state) {
    case 'connecting':
    case 'running':
      return null;
    case 'daemon_stopped':
      return (
        <p class="line warn">
          {status.message ?? (
            <>
              devlanes isn't running. Run <Cmd>devlanes</Cmd> in a terminal.
            </>
          )}
        </p>
      );
    case 'outdated':
      return (
        <p class="line warn">
          {status.message ?? (
            <>
              The devlanes daemon is older than its browser host. Restart it with{' '}
              <Cmd>devlanes daemon restart</Cmd>.
            </>
          )}
        </p>
      );
    case 'not_installed':
      return (
        <p class="line warn">
          The devlanes host isn't set up for this browser. Run <Cmd>devlanes setup --browser</Cmd>,
          then reopen this popup.
        </p>
      );
    case 'protocol_mismatch':
      return (
        <p class="line danger">
          {Math.max(...status.supported) > PROTOCOL_VERSION
            ? 'This version of devlanes is newer than the extension. Update the extension from devlanes-run/browser, then reopen this popup.'
            : 'This extension needs a newer devlanes. Update devlanes, then reopen this popup.'}
        </p>
      );
    case 'host_failed':
      return (
        <div class="line danger">
          <p>
            The devlanes host stopped. Run <Cmd>devlanes doctor</Cmd> to check the browser setup.
          </p>
          <p class="meta">{status.detail}</p>
        </div>
      );
  }
}

/** The projects of the view, the one the current tab is on first. */
function ordered(projects: Project[], first: Project | undefined): Project[] {
  return first ? [first, ...projects.filter((project) => project !== first)] : projects;
}

/** The popup: the connection, notices, then every project with its lanes. */
export function App({ bridge }: { bridge: Bridge }) {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>();
  const [page, setPage] = useState<URL | undefined>();

  useEffect(() => bridge.watch(setSnapshot), [bridge]);
  useEffect(() => {
    bridge.currentPage().then(
      (url) => setPage(url && URL.canParse(url) ? new URL(url) : undefined),
      (error) => console.error(error)
    );
  }, [bridge]);

  if (!snapshot) {
    return null;
  }
  const { status, view, notices } = snapshot;
  const live = status.state === 'running';
  const at = view && page ? findRoute(view, page.hostname) : undefined;
  const down = view?.boxes.filter((box) => box.state !== 'connected') ?? [];
  const head = STATUS[status.state];

  return (
    <main class={live || status.state === 'connecting' ? '' : 'dim'}>
      <header class="top">
        <Mark />
        <span class="brand">devlanes</span>
        {snapshot.devlanes && <span class="ver ter">{snapshot.devlanes}</span>}
        <span class="end">
          <span class={`st ${head.shape}`} aria-hidden="true" />
          <span>{head.word}</span>
        </span>
      </header>
      <StatusLine status={status} />
      {notices.length > 0 && (
        <ul class="notices">
          {notices.map(({ id, notice }) => (
            <li key={id} class="notice">
              <p>{notice.message}</p>
              <button
                type="button"
                class="x"
                aria-label="Dismiss"
                onClick={() => bridge.dismiss(id)}
              >
                <Cross />
              </button>
            </li>
          ))}
        </ul>
      )}
      {down.map((box) => (
        <p key={box.name} class="line warn">
          {boxDown(box)}
        </p>
      ))}
      {view && view.projects.length === 0 && (
        <p class="line">
          devlanes has no projects yet. Run <Cmd>devlanes start</Cmd> in a project to add one.
        </p>
      )}
      {view &&
        ordered(view.projects, at?.project).map((project) => (
          <section key={project.name} class="project" aria-label={project.name}>
            <h2 class="group">{project.name}</h2>
            <ul class="lanes">
              {project.lanes.map((lane) => (
                <LaneItem
                  key={lane.ref}
                  bridge={bridge}
                  lane={lane}
                  siblings={project.lanes.filter((other) => other !== lane)}
                  here={at && page && at.lane === lane ? { at, page } : undefined}
                  live={live}
                />
              ))}
            </ul>
          </section>
        ))}
    </main>
  );
}
