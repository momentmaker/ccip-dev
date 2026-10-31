import type { StakingFile } from '@ccip-dev/core/public';
import { useEffect, useRef, useState } from 'react';
import { formatCount, formatUtcDay } from '../../lib/format';
import { clampStake, daysUntil, yearlyReward } from '../../lib/staking-view';
import { usePrefersReducedMotion } from '../hooks';

const DAY_S = 86_400;
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);
const link4 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** The reward vault's emission as a live counter, the yearly rates it pays, and what a stake would earn at them. */
export default function RewardsTicker({ staking, now }: { staking: StakingFile; now: Date | null }) {
  const rewards = staking.rewards;
  const perSecond = rewards ? rewards.community_per_s + rewards.operator_per_s + rewards.delegated_per_s : 0;
  const reduced = usePrefersReducedMotion();
  const out = useRef<HTMLSpanElement>(null);
  const [stake, setStake] = useState(1_000);

  useEffect(() => {
    if (!rewards) return;
    const start = performance.now();
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      // Reduced motion: one update a second instead of every frame.
      if (!reduced || t - last >= 1_000) {
        last = t;
        if (out.current) out.current.textContent = link4(((t - start) / 1000) * perSecond);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rewards, perSecond, reduced]);

  if (!rewards) return null;
  const amount = clampStake(stake, staking.community);
  const yearly = yearlyReward(amount, rewards.community_rate_pct);
  return (
    <div className="rewards">
      <div className="rewards-live">
        <span className="label">
          <span className="live-dot" aria-hidden="true" /> Rewards streaming to stakers since you opened this page
        </span>
        <p className="rewards-count mono">
          <span ref={out}>{link4(0)}</span> <small>LINK</small>
        </p>
        <p className="muted rewards-rate">
          {formatCount(perSecond * DAY_S)} LINK a day · funded to {formatUtcDay(rewards.ends_at)}
          {now ? ` (${formatCount(daysUntil(rewards.ends_at, now))} days)` : ''}
        </p>
      </div>
      <dl className="rewards-rates">
        <div>
          <dt>Community</dt>
          <dd className="mono">{pct(rewards.community_rate_pct)}</dd>
          <span>a year on the pool</span>
        </div>
        <div>
          <dt>Node operators</dt>
          <dd className="mono">{pct(rewards.operator_rate_pct)}</dd>
          <span>base + delegated</span>
        </div>
      </dl>
      <label className="rewards-calc">
        <span>If you staked</span>
        <input
          type="number"
          inputMode="decimal"
          min={staking.community.min_stake}
          max={staking.community.max_stake}
          step="any"
          value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          aria-describedby="rewards-calc-out"
        />
        <span>LINK:</span>
        <output id="rewards-calc-out" className="mono">
          {yearly === null ? '—' : `≈ ${yearly.toLocaleString('en-US', { maximumFractionDigits: 1 })} LINK a year · ${(yearly / 365).toLocaleString('en-US', { maximumFractionDigits: 3 })} a day`}
        </output>
      </label>
      <p className="foot">
        The vault's current emission over the pool's principal, not a promise: rates move as rewards are added or the pool changes.
        {staking.community.total >= staking.community.cap - 0.001 ? ' The pool is full, so a new stake waits for space to open.' : ''}
      </p>
    </div>
  );
}
