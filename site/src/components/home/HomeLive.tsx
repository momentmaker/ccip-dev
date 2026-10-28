import type { DayTotals, LiveMessage, TodayFile } from '@ccip-dev/core/public';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { crossedToday, landedSince, liveAllTime, metricTotal, milestoneGoal, nearestGoal, type AllTimeBase, type AllTimeTotals, type CountedDay, type Landed } from '../../lib/all-time';
import { trackDataError, track } from '../../lib/analytics';
import { heroFees, type FeeHistoryTotals } from '../../lib/fee-revenue';
import { formatCount, formatUsd } from '../../lib/format';
import { LiveScheduler, pruneStale, type Planned } from '../../lib/live-scheduler';
import { publishToday } from '../../lib/live-store';
import { laneLabel } from '../../lib/names';
import { startPoller } from '../../lib/poller';
import { liveRecordBreaks, type DayRecord, type MilestoneMetric } from '../../lib/records';
import { type DaySnapshot, previousDay, rolloverSnapshot, yesterdayFor } from '../../lib/yesterday';
import { SkySound } from '../../lib/sound';
import type { StarPoint } from '../../sky/layout';
import { COMET_MS, GOLD_USD, type Caption } from '../../sky/scene';
import FreshnessNote from '../FreshnessNote';
import { useMotionPreference, useNow } from '../hooks';
import ShareButton from '../ShareButton';
import Celebration from './Celebration';
import Feed, { FEED_SIZE } from './Feed';
import HomeTicker from './HomeTicker';
import Hud from './Hud';
import LanesToday from './LanesToday';
import Milestones, { type LastCrossed, type ReserveGoal } from './Milestones';
import OnWatch from './OnWatch';
import PulseChart from './PulseChart';
import SkyCanvas from './SkyCanvas';
import TodayTiles from './TodayTiles';

export interface HomeLiveProps {
  stars: StarPoint[];
  chainNames: [string, string][];
  chainValues: [string, number][];
  lanes: { src: string; dst: string; usd: number; messages: number }[];
  initialFeed: LiveMessage[];
  liveUpdatedAt: string;
  today: TodayFile;
  recentDays: DayTotals[];
  records: DayRecord[];
  feeTotals: FeeHistoryTotals | null;
  /** Every finalized day, summed. */
  base: AllTimeBase;
  since: string | null;
  paces: Record<MilestoneMetric, number | null>;
  /** The last 90 finalized days, for the chart. */
  pulse: CountedDay[];
  reserveGoal: ReserveGoal | null;
  lastCrossed: LastCrossed;
  children?: ReactNode;
}

const ANNOUNCE_EVERY_MS = 5_000;
/** The cards' order, value first: it moves fastest and reads biggest. */
const METRICS: readonly MilestoneMetric[] = ['value', 'messages', 'fees'];
const LOG_KEEP = 40;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Totals never step back on screen: a fresh today.json can price a message lower than the sky did. */
function useRatchet(totals: AllTimeTotals): AllTimeTotals {
  const shown = useRef(totals);
  const next = { messages: Math.max(shown.current.messages, totals.messages), usd: Math.max(shown.current.usd, totals.usd), fees: Math.max(shown.current.fees, totals.fees) };
  shown.current = next;
  return next;
}

function ZuluClock() {
  const now = useNow(30_000);
  return <span className="mono">{now ? `${now.toISOString().slice(11, 16)}Z` : 'UTC'}</span>;
}

export default function HomeLive(props: HomeLiveProps) {
  const names = useMemo(() => new Map(props.chainNames), [props.chainNames]);
  const motion = useMotionPreference();
  const reducedMotion = motion === true;
  const [feed, setFeed] = useState<LiveMessage[]>(props.initialFeed);
  const [log, setLog] = useState<LiveMessage[]>(props.initialFeed);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(props.liveUpdatedAt);
  const [today, setToday] = useState(props.today);
  const [rolledOver, setRolledOver] = useState<DaySnapshot | null>(null);
  const [paused, setPaused] = useState({ live: false, today: false });
  const [arrived, setArrived] = useState({ count: 0, usd: 0 });
  const [landed, setLanded] = useState<ReadonlyMap<string, Landed>>(() => new Map());
  const [announcement, setAnnouncement] = useState('');
  const [skyReady, setSkyReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [celebrating, setCelebrating] = useState<{ metric: MilestoneMetric; threshold: number } | null>(null);
  const polledTodayRef = useRef<TodayFile | null>(null);
  const queueRef = useRef<Planned<LiveMessage>[]>([]);
  const schedulerRef = useRef(new LiveScheduler<LiveMessage>());
  const soundRef = useRef<SkySound | null>(null);
  const lastAnnounceRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Where each message was first seen; the first poll's messages are in today.json already, so they map to nothing. */
  const seenInRef = useRef(new Map<string, string>());

  const land = (messages: readonly LiveMessage[]) => {
    const counted = messages.filter((m) => seenInRef.current.has(m.id));
    if (counted.length === 0) return;
    setLanded((prev) => {
      const next = new Map(prev);
      for (const m of counted) next.set(m.id, { seenIn: seenInRef.current.get(m.id)!, usd: m.usd ?? 0 });
      return next;
    });
  };

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
          for (const m of fresh) seenInRef.current.set(m.id, file.updated_at);
          setArrived((a) => ({ count: a.count + fresh.length, usd: a.usd + fresh.reduce((sum, m) => sum + (m.usd ?? 0), 0) }));
          land(feedOnly);
          if (feedOnly.length > 0) setLog((l) => [...feedOnly, ...l].slice(0, LOG_KEEP));
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
        const snapshot = rolloverSnapshot(polledTodayRef.current, file.day);
        if (snapshot) setRolledOver(snapshot);
        polledTodayRef.current = file;
        setToday(file);
        setLanded((prev) => new Map([...prev].filter(([, m]) => m.seenIn > file.updated_at)));
        setPaused((p) => ({ ...p, today: false }));
      },
      onError: () => {
        setPaused((p) => ({ ...p, today: true }));
        trackDataError('today.json');
      },
    });
    const timers = timersRef.current;
    return () => {
      stopLive();
      stopToday();
      timers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    document.title = `${formatCount(today.totals.messages)} today · ccip.dev`;
  }, [today.totals.messages]);

  useEffect(() => {
    publishToday({ messages: today.totals.messages, usd: today.totals.usd_value, fees: today.totals.fee_usd });
  }, [today]);

  const onLaunch = (message: LiveMessage, _caption: Caption | null) => {
    const now = performance.now();
    soundRef.current?.play(message.usd, (message.usd ?? 0) >= GOLD_USD, now, document.hidden);
    setLog((l) => [message, ...l.filter((m) => m.id !== message.id)].slice(0, LOG_KEEP));
    if (reducedMotion) land([message]);
    else timersRef.current.push(setTimeout(() => land([message]), COMET_MS));
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
  const yesterday = yesterdayFor(props.recentDays, today.day) ?? (rolledOver && rolledOver.day === previousDay(today.day) ? rolledOver : null);
  const todayCounts: CountedDay = { day: today.day, messages: today.totals.messages, usd_value: today.totals.usd_value, fee_usd: today.totals.fee_usd };
  const before = liveAllTime(props.base, [yesterday]);
  const allTime = useRatchet(liveAllTime(props.base, [yesterday, todayCounts], landedSince(landed, today.updated_at)));
  const goals = METRICS.map((m) => milestoneGoal(m, metricTotal(allTime, m), props.paces[m]));
  const crossed =
    METRICS.map((m) => {
      const threshold = crossedToday(m, metricTotal(before, m), metricTotal(allTime, m));
      return threshold === null ? null : { metric: m, threshold };
    }).find((c) => c !== null) ?? null;
  const crossedKey = crossed ? `ccip:milestone:${crossed.metric}:${crossed.threshold}` : null;
  const fees = heroFees(props.feeTotals, [yesterday, { day: today.day, fee_usd: today.totals.fee_usd }]);
  const headline = `${formatCount(today.totals.messages)} CCIP messages today`;

  useEffect(() => {
    if (!crossed || !crossedKey) return;
    const storage = safeStorage();
    try {
      if (storage?.getItem(crossedKey)) return;
      storage?.setItem(crossedKey, '1');
    } catch {
      // Storage refused: celebrate anyway, once for this page.
    }
    setCelebrating(crossed);
  }, [crossedKey]);

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
          avoid=".hero-toolbar, .hero-overlay, .ticker, .burst"
          onLaunch={onLaunch}
          onReady={setSkyReady}
        />
        <div className="hero-overlay">
          <Hud today={today} yesterday={yesterday} allTime={allTime} since={props.since} goal={nearestGoal(goals)} crossed={crossed} fees={fees} animate={motion === null ? null : !motion} />
        </div>
        {celebrating && <Celebration metric={celebrating.metric} threshold={celebrating.threshold} since={props.since} reducedMotion={reducedMotion} onClose={() => setCelebrating(null)} />}
        <div className="hero-toolbar">
          <OnWatch count={arrived.count} usd={arrived.usd} />
          <button type="button" className="sound-btn btn-icon" aria-pressed={soundOn} aria-label="Sound" title={soundOn ? 'Sound on' : 'Sound off'} onClick={toggleSound}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              {soundOn ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9.5l5 5M22 9.5l-5 5" />}
            </svg>
          </button>
          <ShareButton view="home" headline={headline} url="https://ccip.dev/" cardUrl="/og/home.png" iconOnly />
        </div>
        <HomeTicker messages={feed.slice(0, FEED_SIZE)} names={names} />
      </section>
      {breaks[0] && (
        <div className="record-banner card" role="status">
          <span>{breaks[0].text}</span>
          <ShareButton view="record" headline={breaks[0].text} url="https://ccip.dev/" cardUrl="/og/home.png" />
        </div>
      )}
      <Milestones goals={goals} reserve={props.reserveGoal} last={props.lastCrossed} crossed={crossed} />
      <section className="band" id="sitrep" aria-labelledby="sitrep-title">
        <div className="band-head">
          <div>
            <p className="eyebrow">
              SITREP · <ZuluClock />
            </p>
            <h2 id="sitrep-title">
              Today, <span className="g">so far</span>.
            </h2>
          </div>
          <a className="more-link" href="/history/30d/">
            Full history →
          </a>
        </div>
        <div className="sitrep">
          <div className="panel">
            <PulseChart days={props.pulse} today={todayCounts} />
            <TodayTiles totals={today.totals} yesterdaySenders={yesterday && 'unique_senders' in yesterday ? (yesterday as DayTotals).unique_senders : null} />
            <LanesToday lanes={today.top.lane} names={names} />
            <FreshnessNote updatedAt={today.updated_at} paused={paused.today} />
          </div>
          <div className="panel comms-panel">
            <div className="panel-head">
              <span className="label">COMMS log · live · UTC</span>
              <a className="more-link" href="/top/lane/7d/">
                Top lanes →
              </a>
            </div>
            <Feed messages={log} names={names} />
            <FreshnessNote updatedAt={liveUpdatedAt} paused={paused.live} />
          </div>
        </div>
      </section>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
