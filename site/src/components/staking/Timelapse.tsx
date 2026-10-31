import type { StakingFile } from '@ccip-dev/core/public';
import { useEffect, useMemo, useState } from 'react';
import { fetchPublic } from '../../lib/data';
import { formatCompactCount, formatCount, formatUtcDay } from '../../lib/format';
import { HIVE_RINGS, hiveCenters, timelapseFrames } from '../../lib/staking-view';

const CELL = 22;
const CENTERS = hiveCenters(HIVE_RINGS);
const HEX = Array.from({ length: 6 }, (_, k) => {
  const a = ((60 * k - 90) * Math.PI) / 180;
  return `${(Math.cos(a) * CELL * 0.92).toFixed(2)},${(Math.sin(a) * CELL * 0.92).toFixed(2)}`;
}).join(' ');
/** The weeks the pool was filling play slowly so the fill shows; once full, about 150 weeks play in 22 s. */
const FILLING_WEEK_MS = 900;
const WEEK_MS = 145;
const INTRO_MS = 2_000;
const OUTRO_MS = 3_000;

/** Cells light from the center out, so the pool fills like a hive; a week's exits dim cells near its edge for that week. */
function cellClass(i: number, lit: number, left: number, fresh: number): string {
  if (i >= lit) return 'tl-cell';
  if (i >= lit - left) return 'tl-cell out';
  if (i >= lit - fresh) return 'tl-cell new';
  return 'tl-cell on';
}

/**
 * The community pool from its first stake to today, a week a frame, for the timelapse video: `pnpm video:staking` records
 * it. The root's data-timelapse is "ready" once the data is in and "done" after the last frame's hold.
 */
export default function Timelapse() {
  const [staking, setStaking] = useState<StakingFile | null>(null);
  const [frame, setFrame] = useState(-1);
  useEffect(() => {
    fetchPublic('staking.json').then(setStaking, () => (document.documentElement.dataset.timelapse = 'failed'));
  }, []);
  const frames = useMemo(() => (staking ? timelapseFrames(staking.weeks, staking.community.cap) : []), [staking]);
  const cap = staking?.community.cap ?? 0;
  useEffect(() => {
    if (frames.length === 0) return;
    document.documentElement.dataset.timelapse = 'ready';
    const timers: ReturnType<typeof setTimeout>[] = [];
    let at = INTRO_MS;
    frames.forEach((f, i) => {
      timers.push(setTimeout(() => setFrame(i), at));
      at += f.level >= cap - 0.001 ? WEEK_MS : FILLING_WEEK_MS;
    });
    timers.push(setTimeout(() => (document.documentElement.dataset.timelapse = 'done'), at + OUTRO_MS));
    return () => timers.forEach(clearTimeout);
  }, [frames, cap]);

  if (!staking) return <div className="tl-stage" />;
  const f = frame >= 0 ? frames[frame]! : null;
  const prev = frame > 0 ? frames[frame - 1]! : null;
  const cells = (link: number) => Math.round((link / cap) * CENTERS.length);
  const lit = f ? cells(f.level) : 0;
  const fresh = f ? Math.max(0, lit - (prev ? cells(prev.level) : 0)) : 0;
  const left = f && f.unstaked > 0 ? Math.max(1, Math.min(lit, cells(f.unstaked))) : 0;
  const full = f !== null && f.level >= cap - 0.001;
  const ext = Math.sqrt(3) * (HIVE_RINGS + 0.6) * CELL;
  const exy = (1.5 * HIVE_RINGS + 1.1) * CELL;
  return (
    <div className="tl-stage">
      <header className="tl-head">
        <span className="tl-brand">ccip.dev</span>
        <span className="tl-kicker">Chainlink staking · the community pool</span>
      </header>
      <svg className="tl-hive" viewBox={`${-ext} ${-exy} ${ext * 2} ${exy * 2}`} aria-hidden="true">
        {CENTERS.map((c, i) => (
          <polygon key={i} points={HEX} transform={`translate(${(c.x * CELL).toFixed(1)} ${(c.y * CELL).toFixed(1)})`} className={cellClass(i, lit, left, fresh)} />
        ))}
      </svg>
      <div className="tl-readout">
        <p className="tl-week">{f ? `Week of ${formatUtcDay(f.week)}` : `Since ${formatUtcDay(staking.since)}`}</p>
        <p className="tl-level">
          <b>{f ? formatCompactCount(f.level) : '0'}</b> LINK {full ? <span className="tl-full">FULL</span> : <span className="tl-of">of {formatCompactCount(cap)}</span>}
        </p>
        <ul className="tl-stats">
          <li><b>{f ? formatCount(f.stakers) : '0'}</b> have staked</li>
          <li><b>{f ? formatCompactCount(f.unstaked) : '0'}</b> LINK out, refilled</li>
          <li><b>{f ? formatCompactCount(f.asked) : '0'}</b> asked to leave</li>
        </ul>
      </div>
    </div>
  );
}
