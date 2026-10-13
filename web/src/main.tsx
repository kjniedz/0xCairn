import { render } from 'preact';
import '@fontsource-variable/montserrat';
import './styles.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);

// Offline support: precache everything so the generator works with no network.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[0xCairn] service worker registration failed', err));
  });
}
