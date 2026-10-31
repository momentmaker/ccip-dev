import type { ReserveFile } from '@ccip-dev/core/public';
import { formatCount, formatLink, formatPct, formatUsd, formatUtcDay } from '../../lib/format';
import { vaultFill } from '../../lib/reserve-view';
import { changeTone } from '../../lib/tone';
import InfoLink from '../InfoLink';
import DepositWheels from './DepositWheels';
import VaultArt from './VaultArt';
import WeeklyBars from './WeeklyBars';

export type VaultReserve = Pick<ReserveFile, 'latest' | 'link_price_usd' | 'cost_basis' | 'pace' | 'weekly'>;

/** "Thu, Oct 22" */
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * The Reserve as the gold vault: the art, what it holds and is worth, the facts, the next deposit's wheels and the
 * weekly bars. `heading` makes the balance the page's h1, as on /reserve.
 */
export default function VaultPanel({ reserve, heading = false }: { reserve: VaultReserve; heading?: boolean }) {
  const Big = heading ? 'h1' : 'p';
  const link = reserve.latest?.link ?? null;
  const fill = vaultFill(link);
  const cost = reserve.cost_basis;
  const pace = reserve.pace;
  const price = reserve.link_price_usd;
  const value = cost?.value_usd ?? (link !== null && price !== null ? link * price : null);
  const nextMilestone = pace?.next_milestone && fill && pace.next_milestone.link === fill.target ? pace.next_milestone : null;
  const due = pace?.next_expected_deposit && !pace.deposit_overdue ? pace.avg_weekly_link_4w : null;
  return (
  <div className="vault">
    {fill && link !== null ? <VaultArt link={link} target={fill.target} fraction={fill.fraction} /> : <div />}
    <div className="vault-copy">
      <span className="label">
        Chainlink Reserve · Ethereum
        <InfoLink metric="reserve" label="the Reserve figures" />
      </span>
      <Big className="vault-big">{link === null ? '—' : formatCount(link)}</Big>
      <p className="vault-sub">
        LINK held{value !== null && (
          <>
            {' · '}
            <strong>{formatUsd(value)}</strong>
            {price !== null && ` at $${price.toFixed(2)}`}
          </>
        )}
      </p>
      <ul className="brief-facts">
        {cost?.change_pct != null && (
          <li>
            <span className={changeTone(cost.change_pct)}>
              {cost.change_pct >= 0 ? '▲' : '▼'} {formatPct(cost.change_pct).replace(/^[+−]/, '')}
            </span>{' '}
            on its {formatUsd(cost.cost_usd)} cost
          </li>
        )}
        {pace && pace.deposit_streak > 0 && (
          <li>
            <span className="hexb" aria-hidden="true">
              ⬡
            </span>
            {pace.deposit_streak}-week deposit streak{pace.avg_weekly_link_4w !== null && ` · ~${formatCount(pace.avg_weekly_link_4w)} LINK a week`}
          </li>
        )}
        {pace?.last_deposit && (
          <li>
            <span className="hexb" aria-hidden="true">
              ⬡
            </span>
            last {formatLink(pace.last_deposit.link)} on {shortDate(pace.last_deposit.ts)}
          </li>
        )}
        {pace && (
          <li>
            <span className="hexb" aria-hidden="true">
              ⬡
            </span>
            {formatPct(pace.supply_share_pct, 2).replace('+', '')} of all LINK
            {nextMilestone && ` · ${formatCount(nextMilestone.link)} ETA ${formatUtcDay(nextMilestone.eta)}`}
          </li>
        )}
      </ul>
      <DepositWheels next={pace?.next_expected_deposit ?? null} overdue={pace?.deposit_overdue ?? false} />
      <WeeklyBars weekly={reserve.weekly} pending={due} />
    </div>
  </div>
  );
}
