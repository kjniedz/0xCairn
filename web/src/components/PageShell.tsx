import type { ComponentChildren } from 'preact';
import { Header, TopStrip } from './Header';
import { Footer } from './Footer';

/** Chrome for secondary routes (/pro, /order, /teams). Same strict CSP as the generator. */
export function PageShell({ children }: { children: ComponentChildren }) {
  return (
    <>
      <TopStrip />
      <div class="wrap">
        <Header />
        <main>{children}</main>
        <Footer />
      </div>
    </>
  );
}
