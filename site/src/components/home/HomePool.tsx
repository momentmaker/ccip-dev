import type { StakingFile } from '@ccip-dev/core/public';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchPublic } from '../../lib/data';
import { formatCompactCount, formatCount, formatDuration, formatUtcDay } from '../../lib/format';
import { daysFull } from '../../lib/staking-view';
import { useNow } from '../hooks';
import InfoLink from '../InfoLink';
import Hive from '../staking/Hive';
import RewardsStream from '../staking/RewardsStream';
import StakerLookup from '../staking/StakerLookup';

export type HomeStaking = Pick<StakingFile, 'community' | 'holders' | 'refills' | 'queue' | 'rewards'>;

const FULL_TOLERANCE = 0.001;
const DAY_S = 86_400;

function Fact({ children }: { children: ReactNode }) {
  return (
    <li>
      <span className="hexb" aria-hidden="true">
        ⬡
      </span>
      {children}
    </li>
  );
}

/** Chainlink staking's community pool on the home page: the Vault's teal twin, with the hive on the right. */
export default function HomePool({ initial }: { initial: HomeStaking }) {
  const [staking, setStaking] = useState(initial);
  const now = useNow(60_000);
  useEffect(() => {
    let cancelled = false;
    fetchPublic('staking.json').then(
      (fresh) => {
        if (!cancelled) setStaking(fresh);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const c = staking.community;
  const full = c.total >= c.cap - FULL_TOLERANCE;
  const days = daysFull(c, now);
  const r = staking.rewards;
  const perSecond = r ? r.community_per_s + r.operator_per_s + r.delegated_per_s : 0;
  return (
    <div className="pool">
      <div className="pool-copy">
        <span className="label">
          Chainlink staking v0.2 · community pool
          <InfoLink metric="staking" label="the staking figures" />
        </span>
        <p className="pool-big">{formatCount(c.total)}</p>
        <p className="pool-sub">
          LINK staked
          {full ? <span className="pool-chip">Full</span> : <span className="pool-chip open">{formatCount(c.cap - c.total)} LINK open</span>}
          {full && c.full_since && (
            <span>
              since {formatUtcDay(c.full_since)}
              {days !== null && ` · ${formatCount(days)} days`}
            </span>
          )}
        </p>
        <ul className="brief-facts">
          <Fact>
            {formatCount(c.stakers)} stakers · {formatCount(c.at_max)} at the {formatCount(c.max_stake)} max
          </Fact>
          <Fact>
            space refills in {formatDuration(staking.refills.median_s)} · {formatCount(staking.refills.openings)} gaps since full
          </Fact>
          <Fact>≈ {formatCompactCount(staking.queue.likely_to_leave)} LINK likely to leave in 28 days</Fact>
          {r && r.community_rate_pct !== null && (
            <Fact>
              {r.community_rate_pct.toFixed(2)}% a year · {formatCount(perSecond * DAY_S)} LINK a day to stakers
            </Fact>
          )}
        </ul>
        {r && (
          <div className="pool-stream">
            <span className="label">
              <span className="stream-dot" aria-hidden="true" />
              Streamed to stakers since you opened this page
            </span>
            <strong className="mono">
              <RewardsStream perSecond={perSecond} /> <small>LINK</small>
            </strong>
          </div>
        )}
        <StakerLookup label="Your staker card" />
      </div>
      <Hive staking={staking} />
    </div>
  );
}
