// Generates PNG icons and the Open Graph image from SVG using resvg (no browser needed).
// Run: node scripts/icons.mjs   (outputs are committed; build does not depend on this)
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '../public');

const stones = (scale = 1, dx = 0, dy = 0) => `
  <g transform="translate(${dx} ${dy}) scale(${scale})">
    <rect x="5" y="51" width="54" height="10" rx="5" fill="#2e3540"/>
    <rect x="12" y="40" width="38" height="10" rx="5" fill="#39414d"/>
    <rect x="15" y="29" width="36" height="10" rx="5" fill="#44505f"/>
    <rect x="18" y="18" width="26" height="10" rx="5" fill="#536070"/>
    <rect x="23" y="7" width="18" height="10" rx="5" fill="#e8b25a"/>
  </g>`;

const icon = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${pad ? 0 : 14}" fill="#0a0c0f"/>
  ${pad ? stones(0.72, 9, 9) : stones()}
</svg>`;

// Cairn built from hex characters for the OG image.
const hexCairn = (x, y, s) => {
  const rows = [
    ['4a8e7c2f', '#2e3540', '#cfd6de'],
    ['1d90b', '#39414d', '#cfd6de'],
    ['c4f19', '#44505f', '#cfd6de'],
    ['7e3', '#536070', '#e7eaee'],
    ['0x', '#e8b25a', '#0a0c0f'],
  ];
  const offsets = [5, 12, 15, 18, 23];
  const widths = [54, 38, 36, 26, 18];
  let out = `<g transform="translate(${x} ${y}) scale(${s})">`;
  rows.forEach(([text, fill, color], i) => {
    const yy = 51 - i * 11;
    const w = widths[i];
    const xx = offsets[i];
    out += `<rect x="${xx}" y="${yy}" width="${w}" height="10" rx="5" fill="${fill}"/>`;
    out += `<text x="${xx + w / 2}" y="${yy + 7.4}" text-anchor="middle" font-family="Menlo, monospace" font-size="6.2" font-weight="700" fill="${color}" letter-spacing="0.3">${text}</text>`;
  });
  return out + '</g>';
};

const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="g" cx="50%" cy="-10%" r="80%">
      <stop offset="0" stop-color="#e8b25a" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#0a0c0f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0a0c0f"/>
  <rect width="1200" height="630" fill="url(#g)"/>
  ${hexCairn(90, 150, 5.2)}
  <text x="520" y="285" font-family="Menlo, monospace" font-size="92" font-weight="700" fill="#e7eaee" letter-spacing="-3">0x<tspan fill="#e8b25a">Cairn</tspan></text>
  <text x="522" y="350" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#8b949e">Carve your address. Any EVM chain.</text>
  <text x="522" y="420" font-family="Menlo, monospace" font-size="22" fill="#5c6673">vanity ETH address generator · browser-only · open source</text>
  <text x="522" y="456" font-family="Menlo, monospace" font-size="22" fill="#5c6673">WebAssembly + WebGPU · keys never leave your device</text>
</svg>`;

function render(svg, width, out) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Menlo' },
  });
  fs.writeFileSync(out, r.render().asPng());
  console.log('wrote', path.relative(process.cwd(), out));
}

fs.mkdirSync(path.join(pub, 'icons'), { recursive: true });
render(icon(false), 32, path.join(pub, 'icons/icon-32.png'));
render(icon(false), 180, path.join(pub, 'icons/apple-touch-icon.png'));
render(icon(false), 192, path.join(pub, 'icons/icon-192.png'));
render(icon(false), 512, path.join(pub, 'icons/icon-512.png'));
render(icon(true), 512, path.join(pub, 'icons/maskable-512.png'));
render(og, 1200, path.join(pub, 'og.png'));
