import { render } from 'preact';
import { Menu, type MenuChannel } from '../src/menu/app';
import { MENU_CASES } from './cases';
import '../src/menu/style.css';

/** A content script that only logs what the menu sends it. */
const loggingChannel: MenuChannel = {
  post: (message) => console.log('menu sent', message),
  listen: () => () => {}
};

const name = new URLSearchParams(location.search).get('menu');
const preview = MENU_CASES.find((each) => each.name === name) ?? MENU_CASES[0];
if (preview) {
  render(
    <Menu
      claimed={preview.claimed}
      channel={loggingChannel}
      {...(preview.selected !== undefined && { selected: preview.selected })}
    />,
    document.getElementById('root')!
  );
}
