import { useEffect, useState } from 'preact/hooks';
import { Logo } from './Logo';
import { SITE } from '../site';

function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Header() {
  const online = useOnline();
  return (
    <header class="header">
      <a class="brand" href="/" aria-label="0xCairn home">
        <Logo size={34} />
        <span class="brand-name">
          0x<span>Cairn</span>
        </span>
      </a>
      <div class="header-links">
        <span
          class={`net ${online ? '' : 'offline'}`}
          title={online ? 'You are online. Disconnect before generating a key you intend to use; the app keeps working offline.' : 'You are offline. Generation keeps working.'}
        >
          <i />
          {online ? 'online' : 'offline · safe'}
        </span>
        <a href={SITE.proPath}>Pro</a>
        <a href={SITE.teamsPath}>Teams</a>
        <a href={SITE.repo} rel="noopener" target="_blank" title="Source code on GitHub">
          Source
        </a>
      </div>
    </header>
  );
}

export function TopStrip() {
  return <div class="bm-strip" aria-hidden="true" />;
}
