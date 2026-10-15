import type { RosterFile } from '@ccip-dev/core/roster';
import { DISCORD_INSTALL_URL } from '../../config';
import { DISCORD_PATH } from '../../lib/socials';
import { stickerPacks, TELEGRAM_ENLIST_URL } from '../../lib/telegram';

/** Enlist on Discord and on Telegram, side by side. */
export function EnlistButtons() {
  return (
    <div className="mr-actions">
      <a className="mr-btn mr-btn-discord" href="/discord/">
        Enlist on Discord
      </a>
      <a className="mr-btn mr-btn-telegram" href={TELEGRAM_ENLIST_URL}>
        Enlist on Telegram
      </a>
    </div>
  );
}

/** The roster page's closing call to enlist: Discord alone until LinkMarines opens on Telegram, then both and the sticker packs. */
export function EnlistCta({ roster, telegram }: { roster: RosterFile | null; telegram: boolean }) {
  const packs = telegram && roster ? stickerPacks(roster) : [];
  return (
    <section className="mr-cta" aria-labelledby="cta-title">
      <p className="mr-eyebrow">enlist</p>
      <h2 id="cta-title">Your callsign is waiting.</h2>
      {telegram ? (
        <div className="mr-cta-buttons">
          <EnlistButtons />
        </div>
      ) : (
        <a className="mr-add" href={DISCORD_INSTALL_URL}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false">
            <path d={DISCORD_PATH} />
          </svg>
          Add ccip.dev to Discord
        </a>
      )}
      {packs.length > 0 && (
        <p className="mr-packs">
          Every Marine is a sticker:{' '}
          {packs.map((p, i) => (
            <span key={p.volume}>
              {i > 0 && ' · '}
              <a href={p.url}>LinkMarines Vol. {p.volume}</a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
