import { render } from 'preact';

/** The popup's content until it lists lanes. */
function Popup() {
  return <main>devlanes</main>;
}

render(<Popup />, document.getElementById('root')!);
