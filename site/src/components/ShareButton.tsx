import { useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { shareText, xIntentUrl } from '../lib/share';

interface Props {
  view: string;
  headline: string;
  url: string;
  cardUrl: string | null;
}

export default function ShareButton({ view, headline, url, cardUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const text = shareText(headline);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function onShare() {
    if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ url, text });
        track('share', { view, channel: 'native' });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setOpen(true);
      }
      return;
    }
    setOpen((o) => !o);
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      track('share', { view, channel: 'copy' });
    } catch (err) {
      console.warn('copy link failed', err);
    }
  }

  async function onDownload() {
    if (!cardUrl) return;
    const res = await fetch(cardUrl);
    if (!res.ok) {
      console.warn(`card download failed: HTTP ${res.status}`);
      return;
    }
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = `ccip-dev-${view.replaceAll('/', '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    track('card_download', { view });
  }

  return (
    <div className="share" ref={rootRef}>
      <button type="button" className="share-btn" aria-haspopup="menu" aria-expanded={open} onClick={onShare}>
        Share
      </button>
      {open && (
        <div className="share-menu" role="menu">
          <a role="menuitem" href={xIntentUrl(text, url)} target="_blank" rel="noopener" onClick={() => track('share', { view, channel: 'x' })}>
            Post on X
          </a>
          <button role="menuitem" type="button" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {cardUrl && (
            <button role="menuitem" type="button" onClick={onDownload}>
              Download card
            </button>
          )}
        </div>
      )}
    </div>
  );
}
