import { serialText } from '@ccip-dev/core/linkmarine';
import { callsignsPerTag, census, tagBoard, type BoardTag, type RosterFile, type TierCount } from '@ccip-dev/core/roster';
import { useState } from 'react';

function TierBar({ tier, count, sharePct, expectedPct }: TierCount) {
  return (
    <div className="mr-bar">
      <span className={`mr-c-${tier}`}>{tier.toUpperCase()}</span>
      <span className="mr-track" aria-hidden="true">
        <span className={`mr-fill mr-metal-${tier}`} style={{ width: `${sharePct}%` }} />
        <span className="mr-expected" style={{ left: `${expectedPct}%` }} />
      </span>
      <span className="mr-n">
        {count} · {Math.round(sharePct)}% <small>/ {expectedPct}</small>
      </span>
    </div>
  );
}

function BoardTip({ tag: t, x, y }: { tag: BoardTag; x: number; y: number }) {
  return (
    <div className="mr-tip" style={{ left: x + 14, top: y + 14 }} aria-hidden="true">
      <b>{t.tag}</b>
      <br />
      {t.count} {t.count === 1 ? 'meme' : 'memes'} · about 1 in {callsignsPerTag(t.chance).toLocaleString('en-US')} callsigns
      <br />
      {t.discoverer ? (
        <>
          first drawn by <span className="mr-tip-gold">#{serialText(t.discoverer.serial)} {t.discoverer.callsign}</span>
          <br />
          carried by {t.carriers} {t.carriers === 1 ? 'Marine' : 'Marines'}
        </>
      ) : (
        <span className="mr-tip-hot">UNDRAWN · nobody carries it yet</span>
      )}
    </div>
  );
}

/** The tier bars against the odds, and the board of every tag: a mouse enhancement, its facts also reachable by the wall's search. */
export default function Census({ roster, onPickTag }: { roster: RosterFile; onPickTag: (tag: string) => void }) {
  const [tip, setTip] = useState<{ tag: BoardTag; x: number; y: number } | null>(null);
  const board = tagBoard(roster);
  const drawn = board.filter((t) => t.discoverer !== null).length;
  return (
    <section className="mr-section" aria-labelledby="census-title">
      <p className="mr-eyebrow">census</p>
      <h2 id="census-title">How the draws are landing.</h2>
      <div className="mr-census">
        <div>
          {census(roster.marines).map((t) => (
            <TierBar key={t.tier} {...t} />
          ))}
          <p className="mr-note">The bar is how many Marines drew the tier. The white tick is the odds.</p>
        </div>
        <div>
          <p className="mr-label">
            TAGS DRAWN · {drawn} OF {board.length}
          </p>
          <div className="mr-board" aria-hidden="true" onMouseLeave={() => setTip(null)}>
            {board.map((t) => (
              <i
                key={t.tag}
                className={`mr-hex${t.discoverer ? ' mr-on' : ''}${t.count === 1 ? ' mr-one' : ''}`}
                onMouseMove={(e) => setTip({ tag: t, x: e.clientX, y: e.clientY })}
                onClick={t.discoverer ? () => onPickTag(t.tag) : undefined}
              />
            ))}
          </div>
          {tip && <BoardTip {...tip} />}
          <p className="mr-note">Every hexagon is one of the {board.length} tags, commonest first. Lit ones have been drawn; gold ones exist in only one meme. Hover one to see who drew it first.</p>
        </div>
      </div>
    </section>
  );
}
