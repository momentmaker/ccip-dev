import { callsignsPerTag, mostWanted, tagBoard, type RosterFile } from '@ccip-dev/core/roster';
import type { CSSProperties } from 'react';
import { memeUrl } from '../../lib/marines';

const TILTS = [-2.5, 1.5, -1, 2.2, -1.8];

/** Five WANTED posters of the rarest undrawn tags, the same five for everyone until 00:00 UTC. */
export default function MostWanted({ roster, now }: { roster: RosterFile; now: Date }) {
  const posters = mostWanted(roster, now);
  const undrawn = tagBoard(roster).filter((t) => t.discoverer === null);
  return (
    <section className="mr-section" aria-labelledby="wanted-title">
      <h2 id="wanted-title" className="mr-h3">
        Today’s most wanted
      </h2>
      {posters.length === 0 ? (
        <p className="mr-note">Every tag has been drawn. The board is full.</p>
      ) : (
        <>
          <p className="mr-note">
            {undrawn.length} tags are still undrawn, {undrawn.filter((t) => t.count === 1).length} of them one-of-a-kind. Five new posters every day at 00:00 UTC. Draw one first and you’re its discoverer, on the board for good.
          </p>
          <ul className="mr-posters">
            {posters.map((t, i) => (
              <li key={t.tag} className="mr-poster" style={{ '--tilt': `${TILTS[i]}deg` } as CSSProperties}>
                <p className="mr-poster-head">WANTED</p>
                <img src={memeUrl(t.meme)} alt={`The ${t.tag} meme`} width={200} height={200} loading="lazy" />
                <p className="mr-poster-name">{t.tag}</p>
                <p className="mr-poster-odds">
                  ABOUT 1 IN {callsignsPerTag(t.chance).toLocaleString('en-US')} CALLSIGNS
                  <br />
                  {t.count === 1 ? 'ONE MEME' : `${t.count} MEMES`} IN THE ARCHIVE
                </p>
                <p className="mr-poster-reward">REWARD · DISCOVERER CREDIT</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
