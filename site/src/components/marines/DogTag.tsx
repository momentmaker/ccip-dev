import { serialText } from '@ccip-dev/core/linkmarine';
import type { RosterMarine } from '@ccip-dev/core/roster';
import { useState } from 'react';
import { memeUrl } from '../../lib/marines';

/**
 * A Marine's dog tag in its tier's metal: the three tags embossed on the front, and the three memes etched on the back.
 * The back loads its memes only once it is first shown (hover or focus), so the wall stays light. `flip={false}` draws the front alone.
 */
export default function DogTag({ marine, big = false, flip = true }: { marine: RosterMarine; big?: boolean; flip?: boolean }) {
  const [shown, setShown] = useState(false);
  const reveal = () => setShown(true);
  return (
    <div className={`mr-slot mr-${marine.tier}${big ? ' mr-big' : ''}`} onMouseEnter={reveal} onFocus={reveal}>
      <div className="mr-tag">
        <div className={`mr-face mr-front mr-metal-${marine.tier}`}>
          <span className="mr-hole" />
          {marine.tags.map((t) => (
            <span key={t} className="mr-emb">
              {t}
            </span>
          ))}
          <span className="mr-ser">LM {serialText(marine.serial)}</span>
        </div>
        {flip && (
          <div className={`mr-face mr-back mr-metal-${marine.tier}`}>
            <span className="mr-hole" />
            {shown && marine.memes.map((m) => <img key={m.tag} src={memeUrl(m.file)} alt="" width={44} height={50} />)}
          </div>
        )}
      </div>
    </div>
  );
}
