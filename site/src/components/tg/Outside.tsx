import { MINI_APP_LINK } from '@ccip-dev/core/linkmarine';

/** The Mini App opened in a plain browser: it lives in Telegram, so point there. */
export default function Outside() {
  return (
    <section className="tg-body tg-outside" aria-labelledby="tg-outside">
      <p className="tg-eyebrow">ccip.dev · LinkMarines</p>
      <h1 id="tg-outside" className="tg-big">
        LinkMarines lives in Telegram.
      </h1>
      <p className="tg-muted">Enlist, get your dog tag and browse the roster inside Telegram.</p>
      <a className="tg-main" href={MINI_APP_LINK}>
        Open in Telegram
      </a>
    </section>
  );
}
