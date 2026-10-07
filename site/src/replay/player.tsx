import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track, trackDataError } from '../lib/analytics';
import { DataError, fetchPublic } from '../lib/data';
import { computeMilestones } from '../lib/records';
import { usePrefersReducedMotion } from '../components/hooks';
import { buildLayout } from '../sky/layout';
import { ReplayCompositor } from './compose';
import { REPLAY_LENGTHS, ReplayModel, type ReplayLength } from './timeline';

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
  const [length, setLength] = useState<ReplayLength>(60);
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(0);
  const [compositor, setCompositor] = useState<ReplayCompositor | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(0);
  const clockRef = useRef({ startedAt: 0, offset: 0 });

  useEffect(() => {
    Promise.all([fetchPublic('replay.json'), fetchPublic('history.json')])
      .then(([replay, history]) => setData({ replay, history: history.days }))
      .catch((err: unknown) => {
        setError('The history could not be loaded. Please try again in a minute.');
        trackDataError(err instanceof DataError ? err.file : 'replay.json');
      });
  }, []);

  const stars = useMemo(() => (data ? buildLayout(data.replay.chains) : []), [data]);
  const model = useMemo(
    () => (data ? new ReplayModel(data.replay, data.history, computeMilestones(data.history, data.replay.chains), stars, length) : null),
    [data, stars, length],
  );
  const since = data?.replay.since ?? '';
  const lastDay = data?.replay.days.at(-1)?.day ?? '';

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
  }, [compositor]);

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

  if (error) return <p className="card">{error}</p>;
  if (!data || !model) return <p className="card muted">Loading the history…</p>;

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
          <select value={length} onChange={(e) => setLength(Number(e.target.value) as ReplayLength)}>
            {REPLAY_LENGTHS.map((l) => <option key={l} value={l}>{l} s</option>)}
          </select>
        </label>
        <label>
          Shape{' '}
          <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
            {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
