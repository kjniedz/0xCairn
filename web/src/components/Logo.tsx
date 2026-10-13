/** The 0xCairn mark: a cairn of stones built from hex characters. */
export function Logo({ size = 36, text = true }: { size?: number; text?: boolean }) {
  const rows: Array<[string, number, number, string, string]> = [
    // text, x, width, fill, color
    ['4a8e7c2f', 5, 54, '#2e3540', '#cfd6de'],
    ['1d90b', 12, 38, '#39414d', '#cfd6de'],
    ['c4f19', 15, 36, '#44505f', '#cfd6de'],
    ['7e3', 18, 26, '#536070', '#e7eaee'],
    ['0x', 23, 18, '#e8b25a', '#0a0c0f'],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {rows.map(([t, x, w, fill, color], i) => {
        const y = 51 - i * 11;
        return (
          <g key={t}>
            <rect x={x} y={y} width={w} height={10} rx={5} fill={fill} />
            {text && (
              <text
                x={x + w / 2}
                y={y + 7.4}
                textAnchor="middle"
                fontFamily="ui-monospace, Menlo, monospace"
                fontSize={6.2}
                fontWeight={700}
                fill={color}
                letterSpacing={0.3}
              >
                {t}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
