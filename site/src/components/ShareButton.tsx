import { useEffect, useId, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { shareText, xIntentUrl } from '../lib/share';

interface Props {
  view: string;
  headline: string;
  url: string;
  cardUrl: string | null;
}

const NOTE_MS = 3000;

export default function ShareButton({ view, headline, url, cardUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const panelId = useId();
  const text = shareText(headline);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  function later(fn: () => void, ms: number) {
    timersRef.current.push(setTimeout(fn, ms));
  }

  function showNote(message: string) {
    setNote(message);
    later(() => setNote(null), NOTE_MS);
  }

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
      later(() => setCopied(false), 1500);
      track('share', { view, channel: 'copy' });
    } catch (err) {
      console.warn('copy link failed', err);
      showNote('Could not copy the link');
    }
  }

  async function onDownload() {
    if (!cardUrl) return;
    try {
      const res = await fetch(cardUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = `ccip-dev-${view.replaceAll('/', '-')}.png`;
      a.click();
      later(() => URL.revokeObjectURL(href), 1000);
      track('card_download', { view });
    } catch (err) {
      console.warn('card download failed', err);
      showNote('Could not download the card — try again');
    }
  }

  return (
    <div className="share" ref={rootRef}>
      <button type="button" className="share-btn" ref={triggerRef} aria-expanded={open} aria-controls={panelId} onClick={onShare}>
        Share
      </button>
      {open && (
        <div className="share-menu" id={panelId}>
          <a href={xIntentUrl(text, url)} target="_blank" rel="noopener" onClick={() => track('share', { view, channel: 'x' })}>
            Post on X
          </a>
          <button type="button" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {cardUrl && (
            <button type="button" onClick={onDownload}>
              Download card
            </button>
          )}
          {note && (
            <p className="share-note" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
