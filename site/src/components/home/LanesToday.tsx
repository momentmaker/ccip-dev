import type { TopEntry } from '@ccip-dev/core/public';
import { formatCount, formatUsd } from '../../lib/format';
import { laneLabel, type ChainNames } from '../../lib/names';
import ChainIcons from '../ChainIcons';

export const LANES_SHOWN = 4;

/** Today's lanes by value moved, as bars against the biggest. */
export default function LanesToday({ lanes, names }: { lanes: readonly TopEntry[]; names: ChainNames }) {
  const rows = [...lanes].filter((l) => (l.usd ?? 0) > 0).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, LANES_SHOWN);
  if (rows.length === 0) return null;
  const top = rows[0]!.usd ?? 1;
  return (
    <div className="lanes-today">
      <span className="label">Biggest lanes today</span>
      <ol className="lt">
        {rows.map((l) => (
          <li key={l.key}>
            <span className="lt-name">
              <ChainIcons selectors={l.key.split('>')} size={18} />
              <span>{laneLabel(names, l.key)}</span>
            </span>
            <span className="lt-bar" aria-hidden="true">
              <i style={{ width: `${(((l.usd ?? 0) / top) * 100).toFixed(1)}%` }} />
            </span>
            <span className="lt-usd mono">{formatUsd(l.usd)}</span>
            <span className="lt-n mono">
              {formatCount(l.messages)} msg{l.messages === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
