import { create as createQr } from 'qrcode';

export interface QrMatrix {
  size: number;
  /** SVG path string drawing every dark module as a 1x1 square. */
  path: string;
}

/** Build an SVG path for `text`. Rendered inline, so no images or data: URLs are needed. */
export function qrMatrix(text: string, level: 'L' | 'M' | 'Q' | 'H' = 'M'): QrMatrix {
  const qr = createQr(text, { errorCorrectionLevel: level });
  const size = qr.modules.size;
  const data = qr.modules.data;
  let path = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (data[y * size + x]) {
        let run = 1;
        while (x + run < size && data[y * size + x + run]) run++;
        path += `M${x} ${y}h${run}v1h-${run}z`;
        x += run;
      } else {
        x++;
      }
    }
  }
  return { size, path };
}
