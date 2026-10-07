import { useEffect, useState, type CSSProperties } from 'react';
import { formatCompactCount, formatLink } from '../lib/format';
import { usePrefersReducedMotion } from './hooks';

const W = 240;
const H = 276;
const HEX = '120,6 234,72 234,204 120,270 6,204 6,72';

const coinPoints = (cx: number, cy: number, r: number) =>
  [0, 1, 2, 3, 4, 5].map((k) => `${(cx + r * Math.cos((Math.PI / 3) * k + Math.PI / 6)).toFixed(1)},${(cy + r * Math.sin((Math.PI / 3) * k + Math.PI / 6)).toFixed(1)}`).join(' ');

export default function ReserveVault({ link, target, fraction, coins }: { link: number; target: number; fraction: number; coins: number }) {
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [level, setLevel] = useState(fraction);
  useEffect(() => {
    if (reduced) return;
    setLevel(0);
    const id = requestAnimationFrame(() => setLevel(fraction));
    return () => cancelAnimationFrame(id);
  }, [fraction, reduced]);
  const top = 10 + (1 - level) * (H - 20);
  return (
    <figure className="vault">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${formatLink(link)} of the next ${formatCompactCount(target)} LINK`}>
        <defs>
          <clipPath id="vault-hex">
            <polygon points={HEX} />
          </clipPath>
          <linearGradient id="vault-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a7ff0" />
            <stop offset="1" stopColor="#2f62df" />
          </linearGradient>
        </defs>
        <polygon points={HEX} className="vault-shell" />
        <g clipPath="url(#vault-hex)">
          <rect x="0" y="0" width={W} height={H} fill="url(#vault-fill)" className="vault-level" style={{ transform: `translateY(${top}px)` }} />
          {mounted && !reduced &&
            Array.from({ length: coins }, (_, i) => (
              <polygon key={i} className="coin" style={{ '--i': i } as CSSProperties} points={coinPoints(40 + ((i * 37) % 160), top + 18, 7)} />
            ))}
        </g>
      </svg>
      <figcaption>
        <span className="mono">{formatLink(link)}</span>
        <span className="muted"> of the next {formatCompactCount(target)} LINK</span>
      </figcaption>
    </figure>
  );
}
