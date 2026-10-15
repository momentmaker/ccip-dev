import type { MarineSummary } from '@ccip-dev/core/linkmarine';
import type { RosterFile } from '@ccip-dev/core/roster';
import { memeUrl } from '../../lib/marines';
import { callsignParts, chanceText } from '../../lib/tg';

/** The three meme hexes and the callsign under them, `locked` of them in: the draw, and the frame it ends on. */
export function Hexes({ marine, locked }: { marine: MarineSummary | null; locked: number }) {
  const shown = marine ? locked : 0;
  return (
    <>
      <div className="tg-hexes">
        {[0, 1, 2].map((i) => (i < shown ? <div key={i} className="tg-hex" style={{ backgroundImage: `url("${memeUrl(marine!.memes[i]!.file)}")` }} /> : <div key={i} className="tg-hex tg-spin" />))}
      </div>
      <div className="tg-tagrow">
        {[0, 1, 2].map((i) => (
          <span key={i}>{i < shown ? marine!.tags[i] : '· · ·'}</span>
        ))}
      </div>
      <p className="tg-callsign">
        {callsignParts(marine?.tags ?? [], shown).map((part, i) => (
          <span key={i}>
            {i > 0 && '-'}
            {part.locked ? part.text : <span className="tg-dim">{part.text}</span>}
          </span>
        ))}
      </p>
    </>
  );
}

/** Screen 2: the hexes spin until the draw is in, then lock one by one; each tag's memes and per-draw chance follow. */
export default function Draw({ marine, roster, locked, banner }: { marine: MarineSummary | null; roster: RosterFile | null; locked: number; banner: 'rare' | 'legendary' | null }) {
  const chances = new Map(roster?.snapshot.tags.map((t) => [t.tag, t.chance]) ?? []);
  const shown = marine ? locked : 0;
  return (
    <section className="tg-body" aria-live="polite">
      <p className="tg-eyebrow tg-center">Drawing your callsign…</p>
      <Hexes marine={marine} locked={locked} />
      {shown === 3 && banner && (
        <p className="tg-center">
          <span className={`tg-pill tg-pill-${banner}`}>⚠ {banner.toUpperCase()} DRAW</span>
        </p>
      )}
      <p className="tg-muted tg-center tg-odds">
        {marine?.memes.slice(0, shown).map((m) => (
          <span key={m.tag}>
            {m.tag} · {m.count} {m.count === 1 ? 'meme' : 'memes'}
            {chances.has(m.tag) ? ` · ${chanceText(chances.get(m.tag)!)}` : ''}
          </span>
        ))}
      </p>
    </section>
  );
}
