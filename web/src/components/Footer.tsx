import { SITE } from '../site';

export function Footer() {
  return (
    <footer class="footer">
      <span>
        0xCairn · {SITE.tagline} · MIT licence ·{' '}
        <a href={SITE.repo} rel="noopener" target="_blank">
          source
        </a>
      </span>
      <span>no servers · no analytics · no cookies · works offline</span>
    </footer>
  );
}
