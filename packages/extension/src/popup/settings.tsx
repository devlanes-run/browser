import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '../logins';
import type { Bridge, LoginState } from './bridge';

/** How long a Delete button waits for its second click. */
const CONFIRM_MS = 4000;

/** The props of {@link Switch}. */
interface SwitchProps {
  name: keyof Settings;
  label: string;
  on: boolean;
  bridge: Bridge;
  /** The ids of the texts that explain the switch, separated by spaces. */
  hint: string;
}

/** One login setting as a switch. */
function Switch({ name, label, on, bridge, hint }: SwitchProps) {
  return (
    <label class="switch">
      <span class="name">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        aria-checked={on}
        aria-describedby={hint}
        onChange={(event) => {
          bridge
            .setLoginSetting(name, event.currentTarget.checked)
            .catch((error) => console.error(error));
        }}
      />
    </label>
  );
}

/** The props of {@link DeleteButton}. */
interface DeleteProps {
  bridge: Bridge;
  project: string;
  count: number;
}

/**
 * Deletes a project's saved logins on a second click. The first click asks by
 * naming the count. Leaving the button or waiting puts it back.
 */
function DeleteButton({ bridge, project, count }: DeleteProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) {
      return undefined;
    }
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const logins = count === 1 ? '1 login' : `${count} logins`;
  const what =
    count === 1 ? `the saved login of ${project}` : `the ${count} saved logins of ${project}`;
  const label = armed ? `Delete ${what}` : `Delete the saved logins of ${project}`;
  return (
    <>
      <button
        type="button"
        class={`btn${armed ? ' armed' : ''}`}
        aria-label={label}
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          bridge.forgetLogins(project).catch((error) => console.error(error));
        }}
      >
        {armed ? `Delete ${logins}` : 'Delete'}
      </button>
      {/* The button keeps the focus, so screen readers hear the second step from here. */}
      <span class="hidden" aria-live="polite">
        {armed ? `Press again to delete ${what}.` : ''}
      </span>
    </>
  );
}

/** The login settings: the two switches and the saved logins of each project. */
export function LoginSettings({ bridge }: { bridge: Bridge }) {
  const [state, setState] = useState<LoginState | undefined>();
  useEffect(() => bridge.watchLogins(setState), [bridge]);
  if (!state) {
    return null;
  }
  const { settings, saved } = state;
  return (
    <section class="settings" aria-label="Login settings">
      <h2 class="group">Logins</h2>
      <div class="setting">
        <Switch
          name="fill"
          label="Fill logins on lanes"
          on={settings.fill}
          bridge={bridge}
          hint="fill-hint"
        />
        <p id="fill-hint" class="meta">
          Shows the logins saved on one lane in a menu on every lane of the project. It reads only
          fields marked with the standard autocomplete tokens.
        </p>
      </div>
      <div class="setting">
        <Switch
          name="remember"
          label="Remember passwords"
          on={settings.remember}
          bridge={bridge}
          hint="remember-hint remember-warn"
        />
        <p id="remember-hint" class="meta">
          Saves the username and password when you sign in on a lane.
          {!settings.remember &&
            saved.length > 0 &&
            ' The logins already saved stay. Delete them below.'}
        </p>
        <p id="remember-warn" class="warn">
          Passwords are stored unencrypted in this browser. Use this for test accounts only.
        </p>
      </div>
      <h2 class="group saved-head">Saved logins</h2>
      {saved.length === 0 ? (
        <p class="meta">No saved logins yet.</p>
      ) : (
        <ul class="saved">
          {saved.map(({ project, count }) => (
            <li key={project}>
              <span class="ref">{project}</span>
              <span class="sec">{count === 1 ? '1 login' : `${count} logins`}</span>
              <DeleteButton bridge={bridge} project={project} count={count} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
