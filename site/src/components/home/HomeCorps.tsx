import { rarerThan, serialText } from '@ccip-dev/core/linkmarine';
import { mostWanted, PLANK_SEATS, tagsDrawn, type RosterFile } from '@ccip-dev/core/roster';
import { enlistedText, marinePath, memeverseUrl, tierName } from '../../lib/marines';
import { useNow } from '../hooks';
import DogTag from '../marines/DogTag';
import { EnlistCta } from '../marines/Enlist';
import { undrawnText, WantedPosters } from '../marines/MostWanted';
import { PlankSeats } from '../marines/PlankOwners';
import { useRoster } from '../marines/use-roster';

/** The newest Marine: the highest serial. */
export const newestMarine = (roster: RosterFile) => roster.marines.reduce<RosterFile['marines'][number] | null>((best, m) => (best === null || m.serial > best.serial ? m : best), null);

/** The Corps as loaded: pure, so it renders on the server for tests and as the loading shell. */
export function CorpsBody({ roster, failed, now, telegram }: { roster: RosterFile | null; failed: boolean; now: Date; telegram: boolean }) {
  const dash = '—';
  const newest = roster ? newestMarine(roster) : null;
  const open = roster ? Math.max(0, PLANK_SEATS - roster.marines.filter((m) => m.serial <= PLANK_SEATS).length) : null;
  const posters = roster ? mostWanted(roster, now) : [];
  return (
    <>
      <div className="band-head">
        <div>
          <p className="eyebrow">LinkMarines</p>
          <h2 id="corps-title">
            The <span className="g">Corps</span>.
          </h2>
          <p className="lead">Every Marine draws a permanent meme callsign, stamped on a pair of dog tags. One draw each, forever.</p>
        </div>
        <dl className="mr-stats corps-stats">
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
      </div>
      {roster === null ? (
        <p className="mr-state" role="status" aria-busy={!failed}>
          {failed ? 'The roster is out of reach right now. Retrying…' : 'Loading the roster…'}
        </p>
      ) : (
        <>
          <div className="corps-grid">
            <div className="panel">
              <span className="label">Plank owners · the first {PLANK_SEATS}</span>
              <p className="plank-big">
                {open}
                <small> of {PLANK_SEATS} seats {open === 0 ? 'left: all taken' : 'still open'}</small>
              </p>
              <PlankSeats roster={roster} markNext />
              <p className="corps-note">Navy and Marine tradition calls a ship’s first crew its plank owners. The first {PLANK_SEATS} to enlist hold those seats for good. The blinking seat is the next one.</p>
            </div>
            {newest && (
              <div className="panel corps-recruit">
                <span className="label">Newest recruit</span>
                <a className="mr-wall-link corps-tag" href={marinePath(newest.serial)} aria-label={`LINK MARINE #${serialText(newest.serial)}, ${newest.callsign}`}>
                  <DogTag marine={newest} big />
                </a>
                <p className="corps-callsign mono">{newest.callsign}</p>
                <p className="corps-meta">
                  #{serialText(newest.serial)} · <span className={`mr-metal-text-${newest.tier}`}>{tierName(newest.tier)}</span> · rarer than {rarerThan(newest.percentile)}% · enlisted {enlistedText(newest.enlisted)}
                </p>
                <p className="corps-meta">
                  <a href={memeverseUrl(newest.callsign)}>Fly these tags in the Memeverse →</a>
                  {' · '}
                  <a href="/marines/">The full roster →</a>
                </p>
              </div>
            )}
          </div>
          {posters.length > 0 && (
            <div className="corps-wanted">
              <h3>Today’s most wanted</h3>
              <p className="mr-note">{undrawnText(roster)} Draw one first and you’re its discoverer, on the board for good. New posters at 00:00 UTC.</p>
              <WantedPosters posters={posters} />
            </div>
          )}
        </>
      )}
      <EnlistCta roster={roster} telegram={telegram} />
    </>
  );
}

export default function HomeCorps({ telegram = false }: { telegram?: boolean }) {
  const { roster, failed } = useRoster();
  const now = useNow(60_000);
  return <CorpsBody roster={roster} failed={failed} now={now ?? new Date()} telegram={telegram} />;
}
