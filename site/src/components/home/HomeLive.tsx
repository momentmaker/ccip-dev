import type { DayTotals, LiveMessage, TodayFile } from '@ccip-dev/core/public';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { trackDataError, track } from '../../lib/analytics';
import { formatCount, formatUsd } from '../../lib/format';
import { LiveScheduler, pruneStale, type Planned } from '../../lib/live-scheduler';
import { laneLabel } from '../../lib/names';
import { startPoller } from '../../lib/poller';
import { liveRecordBreaks, type DayRecord } from '../../lib/records';
import { SkySound } from '../../lib/sound';
import type { StarPoint } from '../../sky/layout';
import { GOLD_USD, type Caption } from '../../sky/scene';
import FreshnessNote from '../FreshnessNote';
import { usePrefersReducedMotion } from '../hooks';
import ShareButton from '../ShareButton';
import Feed from './Feed';
import Headline from './Headline';
import SkyCanvas from './SkyCanvas';
import TodayTiles from './TodayTiles';

export interface HomeLiveProps {
  stars: StarPoint[];
  chainNames: [string, string][];
  chainValues: [string, number][];
  lanes: { src: string; dst: string; usd: number }[];
  initialFeed: LiveMessage[];
  liveUpdatedAt: string;
  today: TodayFile;
  yesterday: DayTotals | null;
  records: DayRecord[];
  children?: ReactNode;
}

const ANNOUNCE_EVERY_MS = 5_000;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function HomeLive(props: HomeLiveProps) {
  const names = useMemo(() => new Map(props.chainNames), [props.chainNames]);
  const reducedMotion = usePrefersReducedMotion();
  const [feed, setFeed] = useState<LiveMessage[]>(props.initialFeed);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(props.liveUpdatedAt);
  const [today, setToday] = useState(props.today);
  const [paused, setPaused] = useState({ live: false, today: false });
  const [arrived, setArrived] = useState({ count: 0, usd: 0 });
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [skyReady, setSkyReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const queueRef = useRef<Planned<LiveMessage>[]>([]);
  const schedulerRef = useRef(new LiveScheduler<LiveMessage>());
  const soundRef = useRef<SkySound | null>(null);
  const lastAnnounceRef = useRef(0);

  useEffect(() => {
    const sound = new SkySound(safeStorage());
    soundRef.current = sound;
    setSoundOn(sound.enabled);
    if (!sound.enabled) return;
    const resume = () => sound.setEnabled(true);
    window.addEventListener('pointerdown', resume, { once: true });
    return () => window.removeEventListener('pointerdown', resume);
  }, []);

  useEffect(() => {
    let firstIngestDone = false;
    const stopLive = startPoller({
      name: 'live.json',
      onData: (file) => {
        setFeed(file.messages);
        setLiveUpdatedAt(file.updated_at);
        setPaused((p) => ({ ...p, live: false }));
        const now = performance.now();
        const { comets, feedOnly } = schedulerRef.current.ingest(file.messages, now);
        queueRef.current = [...pruneStale(queueRef.current, now), ...comets].sort((a, b) => a.at - b.at);
        if (firstIngestDone) {
          const fresh = [...comets.map((c) => c.message), ...feedOnly];
          setArrived((a) => ({ count: a.count + fresh.length, usd: a.usd + fresh.reduce((sum, m) => sum + (m.usd ?? 0), 0) }));
        }
        firstIngestDone = true;
      },
      onError: () => {
        setPaused((p) => ({ ...p, live: true }));
        trackDataError('live.json');
      },
    });
    const stopToday = startPoller({
      name: 'today.json',
      onData: (file) => {
        setToday(file);
        setPaused((p) => ({ ...p, today: false }));
      },
      onError: () => {
        setPaused((p) => ({ ...p, today: true }));
        trackDataError('today.json');
      },
    });
    return () => {
      stopLive();
      stopToday();
    };
  }, []);

  useEffect(() => {
    document.title = `${formatCount(today.totals.messages)} today · ccip.dev`;
  }, [today.totals.messages]);

  const onLaunch = (message: LiveMessage, caption: Caption | null) => {
    const now = performance.now();
    soundRef.current?.play(message.usd, (message.usd ?? 0) >= GOLD_USD, now, document.hidden);
    if (caption) {
      setCaptions((list) => [...list, caption]);
      setTimeout(() => setCaptions((list) => list.filter((c) => c.id !== caption.id)), 4_000);
    }
    if (now - lastAnnounceRef.current >= ANNOUNCE_EVERY_MS) {
      lastAnnounceRef.current = now;
      setAnnouncement(`${laneLabel(names, `${message.src}>${message.dst}`)}${message.usd ? `, ${formatUsd(message.usd)}` : ''}`);
    }
  };

  const toggleSound = () => {
    const sound = soundRef.current;
    if (!sound) return;
    sound.setEnabled(!sound.enabled);
    setSoundOn(sound.enabled);
    track('sound_toggle', { on: sound.enabled });
  };

  const breaks = liveRecordBreaks(
    { day: today.day, messages: today.totals.messages, usd_value: today.totals.usd_value, unique_senders: today.totals.unique_senders },
    props.records,
  );
  const headline = `${formatCount(today.totals.messages)} CCIP messages today`;

  return (
    <>
      <section className="hero" aria-label="Live CCIP messages">
        <div className={skyReady ? 'sky-fallback hidden' : 'sky-fallback'}>{props.children}</div>
        <SkyCanvas
          stars={props.stars}
          chainValues={props.chainValues}
          lanes={props.lanes}
          names={names}
          queue={queueRef}
          reducedMotion={reducedMotion}
          onLaunch={onLaunch}
          onReady={setSkyReady}
        />
        <div className="captions" aria-hidden="true">
          {captions.map((c) => (
            <p key={c.id} className="caption">
              {c.text}
            </p>
          ))}
        </div>
        <div className="hero-overlay">
          <Headline today={today} yesterday={props.yesterday} animate={!reducedMotion} />
        </div>
        <div className="hero-toolbar">
          <span className="arrived">
            Since you arrived: <span className="mono">{formatCount(arrived.count)}</span> messages · <span className="mono">{formatUsd(arrived.usd)}</span>
          </span>
          <button type="button" className="sound-btn" aria-pressed={soundOn} onClick={toggleSound}>
            {soundOn ? 'Sound on' : 'Sound off'}
          </button>
          <ShareButton view="home" headline={headline} url="https://ccip.dev/" cardUrl="/og/home.png" />
        </div>
      </section>
      {breaks[0] && (
        <div className="record-banner card" role="status">
          <span>{breaks[0].text}</span>
          <ShareButton view="record" headline={breaks[0].text} url="https://ccip.dev/" cardUrl="/og/home.png" />
        </div>
      )}
      <section className="live-grid">
        <div className="card feed-panel">
          <span className="label">Live feed · last 15 minutes</span>
          <Feed messages={feed} names={names} />
          <FreshnessNote updatedAt={liveUpdatedAt} paused={paused.live} />
        </div>
        <div>
          <TodayTiles totals={today.totals} />
          <FreshnessNote updatedAt={today.updated_at} paused={paused.today} />
        </div>
      </section>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
