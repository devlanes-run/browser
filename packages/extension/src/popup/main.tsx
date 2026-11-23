import { render } from 'preact';

/** The popup's content until it lists lanes. */
function Popup() {
  return <main style={{ fontFamily: 'system-ui', padding: '12px 16px' }}>devlanes</main>;
}

render(<Popup />, document.getElementById('root')!);
