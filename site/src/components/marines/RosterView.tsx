import { ALL_MARINES, tagsDrawn, type RosterFile, type WallQuery } from '@ccip-dev/core/roster';
import { useEffect, useState } from 'react';
import { tagFromSearch } from '../../lib/telegram';
import { useNow } from '../hooks';
import Census from './Census';
import Constellation from './Constellation';
import { EnlistButtons, EnlistCta } from './Enlist';
import MostWanted from './MostWanted';
import PlankOwners from './PlankOwners';
import RarestTen from './RarestTen';
import Ticker from './Ticker';
import { useRoster } from './use-roster';
import Wall from './Wall';

function Hero({ roster, telegram }: { roster: RosterFile | null; telegram: boolean }) {
  const dash = '—';
  return (
    <header className="mr-hero">
      <div>
        <p className="mr-eyebrow">LinkMarines</p>
        <h1>
          The <span className="mr-gold-text">Roster</span>.
        </h1>
        {telegram ? (
          <>
            <p className="mr-lead">Every Marine who has enlisted with the ccip.dev bot, on Discord or Telegram, by callsign. One draw each, stamped forever.</p>
            <EnlistButtons />
          </>
        ) : (
          <p className="mr-lead">
            Every Marine who has enlisted with the ccip.dev bot, by callsign. One draw each, stamped forever. Enlist in any server with <code>/enlist</code>.
          </p>
        )}
      </div>
      <dl className="mr-stats">
        <div>
          <dt>Marines</dt>
          <dd>{roster ? roster.marines.length : dash}</dd>
        </div>
        <div>
          <dt>Legendary</dt>
          <dd className="mr-c-legendary">{roster ? roster.marines.filter((m) => m.tier === 'legendary').length : dash}</dd>
        </div>
        <div>
          <dt>Tags drawn</dt>
          <dd>
            {roster ? tagsDrawn(roster) : dash}
            <span>/{roster ? roster.snapshot.tags.length : dash}</span>
          </dd>
        </div>
      </dl>
    </header>
  );
}

/** The roster page's sections, from the roster as loaded: pure, so it renders on the server for tests and as the loading shell. */
export function RosterPage({ roster, failed, now, telegram = false, tag = null }: { roster: RosterFile | null; failed: boolean; now: Date; telegram?: boolean; tag?: string | null }) {
  const [query, setQuery] = useState<WallQuery>(() => (tag === null ? ALL_MARINES : { ...ALL_MARINES, tag }));
  const pickTag = (picked: string) => {
    setQuery({ ...ALL_MARINES, tag: picked });
    document.getElementById('wall')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const loaded = roster !== null;
  // The wall to scroll to exists only once the roster is in.
  useEffect(() => {
    if (tag !== null && loaded) pickTag(tag);
  }, [tag, loaded]);
  if (roster === null) {
    return (
      <>
        <Hero roster={null} telegram={telegram} />
        {failed ? (
          <p className="mr-state" role="status">
            The roster is out of reach right now. Retrying…
          </p>
        ) : (
          <p className="mr-state" aria-busy="true">
            Loading the roster…
          </p>
        )}
        <EnlistCta roster={null} telegram={telegram} />
      </>
    );
  }
  return (
    <>
      <Hero roster={roster} telegram={telegram} />
      <Ticker roster={roster} />
      <Census roster={roster} onPickTag={pickTag} />
      <MostWanted roster={roster} now={now} />
      <RarestTen roster={roster} />
      <PlankOwners roster={roster} />
      <Wall roster={roster} query={query} onQuery={setQuery} />
      <Constellation roster={roster} onPickTag={pickTag} />
      <EnlistCta roster={roster} telegram={telegram} />
    </>
  );
}

export default function RosterView({ telegram = false }: { telegram?: boolean }) {
  const { roster, failed } = useRoster();
  const now = useNow(60_000);
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => setTag(tagFromSearch(window.location.search)), []);
  return <RosterPage roster={roster} failed={failed} now={now ?? new Date()} telegram={telegram} tag={tag} />;
}
