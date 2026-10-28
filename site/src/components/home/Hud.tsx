import type { TodayFile } from '@ccip-dev/core/public';
import { dayFraction, etaText, milestoneText, pacedTotal, type AllTimeTotals, type MilestoneGoal } from '../../lib/all-time';
import type { HeroFees } from '../../lib/fee-revenue';
import { formatCount, formatUsd, formatUtcDay } from '../../lib/format';
import type { MilestoneMetric } from '../../lib/records';
import { useCountUp, useNow } from '../hooks';
import InfoLink from '../InfoLink';
import Odometer from './Odometer';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Wed 28 Oct · 14:14:27Z", the military date-time group the SITREP card uses. */
export function zuluText(ms: number): string {
  const t = new Date(ms);
  return `${DOW[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]} · ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}Z`;
}

export const METRIC_WORD: Record<MilestoneMetric, string> = { value: 'moved', messages: 'messages', fees: 'in fees' };

export const remainingText = (metric: MilestoneMetric, n: number) => (metric === 'messages' ? formatCount(Math.ceil(n)) : formatUsd(n));

/** The share of the way, floored so 99.999% never reads as 100.00% before the milestone is reached. */
export const progressText = (progress: number) => `${(Math.floor(progress * 10_000) / 100).toFixed(2)}%`;

export interface HudProps {
  today: TodayFile;
  yesterday: { messages: number; usd_value: number; fee_usd: number | null } | null;
  allTime: AllTimeTotals;
  since: string | null;
  goal: MilestoneGoal | null;
  crossed: { metric: MilestoneMetric; threshold: number } | null;
  fees: HeroFees | null;
  animate: boolean | null;
}

function MilestoneBar({ goal, crossed, nowMs }: { goal: MilestoneGoal; crossed: HudProps['crossed']; nowMs: number | null }) {
  const pct = goal.progress * 100;
  return (
    <div className="hud-ms">
      {crossed && <p className="hud-won">Crossed {milestoneText(crossed.metric, crossed.threshold)} {METRIC_WORD[crossed.metric]} today</p>}
      <div className="hud-ms-top">
        <span>
          Next milestone · {milestoneText(goal.metric, goal.next)} {METRIC_WORD[goal.metric]}
        </span>
        <span>{progressText(goal.progress)}</span>
      </div>
      <div className="hud-ms-track" aria-hidden="true">
        <span className="hud-ms-fill" style={{ width: `${pct.toFixed(3)}%` }} />
        <span className="hud-ms-tip" style={{ left: `${pct.toFixed(3)}%` }} />
      </div>
      <p className="hud-ms-foot">
        <strong className="mono">{remainingText(goal.metric, goal.next - goal.total)}</strong> to go
        {goal.daysLeft !== null && nowMs !== null && <> · {etaText(goal.daysLeft, nowMs, formatUtcDay)} at the 7-day pace</>}
      </p>
    </div>
  );
}

export default function Hud({ today, yesterday, allTime, since, goal, crossed, fees, animate }: HudProps) {
  const now = useNow(1000);
  const nowMs = now?.getTime() ?? null;
  const messages = useCountUp(today.totals.messages, animate);
  const usd = useCountUp(today.totals.usd_value, animate);
  const todayFees = useCountUp(today.totals.fee_usd ?? 0, animate);
  const fraction = nowMs === null ? null : dayFraction(today.day, nowMs);
  const paced = fraction === null ? null : pacedTotal(today.totals.messages, fraction);
  const total = `$${Math.floor(allTime.usd).toLocaleString('en-US')}`;
  return (
    <div className={crossed ? 'hud hud-gold' : 'hud'}>
      <span className="hud-c tl" />
      <span className="hud-c tr" />
      <span className="hud-c bl" />
      <span className="hud-c br" />
      <p className="hud-eyebrow">
        <span className="live-dot" aria-hidden="true" />
        <span className="hud-live">Live</span>
        <span>SITREP</span>
        {nowMs !== null && <span className="mono">· {zuluText(nowMs)}</span>}
      </p>
      <Odometer text={total} label={`${total} moved over CCIP`} className={crossed ? 'odo-gold' : undefined} />
      <p className="hud-sub">
        moved over CCIP{since ? ` since ${formatUtcDay(since)}` : ''}
        <InfoLink metric="value" label="value transferred" /> · <span className="mono">{formatCount(allTime.messages)}</span> messages
      </p>
      {goal && <MilestoneBar goal={goal} crossed={crossed} nowMs={nowMs} />}
      <p className="hud-today">
        <span className="label">Today · UTC</span>
        <span>
          <span className="mono">{formatCount(messages)}</span> messages
          <InfoLink metric="messages" label="messages" />
        </span>
        <span>
          <span className="mono">{formatUsd(usd)}</span> moved
        </span>
        {today.totals.fee_usd !== null && (
          <a className="hud-fees" href="/reserve/" title="Fees paid to Chainlink, the revenue behind the Chainlink Reserve">
            <span className="mono">{formatUsd(todayFees)}</span> fees
          </a>
        )}
      </p>
      <p className="hud-line">
        {paced !== null && (
          <>
            On pace for <span className="mono">~{formatCount(paced)}</span>
            {yesterday ? ' · ' : ''}
          </>
        )}
        {yesterday && (
          <>
            Yesterday: {formatCount(yesterday.messages)} messages · {formatUsd(yesterday.usd_value)}
            {yesterday.fee_usd !== null && ` · ${formatUsd(yesterday.fee_usd)} fees`}
          </>
        )}
      </p>
      {fees && (
        <p className="hud-line">
          <a className="hud-fees" href="/records/#fees">
            {fees.since ? `Fees since ${formatUtcDay(fees.since)}` : 'All-time fees'}: <span className="mono">{formatUsd(fees.usd)}</span>
            {fees.runRateUsd !== null && (
              <>
                {' · '}
                <span className="mono">{formatUsd(fees.runRateUsd)}</span>/yr at the 30-day pace
              </>
            )}{' '}
            <span aria-hidden="true">→</span>
          </a>
        </p>
      )}
      <div className="hud-clock" aria-hidden="true">
        <span>00:00</span>
        <span className="hud-clock-track">
          <span className="hud-clock-fill" style={{ width: `${((fraction ?? 0) * 100).toFixed(2)}%` }} />
        </span>
        <span>24:00 UTC</span>
      </div>
    </div>
  );
}
