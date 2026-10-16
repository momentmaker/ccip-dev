import { serialText, type Tier } from '@ccip-dev/core/linkmarine';
import { wallMarines, type RosterFile, type WallQuery } from '@ccip-dev/core/roster';
import { useEffect, useState } from 'react';
import { marinePath, tierName } from '../../lib/marines';
import { TELEGRAM_ENLIST_URL } from '../../lib/telegram';
import DogTag from './DogTag';

export const WALL_PAGE = 60;

const PILLS: { label: string; tier: Tier | null; order: WallQuery['order'] }[] = [
  { label: 'ALL', tier: null, order: 'rarity' },
  { label: 'LEGENDARY', tier: 'legendary', order: 'rarity' },
  { label: 'RARE', tier: 'rare', order: 'rarity' },
  { label: 'UNCOMMON', tier: 'uncommon', order: 'rarity' },
  { label: 'COMMON', tier: 'common', order: 'rarity' },
  { label: 'NEWEST', tier: null, order: 'newest' },
];

export default function Wall({ roster, query, onQuery, telegram = false }: { roster: RosterFile; query: WallQuery; onQuery: (q: WallQuery) => void; telegram?: boolean }) {
  const [shown, setShown] = useState(WALL_PAGE);
  const marines = wallMarines(roster.marines, query);
  useEffect(() => setShown(WALL_PAGE), [query.text, query.tier, query.tag, query.order]);
  return (
    <section id="wall" className="mr-section" aria-labelledby="wall-title">
      <p className="mr-eyebrow">the wall</p>
      <h2 id="wall-title">Every dog tag.</h2>
      <div className="mr-toolbar">
        <label className="mr-search">
          <span className="visually-hidden">Search the roster</span>
          <input type="search" value={query.text} placeholder="Search a callsign, a tag or a serial: sergey, comfy, #7…" onChange={(e) => onQuery({ ...query, text: e.target.value })} />
        </label>
        <div className="mr-pills" role="group" aria-label="Filter the wall">
          {PILLS.map((p) => (
            <button key={p.label} type="button" className="mr-pill" aria-pressed={p.tier === query.tier && p.order === query.order} onClick={() => onQuery({ ...query, tier: p.tier, order: p.order })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mr-filter" role="status">
        {query.tag !== null && (
          <>
            {marines.length} {marines.length === 1 ? 'Marine carries' : 'Marines carry'} “{query.tag}” ·{' '}
            <button type="button" onClick={() => onQuery({ ...query, tag: null })}>
              clear
            </button>
          </>
        )}
      </p>
      {roster.marines.length === 0 ? (
        <p className="mr-empty">
          No Marines yet. Be #0001: <code>/enlist</code>
          {telegram && (
            <>
              {' '}
              on Discord, or <a href={TELEGRAM_ENLIST_URL}>enlist on Telegram</a>
            </>
          )}
        </p>
      ) : marines.length === 0 ? (
        <p className="mr-empty">No Marine matches that.</p>
      ) : null}
      <ul className="mr-wall">
        {marines.slice(0, shown).map((m) => (
          <li key={m.serial}>
            <a className="mr-wall-link" href={marinePath(m.serial)} aria-label={`LINK MARINE #${serialText(m.serial)}, ${m.callsign}, ${tierName(m.tier)}`}>
              <DogTag marine={m} />
              <span className="mr-meta" aria-hidden="true">
                <span className={`mr-c-${m.tier}`}>{m.tier.toUpperCase()}</span>
                <span>#{serialText(m.serial)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {marines.length > shown && (
        <button type="button" className="mr-more" onClick={() => setShown(shown + WALL_PAGE)}>
          Show more
        </button>
      )}
    </section>
  );
}
