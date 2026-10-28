import type { ReserveFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { fetchPublic } from '../../lib/data';
import { formatCount, formatLink, formatPct, formatUsd, formatUtcDay } from '../../lib/format';
import { subscribeToday, type LiveToday } from '../../lib/live-store';
import { countdown, vaultFill } from '../../lib/reserve-view';
import { changeTone } from '../../lib/tone';
import { useNow } from '../hooks';
import InfoLink from '../InfoLink';

export const BAR_WEEKS = 26;

export type VaultReserve = Pick<ReserveFile, 'latest' | 'link_price_usd' | 'cost_basis' | 'pace' | 'weekly'>;

const hex = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  });
const points = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/** "Thu, Oct 22" */
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The countdown's four wheels: days, hours, minutes, seconds. */
export function countdownParts(ms: number): [number, number, number, number] {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 86_400), Math.floor((s % 86_400) / 3_600), Math.floor((s % 3_600) / 60), s % 60];
}

function VaultArt({ link, target, fraction }: { link: number; target: number; fraction: number }) {
  const C = 210;
  const inner = hex(C, C, 132);
  const level = C + 132 - fraction * 264;
  const previous = target - 1e6;
  const mark = previous > 0 ? C + 132 - (previous / target) * 264 : null;
  return (
    <svg className="vault-art" viewBox="0 0 420 420" role="img" aria-label={`${formatLink(link)}, ${(fraction * 100).toFixed(1)}% of the way to ${formatCount(target)} LINK`}>
      <defs>
        <linearGradient id="vault-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1c2" />
          <stop offset="0.45" stopColor="#f5c451" />
          <stop offset="1" stopColor="#8a5e10" />
        </linearGradient>
        <linearGradient id="vault-liquid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5c451" stopOpacity="0.6" />
          <stop offset="1" stopColor="#8a5e10" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id="vault-glow">
          <stop offset="0" stopColor="#f5c451" stopOpacity="0.3" />
          <stop offset="1" stopColor="#f5c451" stopOpacity="0" />
        </radialGradient>
        <clipPath id="vault-inside">
          <polygon points={points(inner)} />
        </clipPath>
      </defs>
      <circle cx={C} cy={C} r="205" fill="url(#vault-glow)" />
      <polygon points={points(hex(C, C, 200))} className="vault-ring" />
      <polygon points={points(hex(C, C, 178))} className="vault-ring vault-ring-2" />
      <polygon points={points(inner)} className="vault-floor" />
      <g clipPath="url(#vault-inside)">
        <g className="vault-wave">
          <path
            d={`M-280 ${level.toFixed(1)}${' q35 -9 70 0 t70 0'.repeat(10)} V430 H-280 Z`}
            fill="url(#vault-liquid)"
          />
        </g>
        {mark !== null && <line x1="0" x2="420" y1={mark} y2={mark} className="vault-mark" />}
      </g>
      {mark !== null && (
        <text x={C + 92} y={mark - 6} className="vault-mark-text" textAnchor="end">
          {formatCount(previous / 1e6)}M
        </text>
      )}
      <polygon points={points(hex(C, C, 46))} className="vault-core" />
      <polygon points={points(hex(C, C, 46))} className="vault-core-edge" />
      <polygon points={points(hex(C, C, 150))} className="vault-frame" />
      {hex(C, C, 150).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" className="vault-rivet" />
      ))}
      <text x={C} y={C + 82} className="vault-pct" textAnchor="middle">
        {(fraction * 100).toFixed(1)}%
      </text>
      <text x={C} y={C + 100} className="vault-pct-sub" textAnchor="middle">
        OF {formatCount(target)}
      </text>
    </svg>
  );
}

function Countdown({ next, overdue }: { next: string | null; overdue: boolean }) {
  const now = useNow(1000);
  if (!next) return null;
  const state = now ? countdown(next, overdue, now.getTime()) : null;
  const parts = now && state?.kind === 'counting' ? countdownParts(Date.parse(next) - now.getTime()) : null;
  return (
    <div className="deposit">
      <span className="label">
        Next deposit
        <br />
        expected in
      </span>
      {parts ? (
        <div className="deposit-wheels" role="timer" aria-label={`Next deposit in ${parts[0]} days ${parts[1]} hours ${parts[2]} minutes`}>
          {(['Days', 'Hrs', 'Min', 'Sec'] as const).map((l, i) => (
            <span key={l}>
              <strong className="mono">{String(parts[i]).padStart(2, '0')}</strong>
              {l}
            </span>
          ))}
        </div>
      ) : (
        <span className="deposit-state">{state && state.kind !== 'none' && state.kind !== 'counting' ? state.text : `${formatUtcDay(next)}`}</span>
      )}
    </div>
  );
}

function WeeklyBars({ weekly, pending }: { weekly: VaultReserve['weekly']; pending: number | null }) {
  const weeks = weekly.filter((w) => w.deposits > 0).slice(-BAR_WEEKS);
  if (weeks.length === 0) return null;
  const W = 600;
  const H = 110;
  const slots = weeks.length + (pending ? 1 : 0);
  const gap = 4;
  const bw = (W - gap * (slots - 1)) / slots;
  const max = Math.max(...weeks.map((w) => w.link), pending ?? 0);
  const h = (link: number) => Math.max(2, (link / max) * (H - 4));
  return (
    <div className="vault-bars">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`LINK deposited a week over the last ${weeks.length} weeks, ${formatLink(weeks.at(-1)!.link)} the latest`}>
        <defs>
          <linearGradient id="vault-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f5c451" />
            <stop offset="1" stopColor="#8a5e10" />
          </linearGradient>
        </defs>
        {weeks.map((w, i) => (
          <rect key={w.week} x={i * (bw + gap)} y={H - h(w.link)} width={bw} height={h(w.link)} rx="2" className={i === weeks.length - 1 ? 'bar bar-last' : 'bar'}>
            <title>{`Week of ${formatUtcDay(w.week)}: ${formatLink(w.link)}`}</title>
          </rect>
        ))}
        {pending ? <rect x={weeks.length * (bw + gap)} y={H - h(pending)} width={bw} height={h(pending)} rx="2" className="bar-due" /> : null}
      </svg>
      <p className="vault-bars-cap">
        <span>LINK deposited a week · last {weeks.length} weeks</span>
        {pending ? <span>dashed: this week, due</span> : null}
      </p>
    </div>
  );
}

export default function HomeVault({ initial, today: initialToday }: { initial: VaultReserve; today: LiveToday }) {
  const [reserve, setReserve] = useState(initial);
  const [today, setToday] = useState(initialToday);
  useEffect(() => subscribeToday(setToday), []);
  useEffect(() => {
    let cancelled = false;
    fetchPublic('reserve.json').then(
      (fresh) => {
        if (!cancelled) setReserve(fresh);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const link = reserve.latest?.link ?? null;
  const fill = vaultFill(link);
  const cost = reserve.cost_basis;
  const pace = reserve.pace;
  const price = reserve.link_price_usd;
  const value = cost?.value_usd ?? (link !== null && price !== null ? link * price : null);
  const nextMilestone = pace?.next_milestone && fill && pace.next_milestone.link === fill.target ? pace.next_milestone : null;
  const due = pace?.next_expected_deposit && !pace.deposit_overdue ? pace.avg_weekly_link_4w : null;
  return (
    <>
      <div className="flow">
        <div className="flow-node">
          <span className="label">Today</span>
          <strong className="mono">{formatCount(today.messages)}</strong>
          <span>CCIP messages sent</span>
        </div>
        <svg className="flow-link" viewBox="0 0 70 20" aria-hidden="true">
          <path d="M2 10H60" />
          <path className="flow-head" d="M56 4l8 6-8 6" />
        </svg>
        <div className="flow-node">
          <span className="label">Paying</span>
          <strong className="mono">{formatUsd(today.fees)}</strong>
          <span>in fees to Chainlink today</span>
        </div>
        <svg className="flow-link" viewBox="0 0 70 20" aria-hidden="true">
          <path d="M2 10H60" />
          <path className="flow-head" d="M56 4l8 6-8 6" />
        </svg>
        <div className="flow-node flow-gold">
          <span className="label">Stacking</span>
          <strong className="mono">{formatLink(link)}</strong>
          <span>in the Reserve{pace?.deposit_streak ? `, ${pace.deposit_streak} weeks running` : ''}</span>
        </div>
      </div>
      <div className="vault">
        {fill && link !== null ? <VaultArt link={link} target={fill.target} fraction={fill.fraction} /> : <div />}
        <div className="vault-copy">
          <span className="label">
            Chainlink Reserve · Ethereum
            <InfoLink metric="reserve" label="the Reserve figures" />
          </span>
          <p className="vault-big">{link === null ? '—' : formatCount(link)}</p>
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
          <Countdown next={pace?.next_expected_deposit ?? null} overdue={pace?.deposit_overdue ?? false} />
          <WeeklyBars weekly={reserve.weekly} pending={due} />
        </div>
      </div>
    </>
  );
}
