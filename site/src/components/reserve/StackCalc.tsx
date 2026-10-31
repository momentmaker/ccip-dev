import type { ReserveFile } from '@ccip-dev/core/public';
import { useState } from 'react';
import { formatCount, formatDuration, formatPct, formatPrice, formatUsd } from '../../lib/format';
import { depositWeeks, stackWithReserve, timeToStack } from '../../lib/reserve-view';
import { changeTone } from '../../lib/tone';

const DOLLARS = [25, 100, 1_000];
const BAGS = [1_000, 15_000, 100_000];

function Presets({ values, current, unit, onPick }: { values: number[]; current: number; unit: (v: number) => string; onPick: (v: number) => void }) {
  return (
    <div className="stack-presets">
      {values.map((v) => (
        <button key={v} type="button" aria-pressed={current === v} onClick={() => onPick(v)}>
          {unit(v)}
        </button>
      ))}
    </div>
  );
}

/** What matching every deposit would hold now, and how fast the Reserve stacks a bag at its pace. */
export default function StackCalc({ reserve }: { reserve: Pick<ReserveFile, 'weekly' | 'link_price_usd' | 'pace'> }) {
  const [dollars, setDollars] = useState(100);
  const [bag, setBag] = useState(1_000);
  const weeks = depositWeeks(reserve.weekly);
  const price = reserve.link_price_usd;
  const stack = stackWithReserve(weeks, Math.max(0, dollars || 0), price);
  const seconds = timeToStack(Math.max(0, bag || 0), reserve.pace?.avg_weekly_link_4w ?? null);
  if (stack.deposits === 0) return null;
  return (
    <section className="band" id="stack" aria-labelledby="stack-title">
      <div className="band-head">
        <p className="eyebrow">Stack with the Reserve</p>
        <h2 id="stack-title">
          Match every deposit. <span className="g">See what you'd hold.</span>
        </h2>
      </div>
      <div className="stack-grid">
        <div className="panel">
          <label className="stack-in" htmlFor="stack-dollars">
            <span>Buy $</span>
            <input id="stack-dollars" name="dollars" type="number" inputMode="decimal" min={0} step="any" value={dollars} onChange={(e) => setDollars(Number(e.target.value))} />
            <span>of LINK every week the Reserve deposited</span>
          </label>
          <Presets values={DOLLARS} current={dollars} unit={(v) => `$${formatCount(v)}`} onPick={setDollars} />
          <p className="stack-out">
            <b>{formatCount(Math.round(stack.link))} LINK</b>
            <br />
            {stack.value !== null && (
              <>
                worth {formatUsd(stack.value)} now on {formatUsd(stack.invested)} in,{' '}
                <span className={changeTone(stack.changePct)}>{formatPct(stack.changePct)}</span>
              </>
            )}
          </p>
          <p className="foot">
            {formatCount(stack.deposits)} buys at the average price the Reserve paid each week{price !== null ? `, valued at ${formatPrice(price)}` : ''}. Not advice.
          </p>
        </div>
        <div className="panel">
          <label className="stack-in" htmlFor="stack-bag">
            <span>Your bag:</span>
            <input id="stack-bag" name="bag" type="number" inputMode="decimal" min={0} step="any" value={bag} onChange={(e) => setBag(Number(e.target.value))} />
            <span>LINK</span>
          </label>
          <Presets values={BAGS} current={bag} unit={(v) => formatCount(v)} onPick={setBag} />
          <p className="stack-out">
            {seconds === null ? (
              'The Reserve has no weekly pace yet.'
            ) : (
              <>
                The Reserve stacks that every
                <br />
                <b>{formatDuration(seconds)}</b>
              </>
            )}
          </p>
          <p className="foot">At the last four weeks' pace of {formatCount(reserve.pace?.avg_weekly_link_4w)} LINK a week. Deposits land weekly, not by the hour.</p>
        </div>
      </div>
    </section>
  );
}
