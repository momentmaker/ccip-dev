import type { LiveMessage } from '@ccip-dev/core/public';
import { useRef, useState, type CSSProperties } from 'react';
import { formatUsd } from '../../lib/format';
import { laneLabel, type ChainNames } from '../../lib/names';
import { GOLD_USD } from '../../sky/scene';
import ChainIcons from '../ChainIcons';

/** The crawl moves about 75 px a second; an item runs about 300 px. */
export const TICKER_SECONDS_PER_ITEM = 4;
/** Fewer items than this leave a gap in the crawl, so they sit still instead. */
export const TICKER_MIN_ITEMS = 6;

function Item({ m, names }: { m: LiveMessage; names: ChainNames }) {
  return (
    <span className={(m.usd ?? 0) >= GOLD_USD ? 'tk gold' : 'tk'}>
      <ChainIcons selectors={[m.src, m.dst]} />
      {laneLabel(names, `${m.src}>${m.dst}`)}
      <span className="mono">
        {m.token ?? 'data'}
        {m.usd ? ` ${formatUsd(m.usd)}` : ''}
      </span>
      {m.sender_label && (
        <span className="muted">
          {m.sender_label} <span className="verified">✓</span>
        </span>
      )}
    </span>
  );
}

/**
 * The live feed as a crawl along the hero's foot. A new feed waits for the crawl to finish its lap before it swaps in,
 * so the line never jumps mid-read. The COMMS log below lists the same messages for screen readers, so this one is hidden.
 */
export default function HomeTicker({ messages, names }: { messages: readonly LiveMessage[]; names: ChainNames }) {
  const [shown, setShown] = useState(messages);
  const latest = useRef(messages);
  latest.current = messages;
  const items = shown.length === 0 ? messages : shown;
  const crawl = items.length >= TICKER_MIN_ITEMS;
  return (
    <div className="ticker" aria-hidden="true">
      <span className="ticker-label">
        <span className="live-dot" />
        COMMS
      </span>
      <div className="ticker-lane">
        {items.length === 0 ? (
          <span className="tk muted">No messages in the last 15 minutes.</span>
        ) : (
          <div
            className={crawl ? 'ticker-track crawl' : 'ticker-track'}
            style={{ '--dur': `${items.length * TICKER_SECONDS_PER_ITEM}s` } as CSSProperties}
            onAnimationIteration={() => setShown(latest.current)}
          >
            {items.map((m) => (
              <Item key={m.id} m={m} names={names} />
            ))}
            {crawl && items.map((m) => <Item key={`again-${m.id}`} m={m} names={names} />)}
          </div>
        )}
      </div>
    </div>
  );
}
