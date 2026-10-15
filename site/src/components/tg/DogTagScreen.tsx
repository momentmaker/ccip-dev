import type { MarineSummary } from '@ccip-dev/core/linkmarine';
import type { CSSProperties } from 'react';
import { marineTitle } from '../../lib/marines';
import { tierBanner } from '../../lib/tg';
import { Hexes } from './Draw';

export interface Tilt {
  x: number;
  y: number;
  streak: number;
}

/**
 * The footnote says your card shows your name and photo, so it waits for a card to show (the draw's last frame stands in while
 * it is stamped) and is dropped when `ownCard` is false: the public web card that stands in then has neither.
 */
export default function DogTagScreen({ marine, cardUrl, ownCard, tilt, onPack, onShare, onRoster }: { marine: MarineSummary; cardUrl: string | null; ownCard: boolean; tilt: Tilt | null; onPack: () => void; onShare: () => void; onRoster: () => void }) {
  const turn = tilt ? ({ '--tilt-x': `${tilt.x}deg`, '--tilt-y': `${tilt.y}deg`, '--streak': `${tilt.streak}%` } as CSSProperties) : undefined;
  return (
    <section className="tg-body" aria-labelledby="tg-dogtag">
      <p className="tg-center">
        <span className={`tg-pill tg-pill-${marine.tier}`}>{tierBanner(marine.tier, marine.percentile)}</span>
      </p>
      {cardUrl ? (
        <div className={`tg-tilt${tilt ? ' tg-tilting' : ''} tg-streak-${marine.tier}`} style={turn}>
          <img className="tg-card" src={cardUrl} width={1200} height={675} alt={`Your dog tags: ${marineTitle(marine.serial)}, ${marine.callsign}`} />
        </div>
      ) : (
        <div className="tg-stamping" aria-busy="true">
          <Hexes marine={marine} locked={3} />
          <p className="tg-muted tg-center">Stamping your dog tag…</p>
        </div>
      )}
      <p id="tg-dogtag" className="tg-callsign tg-small">
        {marineTitle(marine.serial)}
        <br />
        <b>{marine.callsign.toUpperCase()}</b>
      </p>
      <button type="button" className="tg-btn2" onClick={onPack}>
        🎖 Add the LinkMarines sticker pack
      </button>
      <button type="button" className="tg-btn2" onClick={onShare}>
        🔗 Share my page
      </button>
      <button type="button" className="tg-btn2" onClick={onRoster}>
        🪖 See the roster
      </button>
      {ownCard && cardUrl && <p className="tg-muted tg-center">Your card here shows your Telegram name and photo; only you see this version.</p>}
    </section>
  );
}
