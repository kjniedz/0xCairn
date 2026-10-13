import { useMemo } from 'preact/hooks';
import { SITE } from '../site';
import { CopyButton } from './Copy';
import { qrMatrix } from '../lib/qr';
import { toChecksum } from '../lib/eth';

function TipAddress() {
  if (!SITE.tipAddress) return null;
  const addr = '0x' + toChecksum(SITE.tipAddress);
  const m = useMemo(() => qrMatrix(addr), [addr]);
  return (
    <span class="tip" tabIndex={0}>
      <span style={{ fontFamily: 'var(--sans)' }}>Tips, mined with 0xCairn:</span>
      <span class="addr">{addr}</span>
      <CopyButton text={addr} label="Copy" />
      <svg class="qr-pop" viewBox={`0 0 ${m.size} ${m.size}`} shape-rendering="crispEdges" aria-hidden="true">
        <path d={m.path} fill="#000" />
      </svg>
    </span>
  );
}

export function Footer() {
  return (
    <footer class="footer">
      <div class="footer-row">
        <a class="bm-mark" href={SITE.blackMountain} rel="noopener" target="_blank">
          <i /> A Black Mountain product
        </a>
        <div class="links">
          <a href={SITE.repo} rel="noopener" target="_blank">
            Source
          </a>
          <a href={SITE.proPath}>Pro</a>
          <a href={SITE.teamsPath}>Teams</a>
          <a href={SITE.privacyPath}>Privacy</a>
          <a href={SITE.termsPath}>Terms</a>
        </div>
      </div>
      <div class="footer-row">
        <TipAddress />
        <span class="mono" style={{ fontSize: '11.5px' }}>
          no servers · no analytics · no cookies · works offline
        </span>
      </div>
    </footer>
  );
}
