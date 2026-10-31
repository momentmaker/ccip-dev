import type { ReserveFile } from '@ccip-dev/core/public';
import { useEffect, useRef, useState } from 'react';
import { formatCount, formatPct, formatPrice, formatUsd, formatUtcDay } from '../../lib/format';
import { depositWeeks, type DepositWeek } from '../../lib/reserve-view';
import { changeTone } from '../../lib/tone';

const H = 280;
const PAD = { top: 18, right: 112, bottom: 22, left: 40 };
const R = 4.5;

const niceTop = (max: number) => Math.max(5, Math.ceil((max * 1.08) / 5) * 5);

/** A chart that draws to its container's width, so the dots stay round on any screen. */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || initial);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [initial]);
  return { ref, width };
}

function Chart({ weeks, price, avg }: { weeks: DepositWeek[]; price: number; avg: number | null }) {
  const { ref, width } = useWidth(900);
  const [hover, setHover] = useState<number | null>(null);
  const priced = weeks.flatMap((w, i) => (w.price === null ? [] : [{ ...w, i, price: w.price }]));
  const top = niceTop(Math.max(price, ...priced.map((w) => w.price)));
  const narrow = width < 520;
  const r = narrow ? 4 : R;
  const right = narrow ? 12 : PAD.right;
  const plotW = Math.max(60, width - PAD.left - right);
  const x = (i: number) => PAD.left + (weeks.length <= 1 ? plotW / 2 : (i / (weeks.length - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const ticks = Array.from({ length: Math.floor(top / 5) + 1 }, (_, k) => k * 5).filter((t) => top <= 30 || t % 10 === 0);
  const best = priced.reduce((a, b) => (b.price < a.price ? b : a), priced[0]!);
  const worst = priced.reduce((a, b) => (b.price > a.price ? b : a), priced[0]!);
  const shown = hover === null ? null : priced.find((w) => w.i === hover) ?? null;
  // The best price is labeled under its dot and the worst over it, clear of the dots beside them.
  const callout = (w: typeof best, label: string, above: boolean) => (
    <text x={Math.min(Math.max(x(w.i), PAD.left + 30), PAD.left + plotW - 30)} y={y(w.price) + (above ? -12 : 20)} textAnchor="middle" className="bl-callout">
      {`${label} ${formatPrice(w.price)}`}
    </text>
  );
  return (
    <div className="bought-chart" ref={ref}>
      <svg width={width} height={H} role="img" aria-label={`The price the Reserve paid each of ${priced.length} deposit weeks, from ${formatPrice(best.price)} to ${formatPrice(worst.price)}, against ${formatPrice(price)} now`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className="bl-grid" />
            <text x={PAD.left - 8} y={y(t) + 3} textAnchor="end" className="bl-tick">{`$${t}`}</text>
          </g>
        ))}
        {avg !== null && <line x1={PAD.left} x2={PAD.left + plotW} y1={y(avg)} y2={y(avg)} className="bl-ref cost" />}
        <line x1={PAD.left} x2={PAD.left + plotW} y1={y(price)} y2={y(price)} className="bl-ref" />
        {!narrow && (
          <>
            <text x={PAD.left + plotW + 8} y={y(price) + (avg !== null && avg > price ? 12 : -4)} className="bl-ref-label">{`LINK now ${formatPrice(price)}`}</text>
            {avg !== null && <text x={PAD.left + plotW + 8} y={y(avg) + (avg > price ? -4 : 12)} className="bl-ref-label">{`avg cost ${formatPrice(avg)}`}</text>}
          </>
        )}
        {priced.map((w) => (
          <circle key={w.week} cx={x(w.i)} cy={y(w.price)} r={hover === w.i ? r + 1.5 : r} className={`bl-dot ${w.price <= price ? 'more' : 'less'}${hover === w.i ? ' on' : ''}`} />
        ))}
        {callout(best, 'best', false)}
        {callout(worst, 'worst', true)}
        <text x={PAD.left} y={H - 4} className="bl-tick">{formatUtcDay(weeks[0]!.week)}</text>
        <text x={PAD.left + plotW} y={H - 4} textAnchor="end" className="bl-tick">{`week of ${formatUtcDay(weeks.at(-1)!.week)}`}</text>
        {priced.map((w) => (
          <circle key={`hit-${w.week}`} cx={x(w.i)} cy={y(w.price)} r={12} className="bl-hit" onPointerEnter={() => setHover(w.i)} onPointerLeave={() => setHover(null)} />
        ))}
      </svg>
      {shown && (
        <div className="bl-tip" style={{ left: x(shown.i), top: y(shown.price) }}>
          <strong>{formatPrice(shown.price)}</strong>
          week of {formatUtcDay(shown.week)} · {formatCount(shown.link)} LINK
          <br />
          worth {formatPct(((price - shown.price) * 100) / shown.price)} now
        </div>
      )}
    </div>
  );
}

/** What the Reserve paid for its LINK week by week against today's price, and its cost against its value now. */
export default function BoughtLowHigh({ reserve }: { reserve: Pick<ReserveFile, 'weekly' | 'link_price_usd' | 'cost_basis' | 'performance'> }) {
  const weeks = depositWeeks(reserve.weekly);
  const price = reserve.link_price_usd;
  const cost = reserve.cost_basis;
  if (price === null || !weeks.some((w) => w.price !== null)) return null;
  const more = weeks.filter((w) => w.price !== null && w.price <= price).length;
  const less = weeks.filter((w) => w.price !== null && w.price > price).length;
  const value = cost?.value_usd ?? null;
  const scale = cost && value !== null ? Math.max(cost.cost_usd, value) : null;
  const up = (cost?.change_pct ?? 0) >= 0;
  return (
    <section className="band" id="bought" aria-labelledby="bought-title">
      <div className="band-head">
        <p className="eyebrow">Cost basis</p>
        <h2 id="bought-title">
          Bought low, <span className="g">bought high</span>.
        </h2>
        <p className="lead">
          {formatCount(weeks.length)} weeks of deposits, each at the price of the day: {formatCount(more)} are worth more now, {formatCount(less)} less.
          {cost?.avg_deposit_price_usd != null && ` On average the Reserve paid ${formatPrice(cost.avg_deposit_price_usd)} a LINK; LINK is ${formatPrice(price)} now.`}
        </p>
      </div>
      <div className="bought-grid">
        <div className="panel">
          <ul className="bl-key">
            <li><i className="more" />worth more now</li>
            <li><i className="less" />worth less now</li>
            <li><i className="ref" />LINK now</li>
            <li><i className="ref cost" />average cost</li>
          </ul>
          <Chart weeks={weeks} price={price} avg={cost?.avg_deposit_price_usd ?? null} />
          <p className="foot">Each dot is a week's deposit at the average price paid that week. Hover a dot for its week; every transfer is in the table below.</p>
        </div>
        {cost && value !== null && scale !== null && (
          <div className="panel paid">
            <div className="paid-row">
              <span>Paid at deposit time</span>
              <b>{formatUsd(cost.cost_usd)}</b>
              <div className="paid-bar" aria-hidden="true"><i style={{ width: `${(100 * cost.cost_usd) / scale}%` }} /></div>
            </div>
            <div className="paid-row">
              <span>Worth now</span>
              <b>{formatUsd(value)}</b>
              <div className={`paid-bar now${up ? '' : ' down'}`} aria-hidden="true"><i style={{ width: `${(100 * value) / scale}%` }} /></div>
            </div>
            <div className="paid-row">
              <span>Change</span>
              <p className={`paid-change ${changeTone(cost.change_pct)}`} style={{ margin: 0 }}>
                {formatUsd(cost.change_usd)} <small>({formatPct(cost.change_pct)})</small>
              </p>
            </div>
            {reserve.performance?.best && reserve.performance.worst && (
              <p className="foot">
                Best single deposit {formatPrice(reserve.performance.best.price_usd)} on {formatUtcDay(reserve.performance.best.ts)}; worst {formatPrice(reserve.performance.worst.price_usd)} on{' '}
                {formatUtcDay(reserve.performance.worst.ts)}.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
