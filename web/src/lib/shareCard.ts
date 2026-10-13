/**
 * Share card renderer: the address in large mono type, matched characters in
 * amber, the cairn mark. Rendered entirely client-side on a canvas.
 *
 * Safety: this module only ever receives the address and the pattern. It has
 * no access to secrets by construction (see the signature), so no key
 * material can end up in the image.
 */
import type { Pattern } from './pattern';
import { normalizePattern } from './pattern';

export type CardStyle = 'dark' | 'light' | 'amber';

export interface CardOptions {
  style: CardStyle;
  watermark: boolean;
  scale?: number; // 1 = 1200x630
}

const PALETTE: Record<CardStyle, { bg: string; text: string; dim: string; accent: string; stone: string[] }> = {
  dark: { bg: '#0f0e0c', text: '#ece9e2', dim: '#75706a', accent: '#e8b25a', stone: ['#2e3540', '#39414d', '#44505f', '#536070', '#e8b25a'] },
  light: { bg: '#faf8f3', text: '#1b1916', dim: '#857f75', accent: '#b27a1f', stone: ['#cfc8bb', '#bfb7a8', '#aaa193', '#8f8678', '#b27a1f'] },
  amber: { bg: '#e8b25a', text: '#171207', dim: '#6b5424', accent: '#171207', stone: ['#c99642', '#b8873a', '#a67834', '#8f672c', '#171207'] },
};

function drawCairn(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, stones: string[]) {
  const rows: Array<[number, number]> = [
    [5, 54],
    [12, 38],
    [15, 36],
    [18, 26],
    [23, 18],
  ];
  rows.forEach(([ox, w], i) => {
    const yy = 51 - i * 11;
    ctx.fillStyle = stones[i];
    const r = 5 * s;
    const px = x + ox * s;
    const py = y + yy * s;
    const pw = w * s;
    const ph = 10 * s;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, r);
    ctx.arcTo(px + pw, py + ph, px, py + ph, r);
    ctx.arcTo(px, py + ph, px, py, r);
    ctx.arcTo(px, py, px + pw, py, r);
    ctx.closePath();
    ctx.fill();
  });
}

/** Render to a canvas and return it. `checksummed` is the 40-char address without 0x. */
export function renderShareCard(checksummed: string, pattern: Pattern, opts: CardOptions): HTMLCanvasElement {
  if (!/^[0-9a-fA-F]{40}$/.test(checksummed)) throw new Error('share card only accepts a 40-character address');
  const scale = opts.scale ?? 2;
  const W = 1200 * scale;
  const H = 630 * scale;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const pal = PALETTE[opts.style];
  const p = normalizePattern(pattern);
  const mono = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  const sans = `"Montserrat Variable", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  drawCairn(ctx, 80 * scale, 70 * scale, 1.6 * scale, pal.stone);

  ctx.fillStyle = pal.text;
  ctx.font = `600 ${34 * scale}px ${mono}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('0x', 200 * scale, 118 * scale);
  ctx.fillStyle = pal.accent;
  ctx.fillText('Cairn', 200 * scale + ctx.measureText('0x').width, 118 * scale);
  ctx.fillStyle = pal.dim;
  ctx.font = `500 ${18 * scale}px ${sans}`;
  ctx.fillText('Carve your address. Any EVM chain.', 200 * scale, 150 * scale);

  // address in two rows of 21 chars (0x + 19, then 21)
  const full = '0x' + checksummed;
  const row1 = full.slice(0, 21);
  const row2 = full.slice(21);
  const size = 58 * scale;
  ctx.font = `600 ${size}px ${mono}`;
  const cw = ctx.measureText('0').width * 1.06;
  const startX = (W - cw * 21) / 2;
  const drawRow = (text: string, y: number, offset: number) => {
    for (let i = 0; i < text.length; i++) {
      const pos = offset + i - 2; // index into the 40 address chars
      const inPattern = pos >= 0 && (pos < p.prefix.length || pos >= 40 - p.suffix.length);
      ctx.fillStyle = inPattern ? pal.accent : pal.text;
      ctx.fillText(text[i], startX + i * cw, y);
    }
  };
  drawRow(row1, 330 * scale, 0);
  drawRow(row2, 410 * scale, 21);

  ctx.fillStyle = pal.dim;
  ctx.font = `500 ${16 * scale}px ${mono}`;
  const total = p.prefix.length + p.suffix.length;
  const label = total > 0 ? `${total} chosen character${total === 1 ? '' : 's'} · 1 in ${Math.pow(16, total).toLocaleString('en-US')}` : 'mined in the browser';
  ctx.fillText(label, startX, 490 * scale);

  if (opts.watermark) {
    ctx.fillStyle = pal.dim;
    ctx.font = `500 ${15 * scale}px ${mono}`;
    ctx.textAlign = 'right';
    ctx.fillText('0xcairn.com', W - 80 * scale, H - 60 * scale);
    ctx.textAlign = 'left';
  }
  return c;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
