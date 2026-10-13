import { ALL_MARINES, tagsDrawn, type RosterFile, type WallQuery } from '@ccip-dev/core/roster';
import { useState } from 'react';
import { useNow } from '../hooks';
import Census from './Census';
import Constellation from './Constellation';
import MostWanted from './MostWanted';
import PlankOwners from './PlankOwners';
import RarestTen from './RarestTen';
import Ticker from './Ticker';
import { useRoster } from './use-roster';
import Wall from './Wall';

function Hero({ roster }: { roster: RosterFile | null }) {
  const dash = '—';
  return (
    <header className="mr-hero">
      <div>
        <p className="mr-eyebrow">LinkMarines</p>
        <h1>
          The <span className="mr-gold-text">Roster</span>.
        </h1>
        <p className="mr-lead">
          Every Marine who has enlisted with the ccip.dev bot, by callsign. One draw each, stamped forever. Enlist in any server with <code>/enlist</code>.
        </p>
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
export function RosterPage({ roster, failed, now }: { roster: RosterFile | null; failed: boolean; now: Date }) {
  const [query, setQuery] = useState<WallQuery>(ALL_MARINES);
  const pickTag = (tag: string) => {
    setQuery({ ...ALL_MARINES, tag });
    document.getElementById('wall')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (roster === null) {
    return (
      <>
        <Hero roster={null} />
        {failed ? (
          <p className="mr-state" role="status">
            The roster is out of reach right now. Retrying…
          </p>
        ) : (
          <p className="mr-state" aria-busy="true">
            Loading the roster…
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <Hero roster={roster} />
      <Ticker roster={roster} />
      <Census roster={roster} onPickTag={pickTag} />
      <MostWanted roster={roster} now={now} />
      <RarestTen roster={roster} />
      <PlankOwners roster={roster} />
      <Wall roster={roster} query={query} onQuery={setQuery} />
      <Constellation roster={roster} onPickTag={pickTag} />
    </>
  );
}

export default function RosterView() {
  const { roster, failed } = useRoster();
  const now = useNow(60_000);
  return <RosterPage roster={roster} failed={failed} now={now ?? new Date()} />;
}
