import { serialText } from '@ccip-dev/core/linkmarine';
import { plankSeats, type RosterFile } from '@ccip-dev/core/roster';
import { marinePath } from '../../lib/marines';

/** The hundred seats, taken ones in their Marine's metal; `markNext` lights the next open seat. */
export function PlankSeats({ roster, markNext = false }: { roster: RosterFile; markNext?: boolean }) {
  const seats = plankSeats(roster.marines);
  const next = markNext ? seats.indexOf(null) : -1;
  return (
    <ol className="mr-seats">
      {seats.map((m, i) => (
        <li key={i}>
          {m ? (
            <a className={`mr-seat mr-metal-${m.tier}`} href={marinePath(m.serial)} title={m.callsign}>
              <span className="visually-hidden">LINK MARINE #{serialText(m.serial)}, {m.callsign}: seat </span>
              {i + 1}
            </a>
          ) : (
            <span className={i === next ? 'mr-seat mr-seat-next' : 'mr-seat'} title={i === next ? 'The next seat' : undefined}>
              {i + 1}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function PlankOwners({ roster }: { roster: RosterFile }) {
  const seats = plankSeats(roster.marines);
  return (
    <section className="mr-section" aria-labelledby="plank-title">
      <p className="mr-eyebrow">plank owners</p>
      <h2 id="plank-title">The first hundred.</h2>
      <p className="mr-lead">
        Navy and Marine tradition calls a ship’s original crew its plank owners. The first 100 to enlist hold those seats for good.
        {seats.every((s) => s !== null) ? ' All 100 seats are taken.' : ''}
      </p>
      <PlankSeats roster={roster} />
    </section>
  );
}
