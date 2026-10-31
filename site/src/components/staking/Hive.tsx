import type { StakingFile } from '@ccip-dev/core/public';
import { useEffect, useMemo, useState } from 'react';
import { formatCount, formatDuration, formatUtcDay } from '../../lib/format';
import { HIVE_RINGS, HOLDER_LABEL, hiveCenters, hiveKinds, replaySteps, shortHex, type HiveKind } from '../../lib/staking-view';
import { usePrefersReducedMotion } from '../hooks';

const CELL = 12;
const CENTERS = hiveCenters(HIVE_RINGS);
const HEX = Array.from({ length: 6 }, (_, k) => {
  const a = ((60 * k - 90) * Math.PI) / 180;
  return `${(Math.cos(a) * CELL * 0.92).toFixed(2)},${(Math.sin(a) * CELL * 0.92).toFixed(2)}`;
}).join(' ');
const EXTENT_X = Math.sqrt(3) * (HIVE_RINGS + 0.6) * CELL;
const EXTENT_Y = (1.5 * HIVE_RINGS + 1.1) * CELL;
const PAUSE_MS = 1_600;
const FILL_MS = 900;

type Phase = 'gap' | 'fill' | null;

/**
 * The community pool as a honeycomb: each cell an equal share of the cap, colored by who holds it. Real openings from
 * the last week replay on it: a cell goes dark when someone leaves, and lights up when a hunter takes the space.
 */
export default function Hive({ staking }: { staking: StakingFile }) {
  const kinds = useMemo(() => hiveKinds(staking, CENTERS.length), [staking]);
  const linkPerCell = staking.community.cap / CENTERS.length;
  const steps = useMemo(() => replaySteps(staking.refills.recent, linkPerCell), [staking.refills.recent, linkPerCell]);
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>(null);

  useEffect(() => {
    if (reduced || steps.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    let i = 0;
    const run = () => {
      setStep(i);
      setPhase('gap');
      timer = setTimeout(() => {
        setPhase('fill');
        timer = setTimeout(() => {
          setPhase(null);
          i = (i + 1) % steps.length;
          timer = setTimeout(run, PAUSE_MS);
        }, FILL_MS);
      }, steps[i]!.holdMs);
    };
    timer = setTimeout(run, PAUSE_MS);
    return () => clearTimeout(timer);
  }, [reduced, steps]);

  const current = steps[step];
  // The cells a replayed gap darkens: a run of held cells starting from a spot that moves with each opening.
  const lit = useMemo(() => {
    if (!current || phase === null) return new Set<number>();
    const held = kinds.flatMap((k, i) => (k === 'open' ? [] : [i]));
    const start = (step * 37 + 11) % Math.max(1, held.length);
    return new Set(held.slice(start, start + current.cells));
  }, [current, phase, kinds, step]);

  const counts = new Map<HiveKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const open = staking.community.cap - staking.community.total;

  return (
    <figure className="hive">
      <svg viewBox={`${-EXTENT_X} ${-EXTENT_Y} ${EXTENT_X * 2} ${EXTENT_Y * 2}`} role="img" aria-label={`The community pool as ${CENTERS.length} cells of about ${formatCount(linkPerCell)} LINK each, colored by who holds them`}>
        <defs>
          <radialGradient id="hive-glow">
            <stop offset="0" stopColor="#2ed3c3" stopOpacity="0.22" />
            <stop offset="1" stopColor="#2ed3c3" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r={EXTENT_X} fill="url(#hive-glow)" />
        {CENTERS.map((c, i) => (
          <polygon
            key={i}
            points={HEX}
            transform={`translate(${(c.x * CELL).toFixed(2)} ${(c.y * CELL).toFixed(2)})`}
            className={`cell cell-${kinds[i]}${lit.has(i) ? ` cell-${phase}` : ''}`}
          />
        ))}
      </svg>
      <figcaption>
        <ul className="hive-key">
          {(['wallet', 'smart', 'stakelink', 'contract'] as const).map((k) => (
            <li key={k}>
              <i className={`key key-${k}`} />
              {HOLDER_LABEL[k]} <span className="mono">{formatCount(staking.holders.find((h) => h.kind === k)?.link ?? 0)}</span>
            </li>
          ))}
          {open > 0.001 && (
            <li>
              <i className="key key-open" />
              Open space <span className="mono">{formatCount(open)}</span>
            </li>
          )}
        </ul>
        <p className="hive-replay" aria-live="off">
          {current ? (
            <>
              <span className={`replay-dot${phase === 'gap' ? ' on' : ''}`} aria-hidden="true" />
              <span className="mono">{formatUtcDay(current.openedAt)}</span> · {formatCount(current.gap)} LINK opened{' '}
              {phase === 'gap' ? '…' : <>→ filled in <b>{formatDuration(current.seconds)}</b>{current.blocks !== null ? ` (${current.blocks} block${current.blocks === 1 ? '' : 's'})` : ''} by <span className="mono">{shortHex(current.grabs[0] ?? '')}</span>{current.grabs.length > 1 ? ` +${current.grabs.length - 1}` : ''}</>}
            </>
          ) : (
            'No space opened in the last 7 days.'
          )}
        </p>
      </figcaption>
    </figure>
  );
}
