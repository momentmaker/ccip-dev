import { rarerThan, serialText } from '@ccip-dev/core/linkmarine';
import { ranked, type RosterFile } from '@ccip-dev/core/roster';
import { marinePath, rarestBarPct } from '../../lib/marines';

/** The ten rarest Marines. With `onPickMarine`, a row opens the Marine where it is instead of going to their page. */
export default function RarestTen({ roster, onPickMarine }: { roster: RosterFile; onPickMarine?: (serial: number) => void }) {
  if (roster.marines.length === 0) return null;
  const all = ranked(roster.marines);
  const high = all[0]!.score;
  const low = all[all.length - 1]!.score;
  return (
    <section className="mr-section" aria-labelledby="rarest-title">
      <p className="mr-eyebrow">rarest ten</p>
      <h2 id="rarest-title">The hardest draws in the corps.</h2>
      <p className="mr-lead">Ranked by the callsign’s exact score, so two Legendaries still have an order. Every Marine’s page shows their rank.</p>
      <ol className="mr-rarest">
        {all.slice(0, 10).map((m, i) => (
          <li key={m.serial}>
            <a
              className="mr-rarest-row"
              href={marinePath(m.serial)}
              onClick={
                onPickMarine &&
                ((e) => {
                  e.preventDefault();
                  onPickMarine(m.serial);
                })
              }
            >
              <span className="mr-rank">{i + 1}</span>
              <span className="mr-callsign">
                {m.callsign} <small>#{serialText(m.serial)}</small>
              </span>
              <span className={`mr-tierword mr-c-${m.tier}`}>{m.tier.toUpperCase()}</span>
              <span className="mr-score" aria-hidden="true">
                <i className={`mr-metal-${m.tier}`} style={{ width: `${rarestBarPct(m.score, low, high)}%` }} />
              </span>
              <span className="mr-odds">rarer than {rarerThan(m.percentile)}%</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
