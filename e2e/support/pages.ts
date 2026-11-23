// The lane pages the tests open, by path. They are served for every
// `*.localhost` host through `context.route`, so no server or certificate is needed.

/** Records the `input` and `change` events each field gets, so a test can count fills. */
const RECORDER = `<script>
window.events = [];
for (const type of ['input', 'change']) {
  document.addEventListener(type, (event) => {
    const target = event.composedPath()[0];
    window.events.push({ type, id: target.id });
  }, true);
}
</script>`;

const STYLE = `<style>body{font:14px system-ui;margin:32px} input{display:block;margin:6px 0;padding:4px}</style>`;

/** A sign-in form with a username, a password, a one-time code and a field without a token. */
const LOGIN = `<!doctype html><meta charset="utf-8"><title>Sign in</title>${STYLE}
<form id="f" action="/signed-in" method="post">
<input id="user" name="user" autocomplete="username">
<input id="pass" type="password" name="pass" autocomplete="current-password">
<input id="otp" name="otp" autocomplete="one-time-code">
<input id="plain" name="nickname">
<button id="go">Sign in</button></form>${RECORDER}`;

/** The same form inside an open shadow root, as a web component holds it. */
const SHADOW = `<!doctype html><meta charset="utf-8"><title>Shadow</title>${STYLE}<x-login></x-login>
<script>
const root = document.querySelector('x-login').attachShadow({ mode: 'open' });
root.innerHTML = '<form action="/signed-in" method="post"><input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="current-password"><button id="go">Sign in</button></form>';
</script>${RECORDER}`;

/** Login fields outside any form, as a page that signs in with fetch has them. */
const FORMLESS = `<!doctype html><meta charset="utf-8"><title>No form</title>${STYLE}
<input id="user" autocomplete="username">
<input id="pass" type="password" autocomplete="current-password">${RECORDER}`;

/** A sign-in form and a second login form in another section of the page. */
const TWO_FORMS = `<!doctype html><meta charset="utf-8"><title>Two forms</title>${STYLE}
<form id="a" action="/signed-in" method="post">
<input id="a-user" autocomplete="username"><input id="a-pass" type="password" autocomplete="current-password">
<button id="a-go">Sign in</button></form>
<form id="b" action="/signed-in" method="post">
<input id="b-user" autocomplete="section-admin username"><input id="b-pass" type="password" autocomplete="section-admin current-password">
<button id="b-go">Sign in as admin</button></form>${RECORDER}`;

/** The pages by path. Any other path gets {@link LOGIN}. */
export const PAGES: Record<string, string> = {
  '/signed-in': '<!doctype html><title>Signed in</title><h1>Signed in</h1>',
  '/shadow': SHADOW,
  '/formless': FORMLESS,
  '/two-forms': TWO_FORMS
};

/** The page for `pathname`. */
export function pageFor(pathname: string): string {
  return PAGES[pathname] ?? LOGIN;
}
