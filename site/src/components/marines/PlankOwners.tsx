import { serialText } from '@ccip-dev/core/linkmarine';
import { plankSeats, type RosterFile } from '@ccip-dev/core/roster';
import { marinePath } from '../../lib/marines';

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
      <ol className="mr-seats">
        {seats.map((m, i) => (
          <li key={i}>
            {m ? (
              <a className={`mr-seat mr-metal-${m.tier}`} href={marinePath(m.serial)} title={m.callsign}>
                <span className="visually-hidden">LINK MARINE #{serialText(m.serial)}, {m.callsign}: seat </span>
                {i + 1}
              </a>
            ) : (
              <span className="mr-seat">{i + 1}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
