import { render } from 'preact';
import { App } from './app';
import { chromeBridge } from './bridge';
import './style.css';

render(<App bridge={chromeBridge()} />, document.getElementById('root')!);
