import type { ReserveFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { trackDataError } from '../lib/analytics';
import { fetchPublic } from '../lib/data';
import { DASH, formatCount, formatLink, formatPct, formatUsd, formatUsdFull, formatUtcDay, formatUtcTime } from '../lib/format';
import { shortAddress } from '../lib/names';
import { depositCoins, valueAtPriceText, vaultFill } from '../lib/reserve-view';
import { changeTone } from '../lib/tone';
import DepositCountdown from './DepositCountdown';
import FreshnessNote from './FreshnessNote';
import InfoLink from './InfoLink';
import ReserveVault from './ReserveVault';
import ShareButton from './ShareButton';

export default function ReserveView({ initial }: { initial: ReserveFile }) {
  const [reserve, setReserve] = useState(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchPublic('reserve.json').then(
      (fresh) => {
        if (!cancelled) setReserve(fresh);
      },
      () => {
        if (cancelled) return;
        setFailed(true);
        trackDataError('reserve.json');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const fill = vaultFill(reserve.latest?.link);
  const cost = reserve.cost_basis;
  const pace = reserve.pace;
  const perf = reserve.performance;
  const transfers = [...reserve.transfers].reverse();
  const price = reserve.link_price_usd;
  const headline = `The Chainlink Reserve holds ${formatLink(reserve.latest?.link)}${cost?.change_pct != null ? `, ${formatPct(cost.change_pct)} vs its cost basis` : ''}`;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="label">
            Chainlink Reserve · Ethereum
            <InfoLink metric="reserve" label="the Reserve figures" />
          </p>
          <h1>{formatLink(reserve.latest?.link)}</h1>
          <p className="muted">{valueAtPriceText(cost?.value_usd, price)}</p>
        </div>
        <ShareButton view="reserve" headline={headline} url="https://ccip.dev/reserve/" cardUrl="/og/reserve.png" />
      </div>
      {failed && <FreshnessNote updatedAt={reserve.updated_at} paused />}

      <section className="reserve-grid">
        {fill && <ReserveVault link={reserve.latest!.link} target={fill.target} fraction={fill.fraction} coins={depositCoins(reserve.weekly).length} />}
        <div className="card">
          <span className="label">Cost basis vs value now</span>
          {cost ? (
            <dl className="facts">
              <dt>Paid at deposit time</dt>
              <dd className="mono">{formatUsdFull(cost.cost_usd)}</dd>
              <dt>Worth now</dt>
              <dd className="mono">{formatUsdFull(cost.value_usd)}</dd>
              <dt>Change</dt>
              <dd className={`mono ${changeTone(cost.change_pct)}`}>
                {formatUsd(cost.change_usd)} ({formatPct(cost.change_pct)})
              </dd>
              <dt>Average deposit price</dt>
              <dd className="mono">${cost.avg_deposit_price_usd?.toFixed(2) ?? DASH}</dd>
              <dt>LINK now</dt>
              <dd className="mono">${price?.toFixed(2) ?? DASH}</dd>
            </dl>
          ) : (
            <p className="muted">The cost basis appears once the Reserve's transfer history is loaded.</p>
          )}
        </div>
      </section>

      {pace && (
        <section className="tiles reserve-tiles">
          <div className="tile">
            <span className="label">Next deposit</span>
            <p className="value">
              <DepositCountdown next={pace.next_expected_deposit} overdue={pace.deposit_overdue} />
            </p>
            <span className="sub">
              every {pace.avg_days_between_deposits ?? DASH} days on average · streak {formatCount(pace.deposit_streak)}
            </span>
          </div>
          <div className="tile">
            <span className="label">Last deposit</span>
            <p className="value">{formatLink(pace.last_deposit?.link)}</p>
            <span className="sub">{pace.last_deposit ? `${formatUtcDay(pace.last_deposit.ts)} · ${formatUsd(pace.last_deposit.usd)}` : DASH}</span>
          </div>
          <div className="tile">
            <span className="label">Pace</span>
            <p className="value">{formatLink(pace.avg_weekly_link_4w)}/wk</p>
            <span className="sub">{formatLink(pace.annualized_link)} a year at this pace</span>
          </div>
          <div className="tile">
            <span className="label">Share of supply</span>
            <p className="value">{formatPct(pace.supply_share_pct, 2).replace('+', '')}</p>
            <span className="sub">{pace.next_milestone ? `${formatCount(pace.next_milestone.link)} LINK by ~${pace.next_milestone.eta}` : DASH}</span>
          </div>
        </section>
      )}

      {perf && (perf.best || perf.worst) && (
        <section className="card perf">
          <span className="label">Deposit timing</span>
          <p>
            Best price {perf.best ? `$${perf.best.price_usd.toFixed(2)} on ${formatUtcDay(perf.best.ts)}` : DASH} · worst
            {perf.worst ? ` $${perf.worst.price_usd.toFixed(2)} on ${formatUtcDay(perf.worst.ts)}` : ` ${DASH}`} · {perf.above ?? 0} deposits are worth
            more now, {perf.below ?? 0} less.
          </p>
        </section>
      )}

      {transfers.length > 0 && (
        <>
          <h2>Transfers</h2>
          <div className="table-wrap card">
            <table className="data">
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Direction</th>
                  <th className="num">LINK</th>
                  <th className="num">Price then</th>
                  <th className="num">USD then</th>
                  <th className="num">Value now</th>
                  <th className="num">Change</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t, i) => (
                  <tr key={`${t.tx}-${i}`}>
                    <td className="mono">
                      {formatUtcDay(t.ts)} {formatUtcTime(t.ts).replace(' UTC', '')}
                    </td>
                    <td>{t.direction === 'in' ? 'In' : 'Out'}</td>
                    <td className="num">{formatCount(t.link)}</td>
                    <td className="num">{t.price_usd === null ? DASH : `$${t.price_usd.toFixed(2)}`}</td>
                    <td className="num">{formatUsd(t.usd)}</td>
                    <td className="num">{formatUsd(t.value_now_usd)}</td>
                    <td className={`num ${changeTone(t.change_pct)}`}>{formatPct(t.change_pct)}</td>
                    <td>
                      <a className="mono" href={`https://etherscan.io/tx/${t.tx}`} rel="noopener">
                        {shortAddress(t.tx)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
