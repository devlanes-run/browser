import { render } from 'preact';
import { App } from '../src/popup/app';
import type { Bridge } from '../src/popup/bridge';
import type { Snapshot, UseReply } from '../src/state';
import { CASES, type Case } from './cases';
import '../src/popup/style.css';

/** A background that answers from `preview`, so the popup renders without a browser extension. */
function fakeBridge(preview: Case): Bridge {
  let snapshot: Snapshot = preview.snapshot;
  const listeners = new Set<(snapshot: Snapshot) => void>();
  return {
    watch(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    use(method) {
      const reply: UseReply = preview.answer?.(method) ?? {
        ok: false,
        error: {
          code: 'local_lane_running',
          message: 'acme@0 runs on this machine.',
          data: { holds: 'processes', local_lane: 'acme@0', commands: [] }
        }
      };
      // A short wait, so the progress line shows as it would with a real host.
      return new Promise((resolve) => setTimeout(() => resolve(reply), 300));
    },
    dismiss(notice) {
      snapshot = { ...snapshot, notices: snapshot.notices.filter((shown) => shown.id !== notice) };
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
    currentPage: () => Promise.resolve(preview.page),
    open: (url) => window.open(url, '_blank'),
    copy: (text) => navigator.clipboard.writeText(text)
  };
}

/** The list of cases, shown when the URL names none. */
function Index() {
  return (
    <main>
      <h2 class="group">Popup preview</h2>
      <ul class="routes">
        {CASES.map((each) => (
          <li key={each.name}>
            <a class="lk" href={`?case=${each.name}`}>
              {each.title}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

const name = new URLSearchParams(location.search).get('case');
const preview = CASES.find((each) => each.name === name);
render(
  preview ? <App bridge={fakeBridge(preview)} /> : <Index />,
  document.getElementById('root')!
);
