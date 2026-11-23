import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '../logins';
import type { Bridge, LoginState } from './bridge';

/** The props of {@link Switch}. */
interface SwitchProps {
  name: keyof Settings;
  label: string;
  on: boolean;
  bridge: Bridge;
  /** The id of the text that explains the switch. */
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
          Offers the logins saved on one lane on every lane of the same project. It reads only
          fields marked with the standard autocomplete tokens.
        </p>
      </div>
      <div class="setting">
        <Switch
          name="remember"
          label="Remember passwords"
          on={settings.remember}
          bridge={bridge}
          hint="remember-hint"
        />
        <p id="remember-hint" class="meta">
          Saves the username and password when you sign in on a lane.
        </p>
        <p class="warn">
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
              <button
                type="button"
                class="btn"
                aria-label={`Delete the saved logins of ${project}`}
                onClick={() => {
                  bridge.forgetLogins(project).catch((error) => console.error(error));
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
