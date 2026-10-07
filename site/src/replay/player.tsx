import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [t, setT] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const compositor = useMemo(
    () => (model ? new ReplayCompositor(model, stars, since, lastDay, () => document.createElement('canvas')) : null),
    [model, stars, since, lastDay],
  );
  useEffect(() => () => compositor?.destroy(), [compositor]);

  useEffect(() => {
    if (model && reducedMotion) setT(model.duration - 0.01);
  }, [model, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !compositor || !model) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      let now = t;
      if (playing) {
        now = clockRef.current.offset + (performance.now() - clockRef.current.startedAt) / 1000;
        if (now >= model.duration) {
          now = model.duration;
          setPlaying(false);
        }
        setT(now);
      }
      compositor.draw(now, ctx, width, height);
      if (playing) raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [compositor, model, playing, t, aspect]);

  const play = () => {
    if (!model) return;
    const from = t >= model.duration ? 0 : t;
    clockRef.current = { startedAt: performance.now(), offset: from };
    setT(from);
    setPlaying(true);
    track('replay_play', { length, aspect });
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
          {playing ? 'Pause' : t >= model.duration ? 'Replay' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={model.duration}
          step={0.01}
          value={Math.min(t, model.duration)}
          aria-label="Position"
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
        />
        <label>
          Length{' '}
          <select value={length} onChange={(e) => { setPlaying(false); setT(0); setLength(Number(e.target.value) as ReplayLength); }}>
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
