import { serialText } from '@ccip-dev/core/linkmarine';
import { tickerItems, type RosterFile, type TickerItem } from '@ccip-dev/core/roster';
import { TICKER_SECONDS_PER_ITEM } from '../../lib/marines';

function Item({ item }: { item: TickerItem }) {
  switch (item.kind) {
    case 'legendary':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k mr-tk-gold">★ LEGENDARY DRAWN</span>
          <span className="mr-c-legendary">{item.callsign}</span>
          <small>#{serialText(item.serial)} · rarer than {item.rarerThan}% of draws</small>
        </li>
      );
    case 'recruit':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k">NEW RECRUIT</span>
          <span className={`mr-c-${item.tier}`}>{item.callsign}</span>
          <small>#{serialText(item.serial)} · {item.tier.toUpperCase()}</small>
        </li>
      );
    case 'sighting':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k mr-tk-hot">FIRST SIGHTING</span>“{item.tag}”
          <small>about 1 in {item.oneIn.toLocaleString('en-US')} · discovered by #{serialText(item.serial)}</small>
        </li>
      );
    case 'stat':
      return (
        <li className="mr-tk">
          <span className="mr-tk-k">{item.label}</span>
          {item.value}
        </li>
      );
  }
}

/** The news-style crawl: the content twice in one strip that slides by half its width, the repeat hidden from screen readers. */
export default function Ticker({ roster }: { roster: RosterFile }) {
  const items = tickerItems(roster);
  const run = items.map((item, i) => <Item key={i} item={item} />);
  return (
    <section className="mr-ticker" aria-label="Latest on the roster">
      <div className="mr-ticker-label" aria-hidden="true">
        <span className="mr-dot" />
        LIVE · ROSTER
      </div>
      <div className="mr-ticker-lane" tabIndex={0}>
        <div className="mr-ticker-run" style={{ animationDuration: `${items.length * TICKER_SECONDS_PER_ITEM}s` }}>
          <ul>{run}</ul>
          <ul aria-hidden="true">{run}</ul>
        </div>
      </div>
    </section>
  );
}
