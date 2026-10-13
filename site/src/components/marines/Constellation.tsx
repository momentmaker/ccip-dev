import { constellation, type Planet, type RosterFile } from '@ccip-dev/core/roster';
import { memeUrl, NARROW_FRAME, planetLayout, WIDE_FRAME, type PlanetFrame } from '../../lib/marines';

function Sky({ planets, frame, className, onPickTag }: { planets: Planet[]; frame: PlanetFrame; className: string; onPickTag: (tag: string) => void }) {
  const spots = planetLayout(planets.map((p) => p.carriers), frame);
  return (
    <div className={`mr-stars ${className}`} style={{ height: frame.height }}>
      {spots.map((s, i) => {
        const p = planets[i]!;
        return (
          <button
            key={p.tag}
            type="button"
            className="mr-planet"
            style={{ left: `${(s.x / frame.width) * 100}%`, top: `${((s.y - s.size * 0.56) / frame.height) * 100}%` }}
            onClick={() => onPickTag(p.tag)}
            aria-label={`${p.tag}, carried by ${p.carriers}: show them on the wall`}
          >
            <span className={`mr-planet-hex${p.oneMeme ? ' mr-glow-gold' : ''}`} style={{ width: s.size, height: s.size * 1.12, backgroundImage: `url(${memeUrl(p.meme)})` }} />
            <span className="mr-planet-label" aria-hidden="true">
              {p.tag} <small>×{p.carriers}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The most-carried tags as hexagon planets; a wide sky above 900 px, a narrow one of twelve below. */
export default function Constellation({ roster, onPickTag }: { roster: RosterFile; onPickTag: (tag: string) => void }) {
  const planets = constellation(roster);
  if (planets.length === 0) return null;
  return (
    <section className="mr-section" aria-labelledby="stars-title">
      <p className="mr-eyebrow">tags in the corps</p>
      <h2 id="stars-title">The meme constellation.</h2>
      <p className="mr-lead">Each drawn tag is a planet, sized by how many Marines carry it. Click one to see the Marines who wear it.</p>
      <Sky planets={planets} frame={WIDE_FRAME} className="mr-stars-wide" onPickTag={onPickTag} />
      <Sky planets={planets.slice(0, 12)} frame={NARROW_FRAME} className="mr-stars-narrow" onPickTag={onPickTag} />
    </section>
  );
}
