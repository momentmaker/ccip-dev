import { rarerThan, serialText } from '@ccip-dev/core/linkmarine';
import { tagBoard, type RosterFile } from '@ccip-dev/core/roster';
import { marineTitle, tierName, webCardUrl } from '../../lib/marines';
import { chanceText } from '../../lib/tg';

function Close({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="tg-close" onClick={onClose} aria-label="Close">
      ✕
    </button>
  );
}

/** A tag's sheet: its memes, its chance per draw, who drew it first and how many carry it. */
export function TagSheet({ roster, tag, onClose }: { roster: RosterFile; tag: string; onClose: () => void }) {
  const t = tagBoard(roster).find((b) => b.tag === tag);
  if (!t) return null;
  return (
    <div className="tg-sheet" role="dialog" aria-label={`The ${tag} tag`}>
      <Close onClose={onClose} />
      <p>
        <b>{t.tag}</b> · {t.count} {t.count === 1 ? 'meme' : 'memes'} · {chanceText(t.chance)} per draw
      </p>
      <p className="tg-muted">
        {t.discoverer
          ? `First discoverer: #${serialText(t.discoverer.serial)} ${t.discoverer.callsign.toUpperCase()} · ${t.carriers} ${t.carriers === 1 ? 'Marine carries' : 'Marines carry'} it`
          : 'Nobody has drawn it yet. Draw it first and you’re its discoverer.'}
      </p>
    </div>
  );
}

/** A Marine's public web card: never their name or photo. */
export function MarineSheet({ roster, serial, onClose }: { roster: RosterFile; serial: number; onClose: () => void }) {
  const m = roster.marines.find((x) => x.serial === serial);
  if (!m) return null;
  return (
    <div className="tg-sheet tg-sheet-card" role="dialog" aria-label={marineTitle(serial)}>
      <Close onClose={onClose} />
      <img className="tg-card" src={webCardUrl(serial)} width={1200} height={675} alt={`The dog tags of ${marineTitle(serial)}, ${m.callsign}`} />
      <p className="tg-cs">
        #{serialText(serial)} {m.callsign.toUpperCase()}
      </p>
      <p className="tg-muted">
        {tierName(m.tier)} · rarer than {rarerThan(m.percentile)}%
      </p>
    </div>
  );
}
