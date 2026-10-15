import type { Gate } from '@ccip-dev/core/linkmarine';
import { PLANK_SEATS, plankSeats, type RosterFile } from '@ccip-dev/core/roster';

export const SEAT_PREVIEW = 30;

export function OpensSoon() {
  return (
    <p className="tg-soon" role="status">
      LinkMarines on Telegram opens soon
    </p>
  );
}

/** Screen 1: enlist, the plank-owner seats, the counts, the gate's notice when it fails, and a status line when the last enlist did not go through. */
export default function Welcome({ roster, gate, open, notice, onJoin, onCheck }: { roster: RosterFile | null; gate: Gate; open: boolean; notice: string | null; onJoin: () => void; onCheck: () => void }) {
  const seats = roster ? plankSeats(roster.marines) : [];
  const left = seats.filter((s) => s === null).length;
  return (
    <section className="tg-body" aria-labelledby="tg-welcome">
      <p className="tg-eyebrow">ccip.dev · LinkMarines</p>
      <h1 id="tg-welcome" className="tg-big">
        Enlist, Marine.
      </h1>
      <p className="tg-muted">Three tags from the LinkMarine meme vault become your callsign. One draw, forever. Rarer tags, rarer tier.</p>
      <ol className="tg-seats" aria-label={`The first ${SEAT_PREVIEW} plank-owner seats`}>
        {Array.from({ length: SEAT_PREVIEW }, (_, i) => {
          const m = seats[i] ?? null;
          return <li key={i} className={m ? `tg-seat mr-metal-${m.tier}` : 'tg-seat tg-open'} title={m?.callsign} />;
        })}
      </ol>
      <p className="tg-muted tg-center">
        Plank-owner seats: <b>{!roster ? '—' : left === 0 ? `all ${PLANK_SEATS} taken` : `${left} of ${PLANK_SEATS} left`}</b>
      </p>
      <div className="tg-stat">
        <div>
          <b>{roster ? roster.marines.length : '—'}</b>
          <span className="tg-muted">Marines</span>
        </div>
        <div>
          <b>{roster ? roster.snapshot.tags.length : '—'}</b>
          <span className="tg-muted">tags in the vault</span>
        </div>
      </div>
      {open && gate === 'join' && (
        <div className="tg-gate" role="status">
          <p>
            Not in @ccipdev yet? <b>Join the channel</b> to enlist, then <b>Check again</b>.
          </p>
          <div className="tg-gate-actions">
            <button type="button" className="tg-btn2" onClick={onJoin}>
              Join
            </button>
            <button type="button" className="tg-btn2" onClick={onCheck}>
              Check again
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p className="tg-notice" role="status">
          {notice}
        </p>
      )}
      {!open && <OpensSoon />}
    </section>
  );
}
