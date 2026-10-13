import { filledPips, marineOdds, serialText } from '@ccip-dev/core/linkmarine';
import { marineTags, rankOf, type RosterFile, type RosterMarine } from '@ccip-dev/core/roster';
import { useEffect, useState } from 'react';
import { enlistedText, marineTitle, marineUrl, memeUrl, pipText, serialFromPath, shareLine, tierName, webCardUrl } from '../../lib/marines';
import { xIntentUrl } from '../../lib/share';
import DogTag from './DogTag';
import { useRoster } from './use-roster';

function CardImage({ marine }: { marine: RosterMarine }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <DogTag marine={marine} big flip={false} />;
  return (
    <img
      className="mr-card"
      src={webCardUrl(marine.serial)}
      alt={`The dog tags of ${marineTitle(marine.serial)}, ${marine.callsign}, ${tierName(marine.tier)}`}
      width={1200}
      height={675}
      onError={() => setBroken(true)}
    />
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="mr-btn"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => setCopied(true));
      }}
    >
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  );
}

function Missing({ label }: { label: string }) {
  return (
    <section className="mr-missing">
      <h1>{label}</h1>
      <a className="mr-add" href="/discord/">
        Enlist yours
      </a>
    </section>
  );
}

/** A Marine's page. `serial` is undefined until the browser has read it from the path, null when the path holds none. */
export function MarinePage({ roster, failed, serial }: { roster: RosterFile | null; failed: boolean; serial: number | null | undefined }) {
  if (serial === null) return <Missing label="No Marine here." />;
  if (serial === undefined || roster === null) {
    return failed ? (
      <p className="mr-state" role="status">
        The roster is out of reach right now. Retrying…
      </p>
    ) : (
      <p className="mr-state" aria-busy="true">
        Loading {serial === undefined ? 'the Marine' : marineTitle(serial)}…
      </p>
    );
  }
  const marine = roster.marines.find((m) => m.serial === serial);
  if (!marine) return <Missing label={`No Marine #${serialText(serial)} yet.`} />;
  const odds = marineOdds(marine.tier, marine.percentile);
  return (
    <article className="mr-profile">
      <CardImage marine={marine} />
      <div className="mr-profile-facts">
        <p className="mr-eyebrow">
          {marineTitle(serial)} · enlisted {enlistedText(marine.enlisted)}
        </p>
        <h1 className="mr-profile-callsign">{marine.callsign}</h1>
        <p className={`mr-profile-tier mr-metal-text-${marine.tier}`}>{marine.tier.toUpperCase()}</p>
        <p className="mr-profile-odds">
          {odds ? `${odds} · ` : ''}rank #{rankOf(roster.marines, serial)} of {roster.marines.length}
        </p>
        <ul className="mr-profile-tags">
          {marineTags(roster, marine).map((t) => (
            <li key={t.tag}>
              <span className="mr-profile-meme" style={{ backgroundImage: `url(${memeUrl(t.file)})` }} aria-hidden="true" />
              <span className="mr-profile-tag">{t.tag}</span>
              <span className="mr-profile-pips" aria-hidden="true">
                {pipText(t.count)}
              </span>
              <span className="visually-hidden">{filledPips(t.count)} of 3 pips</span>
              <span className="mr-profile-note">
                {t.count} {t.count === 1 ? 'meme' : 'memes'} · {t.carriers === 1 ? <span className="mr-c-legendary">only you carry it</span> : `carried by ${t.carriers}`}
                {t.discoverer && (
                  <>
                    {' '}
                    · <span className="mr-hot">discoverer</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        <p className="mr-profile-lore">
          BLOOD {marine.blood} · FAITH {marine.faith}
        </p>
        <div className="mr-actions">
          <a className="mr-btn mr-btn-x" href={xIntentUrl(shareLine(marine), marineUrl(serial))}>
            Share on X
          </a>
          <CopyLink url={marineUrl(serial)} />
          <a className="mr-btn mr-btn-discord" href="/discord/">
            Enlist yours
          </a>
        </div>
      </div>
    </article>
  );
}

export default function MarineView() {
  const { roster, failed } = useRoster();
  const [serial, setSerial] = useState<number | null | undefined>(undefined);
  useEffect(() => setSerial(serialFromPath(window.location.pathname)), []);
  return <MarinePage roster={roster} failed={failed} serial={serial} />;
}
