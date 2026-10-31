import type { StakingFile } from '@ccip-dev/core/public';
import { Fragment } from 'react';
import { formatCompactCount, formatCount, formatUtcDay } from '../../lib/format';
import { boardRows, dialDots, onDial, sharePct } from '../../lib/staking-view';
import SpaceForecast from './SpaceForecast';

const R = 120;
const SIZE = 320;
const C = SIZE / 2;

function arc(from: number, to: number, r: number): string {
  const a = onDial(from, r, C, C);
  const b = onDial(to, r, C, C);
  return `M${a.x} ${a.y} A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/** The 35 days from asking to leave to the claim window closing, with each cohort of the queue where it is now. */
function Dial({ staking, now }: { staking: StakingFile; now: Date }) {
  const unbondingDays = staking.periods.unbonding_s / 86_400;
  const total = unbondingDays + staking.periods.claim_s / 86_400;
  const split = unbondingDays / total;
  const dots = dialDots(staking.queue, staking.periods, now);
  const max = Math.max(1, ...dots.map((d) => d.link));
  const q = staking.queue;
  return (
    <svg className="dial" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${formatCount(q.unbonding.link + q.unbonding.stakelink_link)} LINK unbonding and ${formatCount(q.claimable.link + q.claimable.stakelink_link)} LINK in an open claim window`}>
      <path d={arc(0, split - 0.004, R)} className="dial-track dial-unbond" />
      <path d={arc(split + 0.004, 0.996, R)} className="dial-track dial-claim" />
      {Array.from({ length: Math.round(total / 7) + 1 }, (_, w) => {
        const f = (w * 7) / total;
        const a = onDial(f, R + 30, C, C);
        const t1 = onDial(f, R - 9, C, C);
        const t2 = onDial(f, R + 9, C, C);
        return (
          <g key={w}>
            <line x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} className="dial-tick" />
            {w > 0 && w * 7 < total && <text x={a.x} y={a.y} className="dial-day">{`D${w * 7}`}</text>}
          </g>
        );
      })}
      {dots.map((d, i) => {
        const p = onDial(d.elapsed / total, R, C, C);
        return <circle key={i} cx={p.x} cy={p.y} r={3 + 15 * Math.sqrt(d.link / max)} className={d.stakelink ? 'dial-dot ladder' : 'dial-dot'} />;
      })}
      <text x={C} y={C - 26} className="dial-kicker">Unbonding now</text>
      <text x={C} y={C + 6} className="dial-big">{formatCompactCount(q.unbonding.link)}</text>
      <text x={C} y={C + 28} className="dial-sub">LINK · {formatCount(q.unbonding.stakers)} stakers</text>
      <text x={C} y={C + 48} className="dial-sub ladder-text">+ {formatCompactCount(q.unbonding.stakelink_link)} stake.link ladder</text>
    </svg>
  );
}

const STATUS_CLASS: Record<string, string> = { 'GATE OPEN': 'gate', BOARDING: 'boarding', LADDER: 'ladder', DEPARTED: 'departed', STAYED: 'stayed' };

export default function ExitQueue({ staking, now }: { staking: StakingFile; now: Date }) {
  const q = staking.queue;
  const rows = boardRows(q);
  const firstPast = rows.findIndex((r) => r.status === 'DEPARTED' || r.status === 'STAYED');
  const others = sharePct(q.conversion.others.left, q.conversion.others.total);
  const ladder = sharePct(q.conversion.stakelink.left, q.conversion.stakelink.total);
  const days = Math.round(staking.periods.unbonding_s / 86_400);
  const window = Math.round(staking.periods.claim_s / 86_400);
  return (
    <section className="band" id="queue" aria-labelledby="queue-title">
      <div className="band-head">
        <div>
          <p className="eyebrow">The exit queue</p>
          <h2 id="queue-title">
            Who's heading out, <span className="t">and who isn't</span>.
          </h2>
          <p className="lead">
            Leaving takes {days} days of unbonding, then a {window}-day claim window. Miss the window and the LINK simply stays staked.
          </p>
        </div>
      </div>
      <div className="queue-grid">
        <div className="panel dial-panel">
          <Dial staking={staking} now={now} />
          <ul className="dial-key">
            <li><i className="key key-unbond" />Unbonding, {days} days</li>
            <li><i className="key key-claim" />Claim window, {window} days</li>
            <li><i className="key key-ladder" />stake.link's ladder</li>
          </ul>
        </div>
        <div className="panel board-panel">
          <div className="board" role="table" aria-label="Departures: claim windows opening and closing">
            <div className="board-row board-head" role="row">
              <span role="columnheader">Day</span>
              <span role="columnheader" className="num">LINK</span>
              <span role="columnheader">Status</span>
            </div>
            {rows.map((r, i) => (
              <Fragment key={i}>
                {i === firstPast && (
                  <div className="board-divider" role="row">
                    <span role="cell">Windows that closed · last 7 days</span>
                  </div>
                )}
                <div className="board-row" role="row" style={{ ['--i' as string]: i }}>
                  <span role="cell" className="mono">{r.day ? formatUtcDay(r.day).replace(/, \d{4}$/, '') : 'NOW'}</span>
                  <span role="cell" className="num mono">{formatCount(r.link)}</span>
                  <span role="cell">
                    <b className={`flap ${STATUS_CLASS[r.status]}`}>{r.status}</b>
                    <span className="board-note">{r.note}</span>
                  </span>
                </div>
              </Fragment>
            ))}
          </div>
        </div>
        <SpaceForecast staking={staking} now={now} />
        <div className="queue-facts">
          <div className="panel qf">
            <span className="label">Claim windows that ended in an exit</span>
            <div className="conv">
              <span>Wallets and others</span>
              <b className="mono">{others === null ? '—' : `${others.toFixed(1)}%`}</b>
              <div className="conv-bar" aria-hidden="true"><i style={{ width: `${others ?? 0}%` }} /></div>
              <span className="muted mono">{formatCount(q.conversion.others.left)} of {formatCount(q.conversion.others.total)}</span>
            </div>
            <div className="conv">
              <span>stake.link vaults</span>
              <b className="mono">{ladder === null ? '—' : `${ladder < 0.1 && ladder > 0 ? '<0.1' : ladder.toFixed(1)}%`}</b>
              <div className="conv-bar ladder" aria-hidden="true"><i style={{ width: `${Math.max(ladder ?? 0, 0.6)}%` }} /></div>
              <span className="muted mono">{formatCount(q.conversion.stakelink.left)} of {formatCount(q.conversion.stakelink.total)}</span>
            </div>
            <p className="foot">stake.link keeps a rolling ladder of unbonding vaults so its users can exit; almost every rung lapses and stays. {formatCount(q.lapsed)} other windows lapsed too.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
