import { rarerThan, serialText } from '@ccip-dev/core/linkmarine';
import { ALL_MARINES, mostWanted, wallMarines, type RosterFile } from '@ccip-dev/core/roster';
import { useState } from 'react';
import { memeUrl, tierName } from '../../lib/marines';
import Constellation from '../marines/Constellation';
import RarestTen from '../marines/RarestTen';
import Ticker from '../marines/Ticker';
import { OpensSoon } from './Welcome';

export type RosterTab = 'wall' | 'constellation' | 'rarest';
const TABS: { id: RosterTab; label: string }[] = [
  { id: 'wall', label: 'Wall' },
  { id: 'constellation', label: 'Constellation' },
  { id: 'rarest', label: 'Rarest' },
];
/** The wall shows this many Marines at a time, newest first. */
export const TG_WALL_PAGE = 40;

/** Screen 4: the site's roster pieces in a phone's column: the tabs, the ticker, the Marines and today's most wanted. */
export default function TgRoster({ roster, tab, now, open, onTab, onPickTag, onPickMarine }: { roster: RosterFile; tab: RosterTab; now: Date; open: boolean; onTab: (tab: RosterTab) => void; onPickTag: (tag: string) => void; onPickMarine: (serial: number) => void }) {
  const [shown, setShown] = useState(TG_WALL_PAGE);
  const marines = wallMarines(roster.marines, { ...ALL_MARINES, order: 'newest' });
  return (
    <section className="tg-body tg-roster" aria-label="The roster">
      <div className="tg-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : undefined} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <Ticker roster={roster} />
      {tab === 'wall' && (
        <>
          {marines.length === 0 && <p className="tg-muted">No Marines yet. Be #0001.</p>}
          <ul className="tg-marines">
            {marines.slice(0, shown).map((m) => (
              <li key={m.serial}>
                <button type="button" className="tg-marine" onClick={() => onPickMarine(m.serial)}>
                  <span className="tg-sq" style={{ backgroundImage: `url("${memeUrl(m.memes[0].file)}")` }} aria-hidden="true" />
                  <span>
                    <span className="tg-cs">
                      #{serialText(m.serial)} {m.callsign.toUpperCase()}
                    </span>
                    <span className="tg-muted">
                      {tierName(m.tier)} · rarer than {rarerThan(m.percentile)}%
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {marines.length > shown && (
            <button type="button" className="tg-btn2" onClick={() => setShown(shown + TG_WALL_PAGE)}>
              Show more
            </button>
          )}
        </>
      )}
      {tab === 'constellation' && <Constellation roster={roster} onPickTag={onPickTag} />}
      {tab === 'rarest' && <RarestTen roster={roster} onPickMarine={onPickMarine} />}
      <p className="tg-eyebrow tg-wanted">Today’s most wanted</p>
      <div className="tg-chips">
        {mostWanted(roster, now).map((t) => (
          <button key={t.tag} type="button" className="tg-chip" onClick={() => onPickTag(t.tag)}>
            {t.tag}
          </button>
        ))}
      </div>
      {!open && <OpensSoon />}
    </section>
  );
}
