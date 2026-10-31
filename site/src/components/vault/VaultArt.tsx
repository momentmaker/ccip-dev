import { formatCount, formatLink } from '../../lib/format';

export const hex = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  });
export const points = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** The Reserve as a gold vault, filled toward its next round million, with a mark at the last one. */
export default function VaultArt({ link, target, fraction }: { link: number; target: number; fraction: number }) {
  const C = 210;
  const inner = hex(C, C, 132);
  const level = C + 132 - fraction * 264;
  const previous = target - 1e6;
  const mark = previous > 0 ? C + 132 - (previous / target) * 264 : null;
  return (
    <svg className="vault-art" viewBox="0 0 420 420" role="img" aria-label={`${formatLink(link)}, ${(fraction * 100).toFixed(1)}% of the way to ${formatCount(target)} LINK`}>
      <defs>
        <linearGradient id="vault-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1c2" />
          <stop offset="0.45" stopColor="#f5c451" />
          <stop offset="1" stopColor="#8a5e10" />
        </linearGradient>
        <linearGradient id="vault-liquid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5c451" stopOpacity="0.6" />
          <stop offset="1" stopColor="#8a5e10" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id="vault-glow">
          <stop offset="0" stopColor="#f5c451" stopOpacity="0.3" />
          <stop offset="1" stopColor="#f5c451" stopOpacity="0" />
        </radialGradient>
        <clipPath id="vault-inside">
          <polygon points={points(inner)} />
        </clipPath>
      </defs>
      <circle cx={C} cy={C} r="205" fill="url(#vault-glow)" />
      <polygon points={points(hex(C, C, 200))} className="vault-ring" />
      <polygon points={points(hex(C, C, 178))} className="vault-ring vault-ring-2" />
      <polygon points={points(inner)} className="vault-floor" />
      <g clipPath="url(#vault-inside)">
        <g className="vault-wave">
          <path
            d={`M-280 ${level.toFixed(1)}${' q35 -9 70 0 t70 0'.repeat(10)} V430 H-280 Z`}
            fill="url(#vault-liquid)"
          />
        </g>
        {mark !== null && <line x1="0" x2="420" y1={mark} y2={mark} className="vault-mark" />}
      </g>
      {mark !== null && (
        <text x={C + 92} y={mark - 6} className="vault-mark-text" textAnchor="end">
          {formatCount(previous / 1e6)}M
        </text>
      )}
      <polygon points={points(hex(C, C, 46))} className="vault-core" />
      <polygon points={points(hex(C, C, 46))} className="vault-core-edge" />
      <polygon points={points(hex(C, C, 150))} className="vault-frame" />
      {hex(C, C, 150).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" className="vault-rivet" />
      ))}
      <text x={C} y={C + 82} className="vault-pct" textAnchor="middle">
        {(fraction * 100).toFixed(1)}%
      </text>
      <text x={C} y={C + 100} className="vault-pct-sub" textAnchor="middle">
        OF {formatCount(target)}
      </text>
    </svg>
  );
}
