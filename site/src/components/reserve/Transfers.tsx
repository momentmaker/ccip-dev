import type { ReserveFile } from '@ccip-dev/core/public';
import { useState } from 'react';
import { DASH, formatCount, formatPct, formatUsd, formatUtcDay, formatUtcTime } from '../../lib/format';
import { shortAddress } from '../../lib/names';
import { DUST_LINK, shownTransfers } from '../../lib/reserve-view';
import { changeTone } from '../../lib/tone';

/** The Reserve's transfers, newest first: the latest 10 unless asked for all, test-sized dust only when asked. */
export default function Transfers({ transfers }: { transfers: ReserveFile['transfers'] }) {
  const [all, setAll] = useState(false);
  const [dust, setDust] = useState(false);
  if (transfers.length === 0) return null;
  const rows = shownTransfers(transfers, { all, dust });
  const dustCount = transfers.filter((t) => t.link < DUST_LINK).length;
  const total = transfers.length - (dust ? 0 : dustCount);
  return (
    <section className="band" id="transfers" aria-labelledby="transfers-title">
      <div className="band-head">
        <p className="eyebrow">On-chain</p>
        <h2 id="transfers-title">Transfers</h2>
      </div>
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
            {rows.map((t, i) => (
              <tr key={`${t.tx}-${i}`}>
                <td className="mono nw">
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
      <div className="transfer-tools">
        {(all || total > rows.length) && (
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show the latest 10' : `Show all ${formatCount(total)} transfers`}
          </button>
        )}
        {dustCount > 0 && (
          <button type="button" aria-pressed={dust} onClick={() => setDust(!dust)}>
            {dust ? `Hide the ${formatCount(dustCount)} test-sized transfers` : `Include ${formatCount(dustCount)} test-sized transfers (under ${DUST_LINK} LINK)`}
          </button>
        )}
      </div>
    </section>
  );
}
