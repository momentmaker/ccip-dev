import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track, trackDataError } from '../lib/analytics';
import { DataError, fetchPublic, pollDelay } from '../lib/data';
import { hasIcon, iconHref } from '../lib/chain-icons';
import { computeMilestones } from '../lib/records';
import { usePrefersReducedMotion } from '../components/hooks';
import { buildLayout } from '../sky/layout';
import { COIN_WAIT_MS, loadCoinImages, settleWithin } from './coin-images';
import { ReplayCompositor } from './compose';
import { canRecord, recordingFilename, recordReplay, totalFrames } from './recorder';
import { REPLAY_COINS, REPLAY_LENGTHS, ReplayModel, type ReplayLength } from './timeline';

export const ASPECTS = ['16:9', '1:1', '9:16'] as const;
export type Aspect = (typeof ASPECTS)[number];
const RATIO: Record<Aspect, number> = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16 };
const MAX_DPR = 2;
const MAX_SIDE_PX = 1920;
const UI_UPDATE_MS = 100;

interface Loaded {
  replay: ReplayFile;
  history: DayTotals[];
}

export default function ReplayPlayer() {
  const reducedMotion = usePrefersReducedMotion();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loadFailuresRef = useRef(0);
  const trackedFilesRef = useRef(new Set<string>());
  const [length, setLength] = useState<ReplayLength>(60);
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(0);
  const [compositor, setCompositor] = useState<ReplayCompositor | null>(null);
  const [coinImages, setCoinImages] = useState<ReadonlyMap<string, CanvasImageSource>>(new Map());
  const coinLoadRef = useRef<Promise<ReadonlyMap<string, CanvasImageSource>> | null>(null);
  const [recordable, setRecordable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<{ progress: number; controller: AbortController } | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const recordAbortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(0);
  const clockRef = useRef({ startedAt: 0, offset: 0 });

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    Promise.all([fetchPublic('replay.json'), fetchPublic('history.json')])
      .then(([replay, history]) => {
        if (cancelled) return;
        loadFailuresRef.current = 0;
        setLoadFailed(false);
        setData({ replay, history: history.days });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        loadFailuresRef.current += 1;
        setLoadFailed(true);
        const file = err instanceof DataError ? err.file : 'replay.json';
        if (!trackedFilesRef.current.has(file)) {
          trackedFilesRef.current.add(file);
          trackDataError(file);
        }
        retryTimer = setTimeout(() => setAttempt((n) => n + 1), pollDelay(loadFailuresRef.current));
      });
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [attempt]);

  const stars = useMemo(() => (data ? buildLayout(data.replay.chains) : []), [data]);

  useEffect(() => {
    if (!data) return;
    let alive = true;
    const coinModel = new ReplayModel(data.replay, data.history, [], stars, REPLAY_LENGTHS[0], { count: REPLAY_COINS, eligible: hasIcon });
    const hrefs = new Map(
      coinModel.coinSelectorsEver().flatMap((selector) => {
        const href = iconHref(selector);
        return href ? [[selector, href] as const] : [];
      }),
    );
    const load = loadCoinImages(hrefs);
    coinLoadRef.current = load;
    void load.then((images) => {
      if (alive) setCoinImages(images);
    });
    return () => {
      alive = false;
    };
  }, [data, stars]);

  const model = useMemo(
    () => (data ? new ReplayModel(data.replay, data.history, computeMilestones(data.history, data.replay.chains), stars, length, { count: REPLAY_COINS, eligible: hasIcon }) : null),
    [data, stars, length],
  );
  const since = data?.replay.since ?? '';
  const lastDay = data?.replay.days.at(-1)?.day ?? '';

  useEffect(() => {
    let alive = true;
    void canRecord(aspect).then((ok) => alive && setRecordable(ok));
    return () => {
      alive = false;
    };
  }, [aspect]);

  useEffect(() => {
    if (!model) return;
    let created: ReplayCompositor;
    try {
      created = new ReplayCompositor(model, stars, since, lastDay, () => document.createElement('canvas'));
    } catch (err) {
      console.warn('Replay compositor failed to start', err);
      setError('Your browser could not start the animation.');
      return;
    }
    tRef.current = reducedMotion ? model.duration - 0.01 : 0;
    setShown(tRef.current);
    setPlaying(false);
    setCompositor(created);
    return () => {
      created.destroy();
      setCompositor(null);
    };
  }, [model, stars, since, lastDay, reducedMotion]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !compositor) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const fit = Math.min(1, MAX_SIDE_PX / (Math.max(canvas.clientWidth, canvas.clientHeight) * dpr || 1));
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr * fit));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr * fit));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    compositor.draw(tRef.current, ctx, width, height);
    canvas.closest('.replay-shell')?.classList.add('ready');
  }, [compositor]);

  useEffect(() => {
    if (!compositor) return;
    compositor.setCoinImages(coinImages);
    drawFrame();
  }, [compositor, coinImages, drawFrame]);

  useEffect(() => {
    if (!model) return;
    if (!playing) {
      drawFrame();
      return;
    }
    let raf = 0;
    let lastUi = 0;
    const tick = (frameTime: number) => {
      const now = Math.min(clockRef.current.offset + (performance.now() - clockRef.current.startedAt) / 1000, model.duration);
      tRef.current = now;
      drawFrame();
      if (now >= model.duration) {
        setShown(now);
        setPlaying(false);
        return;
      }
      if (frameTime - lastUi >= UI_UPDATE_MS) {
        lastUi = frameTime;
        setShown(now);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [model, playing, drawFrame, aspect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => drawFrame());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawFrame, compositor]);

  const play = () => {
    if (!model) return;
    const from = tRef.current >= model.duration ? 0 : tRef.current;
    clockRef.current = { startedAt: performance.now(), offset: from };
    tRef.current = from;
    setShown(from);
    setPlaying(true);
    track('replay_play', { length, aspect });
  };

  const scrub = (value: number) => {
    tRef.current = value;
    clockRef.current = { startedAt: performance.now(), offset: value };
    setShown(value);
    if (!playing) drawFrame();
  };

  useEffect(() => () => recordAbortRef.current?.abort(), []);

  const record = async () => {
    if (!model || recording) return;
    setPlaying(false);
    setRecordError(null);
    const controller = new AbortController();
    recordAbortRef.current = controller;
    setRecording({ progress: 0, controller });
    let recorder: ReplayCompositor | null = null;
    try {
      recorder = new ReplayCompositor(model, stars, since, lastDay, () => new OffscreenCanvas(1, 1));
      const noCoins: ReadonlyMap<string, CanvasImageSource> = new Map();
      recorder.setCoinImages(await settleWithin(coinLoadRef.current ?? Promise.resolve(noCoins), COIN_WAIT_MS, noCoins));
      if (controller.signal.aborted) return;
      const frames = recorder;
      await document.fonts.ready;
      const blob = await recordReplay({
        draw: (frameT, ctx, width, height) => frames.draw(frameT, ctx, width, height),
        aspect,
        lengthS: length,
        onProgress: (progress) => setRecording((r) => (r ? { ...r, progress } : r)),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = recordingFilename(lastDay, aspect);
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 5_000);
      track('replay_record', { length, aspect });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('replay recording failed', err);
        setRecordError('Recording failed — try again or use Chrome');
      }
    } finally {
      recorder?.destroy();
      if (recordAbortRef.current === controller) recordAbortRef.current = null;
      setRecording(null);
    }
  };

  if (error) return <p className="card">{error}</p>;
  if (!data || !model) {
    if (!loadFailed) return null;
    return (
      <div className="replay-note">
        <p className="freshness paused" role="status">
          History is loading slowly — retrying
        </p>
        <button type="button" className="share-btn" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="player">
      <div className="player-stage" style={{ aspectRatio: String(RATIO[aspect]), width: `min(100%, ${80 * RATIO[aspect]}vh)` }}>
        <canvas ref={canvasRef} aria-label={`Time-lapse of CCIP from ${since} to ${lastDay}`} />
      </div>
      <div className="player-controls">
        <button type="button" className="share-btn" onClick={() => (playing ? setPlaying(false) : play())}>
          {playing ? 'Pause' : shown >= model.duration ? 'Replay' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={model.duration}
          step={0.01}
          value={Math.min(shown, model.duration)}
          aria-label="Position"
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <label>
          Length{' '}
          <select value={length} disabled={recording !== null} onChange={(e) => setLength(Number(e.target.value) as ReplayLength)}>
            {REPLAY_LENGTHS.map((l) => <option key={l} value={l}>{l} s</option>)}
          </select>
        </label>
        <label>
          Shape{' '}
          <select value={aspect} disabled={recording !== null} onChange={(e) => setAspect(e.target.value as Aspect)}>
            {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {recordable && !recording && (
          <button type="button" className="share-btn" onClick={() => void record()}>
            Record MP4
          </button>
        )}
        {recording && (
          <span className="recording" role="status">
            Recording {Math.round(recording.progress * 100)}% of {totalFrames(length)} frames{' '}
            <button type="button" className="share-btn" onClick={() => recording.controller.abort()}>
              Cancel
            </button>
          </span>
        )}
        {recordable === false && <span className="muted">Recording works in Chrome, Edge and Safari</span>}
        {recordError && <span className="down">{recordError}</span>}
      </div>
    </div>
  );
}
