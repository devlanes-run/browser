import { PROTOCOL_VERSION, type Project } from '@devlanes/protocol';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { findRoute } from '../lanes';
import { CONNECTING, type Snapshot, type Status } from '../state';
import type { Bridge } from './bridge';
import { Cross, LaneItem } from './lane';
import { boxDown, type ShapeName } from './words';

/** Where the protocol mismatch text sends people for a newer extension. */
const REPOSITORY = 'https://github.com/devlanes-run/browser';

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
  daemon_stopped: { word: 'Daemon stopped', shape: 'idle' },
  outdated: { word: 'Daemon outdated', shape: 'warn' },
  not_installed: { word: 'Not set up', shape: 'warn' },
  protocol_mismatch: { word: 'Incompatible', shape: 'fail' },
  host_failed: { word: 'Not connected', shape: 'fail' }
};

/** Shell commands inside a sentence, in the mono font. */
function Cmd({ children }: { children: ComponentChildren }) {
  return <code>{children}</code>;
}

/**
 * What's wrong with the connection and what to do, or nothing while it works.
 * Known states get the popup's own sentence, with commands in mono, so the
 * daemon's plain-text message is never shown for them.
 */
function StatusLine({ status, bridge }: { status: Status; bridge: Bridge }) {
  switch (status.state) {
    case 'connecting':
    case 'running':
      return null;
    case 'daemon_stopped':
      return (
        <p class="line warn">
          devlanes isn't running. Run <Cmd>devlanes</Cmd> in a terminal.
        </p>
      );
    case 'outdated':
      return (
        <p class="line warn">
          The devlanes daemon is out of date. Restart the daemon with{' '}
          <Cmd>devlanes daemon restart</Cmd>.
        </p>
      );
    case 'not_installed':
      return (
        <p class="line warn">
          devlanes isn't set up for this browser. Run <Cmd>devlanes setup</Cmd>, then reopen this
          popup.
        </p>
      );
    case 'protocol_mismatch':
      return Math.max(...status.supported) > PROTOCOL_VERSION ? (
        <p class="line danger">
          This version of devlanes is newer than the extension. Update the extension from{' '}
          <a
            class="lk"
            href={REPOSITORY}
            onClick={(event) => {
              event.preventDefault();
              bridge.open(REPOSITORY);
            }}
          >
            devlanes-run/browser
          </a>
          , then reopen this popup.
        </p>
      ) : (
        <p class="line danger">
          This extension needs a newer devlanes. Update devlanes, then reopen this popup.
        </p>
      );
    case 'host_failed':
      // The browser's reason names causes the sentence can't, such as an allowed_origins mismatch.
      return (
        <div class="line">
          <p class="danger">
            The extension lost its connection to devlanes. It tries again by itself. If it keeps
            failing, run <Cmd>devlanes doctor</Cmd>.
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
  // The first paint never waits for the background: it shows "Connecting" until a snapshot comes.
  const [snapshot, setSnapshot] = useState<Snapshot>(CONNECTING);
  const [page, setPage] = useState<URL | undefined>();

  useEffect(() => bridge.watch(setSnapshot), [bridge]);
  useEffect(() => {
    bridge.currentPage().then(
      (url) => setPage(url && URL.canParse(url) ? new URL(url) : undefined),
      (error) => console.error(error)
    );
  }, [bridge]);

  const { status, view, notices } = snapshot;
  const live = status.state === 'running';
  const stale = !live && status.state !== 'connecting' && (view?.projects.length ?? 0) > 0;
  const at = view && page ? findRoute(view, page.hostname) : undefined;
  const down = view?.boxes.filter((box) => box.state !== 'connected') ?? [];
  const head = STATUS[status.state];

  return (
    <main>
      <header class="top">
        <Mark />
        <span class="brand">devlanes</span>
        {snapshot.devlanes && <span class="ver ter">{snapshot.devlanes}</span>}
        <span class="end" role="status">
          <span class={`st ${head.shape}`} aria-hidden="true" />
          <span>{head.word}</span>
        </span>
      </header>
      <StatusLine status={status} bridge={bridge} />
      {notices.length > 0 && (
        <ul class="notices">
          {notices.map(({ id, notice }) => (
            <li key={id} class="notice">
              <p>{notice.message}</p>
              <button
                type="button"
                class="x"
                aria-label="Dismiss notice"
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
      {stale && (
        <p class="line sec">
          {status.state === 'daemon_stopped'
            ? 'These lanes are from before devlanes stopped.'
            : 'These lanes may be out of date.'}
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
