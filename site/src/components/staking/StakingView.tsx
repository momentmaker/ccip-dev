import type { StakingFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { trackDataError } from '../../lib/analytics';
import { fetchPublic } from '../../lib/data';
import { formatCount, formatUtcDay } from '../../lib/format';
import { daysFull, sharePct } from '../../lib/staking-view';
import FreshnessNote from '../FreshnessNote';
import { useNow } from '../hooks';
import InfoLink from '../InfoLink';
import ShareButton from '../ShareButton';
import ExitQueue from './ExitQueue';
import GapHunt from './GapHunt';
import Hive from './Hive';
import Operators from './Operators';
import RewardsTicker from './RewardsTicker';
import StakerLookup from './StakerLookup';
import Stakers from './Stakers';
import Tape from './Tape';

const FULL_TOLERANCE = 0.001;
const SECTIONS = [
  ['pool', 'The pool'],
  ['queue', 'Exit queue'],
  ['hunt', 'Gap hunt'],
  ['stakers', 'Stakers'],
  ['card', 'Your card'],
  ['operators', 'Operators'],
  ['tape', 'The tape'],
] as const;

function JumpNav() {
  return (
    <nav className="stk-nav" aria-label="On this page">
      {SECTIONS.map(([id, label]) => (
        <a key={id} href={`#${id}`}>
          {label}
        </a>
      ))}
    </nav>
  );
}

function Pending() {
  return (
    <div className="page-head">
      <div>
        <p className="label">Chainlink Staking v0.2 · Ethereum</p>
        <h1>Scanning the pools</h1>
        <p className="muted">Every staking event since November 2023 is being read from Ethereum. This page fills in once the scan reaches today.</p>
      </div>
    </div>
  );
}

export default function StakingView({ initial, linkPriceUsd }: { initial: StakingFile | null; linkPriceUsd: number | null }) {
  const [staking, setStaking] = useState(initial);
  const [failed, setFailed] = useState(false);
  const now = useNow(60_000);
  useEffect(() => {
    let cancelled = false;
    fetchPublic('staking.json').then(
      (fresh) => {
        if (!cancelled) setStaking(fresh);
      },
      () => {
        if (cancelled) return;
        setFailed(true);
        trackDataError('staking.json');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!staking) return <Pending />;
  const c = staking.community;
  const full = c.total >= c.cap - FULL_TOLERANCE;
  const firstPct = sharePct(staking.tenure.first_month, c.stakers);
  const fullDays = daysFull(c, now);
  const headline = `${formatCount(c.total)} LINK staked in the Chainlink community pool${full ? ', full' : ''} · ${formatCount(c.stakers)} stakers`;

  return (
    <>
      <section className="stake-hero" id="pool">
        <div className="stake-hero-text">
          <div className="page-head">
            <div>
              <p className="label">
                Chainlink Staking v0.2 · Ethereum
                <InfoLink metric="staking" label="the staking figures" />
              </p>
              <h1 className="stake-total mono">{formatCount(c.total)}</h1>
              <p className="muted">
                of {formatCount(c.cap)} LINK in the community pool · plus {formatCount(staking.operator.total)} from node operators
              </p>
            </div>
            <ShareButton view="staking" headline={headline} url="https://ccip.dev/staking/" cardUrl="/og/staking.png" />
          </div>
          <FreshnessNote updatedAt={staking.updated_at} paused={failed} />
          <p className="stake-status">
            {full ? <span className="chip chip-full">Full</span> : <span className="chip chip-open">{formatCount(c.cap - c.total)} LINK open</span>}
            {full && c.full_since ? (
              <span>
                since {formatUtcDay(c.full_since)}
                {fullDays !== null ? ` · ${formatCount(fullDays)} days` : ''}
              </span>
            ) : null}
          </p>
          <dl className="stake-stats">
            <div><dt>Stakers</dt><dd className="mono">{formatCount(c.stakers)}</dd></div>
            <div><dt>At the {formatCount(c.max_stake)} max</dt><dd className="mono">{formatCount(c.at_max)}</dd></div>
            <div><dt>Median stake</dt><dd className="mono">{formatCount(c.median)}</dd></div>
            <div><dt>In since month one</dt><dd className="mono">{firstPct === null ? '—' : `${Math.round(firstPct)}%`}</dd></div>
          </dl>
          <RewardsTicker staking={staking} now={now} linkPriceUsd={linkPriceUsd} />
        </div>
        <Hive staking={staking} />
      </section>
      <JumpNav />
      {now && <ExitQueue staking={staking} now={now} />}
      <GapHunt staking={staking} />
      <Stakers staking={staking} />
      <div className="panel lookup-panel" id="card">
        <StakerLookup label="Your staker card: paste a staking address" />
      </div>
      <Operators staking={staking} />
      <Tape weeks={staking.weeks} />
    </>
  );
}
