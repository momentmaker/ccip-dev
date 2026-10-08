import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { track, trackDataError } from '../lib/analytics';
import { DataError, fetchPublic, pollDelay } from '../lib/data';
import { hasIcon, iconHref } from '../lib/chain-icons';
import { chainName, chainNameMap } from '../lib/names';
import { formatUtcDay } from '../lib/format';
import { barVisible, BAR_IDLE_MS, formatClock, pickableChains } from '../lib/controls';
import { replayHead } from '../lib/replay-head';
import { preferPlaybackSession } from '../lib/sound';
import ChainPicker from '../components/controls/ChainPicker';
import RecordPill from '../components/controls/RecordPill';
import Scrubber from '../components/controls/Scrubber';
import Segmented from '../components/controls/Segmented';
import ShapePicker from '../components/controls/ShapePicker';
import ShareButton from '../components/ShareButton';
import { usePrefersReducedMotion } from '../components/hooks';
import { trailingWeights } from '../sky/weights';
import { buildLayout } from '../sky/layout';
import { CinemaCompositor } from './cinema/compositor';
import type { Tier } from './cinema/quality';
import { COIN_WAIT_MS, loadCoinImages, settleWithin } from './coin-images';
import { ReplayCompositor } from './compose';
import {
  buildCompositor,
  liveCinemaOptions,
  liveClassicOptions,
  LossPolicy,
  RECORDING_CINEMA_OPTIONS,
  recordErrorMessage,
  recordingDraw,
  recordingShow,
  recordWithFallback,
  shouldSample,
  type Compositor,
  type CompositorKind,
} from './compositors';
import { audioCodecAvailable, canRecord, raceAbort, recordingFilename, recordReplay, recordWithAudioFallback } from './recorder';
import { scoreFor } from './score/schedule';
import { renderScore } from './score/synth';
import { audioStartOffset, fade, idlePrefetchAllowed, resyncAfter, ScoreCache, scoreKey, scrubRestartDelay, soundPending, suspendWhenIdle, syncAction } from './score/sync';
import { Show, type ShowInput } from './director/show';
import { loadCanvasFonts } from './story/draw';
import { REPLAY_LENGTHS, type ReplayLength } from './timeline';

export const ASPECTS = ['16:9', '1:1', '9:16'] as const;
export type Aspect = (typeof ASPECTS)[number];
const RATIO: Record<Aspect, number> = { '16:9': 16 / 9, '1:1': 1, '9:16': 9 / 16 };
const MAX_DPR = 2;
const MAX_SIDE_PX = 1920;
const UI_UPDATE_MS = 100;
const SILENT_RECORDING_NOTE = "Recorded without sound — your browser can't encode audio";
const PREFETCH_DEBOUNCE_MS = 400;
const PREFETCH_IDLE_TIMEOUT_MS = 2_000;
const SCRUB_RESTART_MS = 100;
const SUSPEND_AFTER_MS = 50;

type AudioIntent = { playing: boolean; soundOn: boolean; t: number; scrubbed: boolean };

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(task, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 0);
  return () => clearTimeout(timer);
}

function prefetchEnvironment(audioSupported: boolean): { audioSupported: boolean; saveData?: boolean; deviceMemory?: number } {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  return { audioSupported, saveData: nav.connection?.saveData, deviceMemory: nav.deviceMemory };
}

function paint(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, compositor: Compositor, t: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const fit = Math.min(1, MAX_SIDE_PX / (Math.max(canvas.clientWidth, canvas.clientHeight) * dpr || 1));
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr * fit));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr * fit));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  compositor.draw(t, ctx, width, height);
  canvas.closest('.replay-shell')?.classList.add('ready');
}

interface Loaded {
  replay: ReplayFile;
  history: DayTotals[];
}

export default function ReplayPlayer({ focus: initialFocus, slugs }: { focus: string | null; slugs: Record<string, string> }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loadFailuresRef = useRef(0);
  const trackedFilesRef = useRef(new Set<string>());
  const [length, setLength] = useState<ReplayLength>(30);
  const [aspect, setAspect] = useState<Aspect>(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? '1:1' : '16:9'));
  const [focus, setFocus] = useState<string | null>(initialFocus);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [activity, setActivity] = useState({ lastMs: 0, nowMs: 0 });
  const lastPointerRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(0);
  const [compositor, setCompositor] = useState<Compositor | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const [kind, setKind] = useState<CompositorKind>('cinema');
  const [compositorKey, setCompositorKey] = useState(0);
  const lossPolicyRef = useRef(new LossPolicy());
  const qualityRef = useRef<{ tier: Tier; decided: boolean }>({ tier: 'high', decided: false });
  const reducedMotion = usePrefersReducedMotion();
  const [coinImages, setCoinImages] = useState<ReadonlyMap<string, CanvasImageSource>>(new Map());
  const coinLoadRef = useRef<Promise<ReadonlyMap<string, CanvasImageSource>> | null>(null);
  const [recordable, setRecordable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<{ progress: number; controller: AbortController } | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordNote, setRecordNote] = useState('');
  const [soundNote, setSoundNote] = useState<string | null>(null);
  const recordAbortRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(0);
  const clockRef = useRef({ startedAt: 0, offset: 0 });
  const audioSupported = typeof AudioContext !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
  const [soundOn, setSoundOn] = useState(false);
  const [soundFailed, setSoundFailed] = useState(false);
  const soundAvailable = audioSupported && !soundFailed;
  const [prefetchAllowed] = useState(() => idlePrefetchAllowed(prefetchEnvironment(audioSupported)));
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [sourceLive, setSourceLive] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<{ node: AudioBufferSourceNode; gain: GainNode } | null>(null);
  const audioStateRef = useRef({ playing: false, soundOn: false, t: 0 });
  const audioTokenRef = useRef(0);
  const audioWantedRef = useRef(false);
  const interruptedRef = useRef(false);
  const applyAudioRef = useRef<(next: AudioIntent) => void>(() => {});
  const failSoundRef = useRef<(err: unknown) => void>(() => {});
  const scrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrubRestartRef = useRef(-Infinity);
  const [scoreCache] = useState(() => new ScoreCache((err) => failSoundRef.current(err)));

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
    const hrefs = new Map(
      data.replay.chains.flatMap((c) => {
        const href = iconHref(c.selector);
        return href ? [[c.selector, href] as const] : [];
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
  }, [data]);

  const names = useMemo(() => (data ? chainNameMap(data.replay.chains) : new Map<string, string>()), [data]);
  const showInput = useMemo<ShowInput | null>(
    () => (data ? { replay: data.replay, history: data.history, stars, length, focus, eligible: hasIcon, reducedMotion } : null),
    [data, stars, length, focus, reducedMotion],
  );
  const show = useMemo(() => (showInput ? new Show(showInput) : null), [showInput]);
  const assets = useMemo(
    () => (show ? { names, ticks: show.yearTicks().map((y) => ({ at: (y.time - show.warp.start) / (show.warp.end - show.warp.start), label: y.label })) } : null),
    [show, names],
  );
  const pickerChains = useMemo(() => {
    if (!data) return [];
    const values = trailingWeights(data.replay, 30).chains;
    return pickableChains(data.replay.chains, slugs)
      .map((c) => ({ selector: c.selector, name: chainName(names, c.selector), value: values.get(c.selector) ?? 0, icon: iconHref(c.selector) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }, [data, names, slugs]);
  const slug = focus ? slugs[focus] ?? null : null;
  const focusName = focus ? chainName(names, focus) : null;
  const pageUrl = `https://ccip.dev/replay/${slug ? `${slug}/` : ''}`;
  const titleFor = (selector: string | null) =>
    selector ? `${chainName(names, selector)} on Chainlink CCIP · Replay · ccip.dev` : 'Replay · ccip.dev';

  const chooseChain = (selector: string | null) => {
    if (selector === focus) return;
    setFocus(selector);
    const nextSlug = selector ? slugs[selector] : null;
    history.pushState({ focus: selector }, '', `/replay/${nextSlug ? `${nextSlug}/` : ''}`);
    document.title = titleFor(selector);
  };
  const titleForRef = useRef(titleFor);
  titleForRef.current = titleFor;
  useEffect(() => {
    const onPop = () => {
      recordAbortRef.current?.abort();
      const match = /^\/replay\/([a-z0-9-]+)\/?$/.exec(location.pathname);
      const selector = match ? Object.keys(slugs).find((s) => slugs[s] === match[1]) ?? null : null;
      setFocus(selector);
      document.title = titleForRef.current(selector);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [slugs]);

  const headSkippedRef = useRef(true);
  useEffect(() => {
    if (!data || !show) return;
    if (headSkippedRef.current) {
      headSkippedRef.current = false;
      return;
    }
    const settled = show.frameAt(show.posterTime()).story;
    const focused = show.focusName !== null;
    const head = replayHead({
      focusName: show.focusName,
      firstDay: data.replay.chains.find((c) => c.selector === show.focus)?.first_day ?? null,
      messages: focused ? settled.messages : data.history.reduce((sum, d) => sum + d.messages, 0),
      chains: focused ? settled.chains : data.replay.chains.length,
    });
    const title = document.getElementById('replay-title');
    const lead = document.getElementById('replay-lead');
    if (title) title.textContent = head.title;
    if (lead) lead.textContent = head.lead;
  }, [data, show]);

  const since = data?.replay.since ?? '';
  const lastDay = data?.replay.days.at(-1)?.day ?? '';

  const scoreBuffer = useCallback(
    (source: Show) => {
      const key = scoreKey(source, lastDay);
      const pending = scoreCache.get(key, () => renderScore(scoreFor(source), source.length));
      void pending.then((buffer) => {
        if (buffer && scoreCache.holds(key)) setReadyKey(key);
      });
      return pending;
    },
    [scoreCache, lastDay],
  );

  const stopAudio = useCallback(() => {
    audioTokenRef.current += 1;
    audioWantedRef.current = false;
    const live = sourceRef.current;
    sourceRef.current = null;
    setSourceLive(false);
    if (live) live.node.stop(fade(live.gain.gain, live.gain.gain.value, 0, live.node.context.currentTime));
    const ctx = audioCtxRef.current;
    if (ctx) suspendWhenIdle(ctx, () => !audioWantedRef.current, SUSPEND_AFTER_MS);
  }, []);

  failSoundRef.current = (err: unknown) => {
    console.warn('replay soundtrack could not be rendered; sound is off', err);
    stopAudio();
    audioStateRef.current = { ...audioStateRef.current, soundOn: false };
    setSoundOn(false);
    setSoundFailed(true);
  };

  const rejoin = useCallback((event: 'visible' | 'running', interrupted: boolean) => {
    if (resyncAfter(event, audioStateRef.current, interrupted)) applyAudioRef.current({ ...audioStateRef.current, t: tRef.current, scrubbed: true });
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') rejoin('visible', false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [rejoin]);

  useEffect(() => {
    if (playing) return;
    audioStateRef.current = { ...audioStateRef.current, playing: false };
    stopAudio();
  }, [playing, stopAudio]);

  useEffect(() => {
    if (!show || !(prefetchAllowed || soundOn)) return;
    let cancelIdle = () => {};
    const timer = setTimeout(() => {
      cancelIdle = whenIdle(() => void scoreBuffer(show));
    }, PREFETCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      cancelIdle();
    };
  }, [show, soundOn, prefetchAllowed, scoreBuffer]);

  useEffect(
    () => () => {
      if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
      stopAudio();
      void audioCtxRef.current?.close();
    },
    [stopAudio],
  );

  useEffect(() => {
    let alive = true;
    void canRecord(aspect).then((ok) => alive && setRecordable(ok));
    return () => {
      alive = false;
    };
  }, [aspect]);

  useEffect(() => {
    if (!show) return;
    tRef.current = show.posterTime();
    setShown(tRef.current);
    setPlaying(false);
  }, [show]);

  useEffect(() => {
    if (!show || !assets) return;
    const makeCanvas = () => document.createElement('canvas');
    let created: Compositor;
    try {
      created = buildCompositor(kind, () => CinemaCompositor.isSupported(makeCanvas), {
        cinema: () => new CinemaCompositor(show, stars, assets, makeCanvas, liveCinemaOptions(reducedMotion, qualityRef.current)),
        classic: () => new ReplayCompositor(show, stars, assets, makeCanvas, liveClassicOptions(kind)),
      });
    } catch (err) {
      console.warn('Replay compositor failed to start', err);
      setError('Your browser could not start the animation.');
      return;
    }
    compositorRef.current = created;
    setCompositor(created);
    return () => {
      if (compositorRef.current === created) compositorRef.current = null;
      created.destroy();
      setCompositor(null);
    };
  }, [show, assets, stars, kind, compositorKey, reducedMotion]);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const current = compositorRef.current;
    if (!canvas || !ctx || !current) return;
    if (current instanceof CinemaCompositor) {
      const action = lossPolicyRef.current.assess(current, performance.now());
      if (action === 'ignore') return;
      if (action !== 'draw') {
        console.warn(`Replay lost its WebGL context; ${action === 'fallback' ? 'falling back to the classic renderer' : 'recreating the renderer'}`);
        if (action === 'fallback') setKind('classic');
        else setCompositorKey((k) => k + 1);
        return;
      }
    }
    paint(canvas, ctx, current, tRef.current);
  }, [compositor]);

  useEffect(() => {
    if (!compositor) return;
    compositor.setCoinImages(coinImages);
    drawFrame();
  }, [compositor, coinImages, drawFrame]);

  useEffect(() => {
    if (!compositor) return;
    let alive = true;
    void loadCanvasFonts(document.fonts).then(() => {
      if (!alive) return;
      if (compositor instanceof CinemaCompositor) compositor.refreshTitle();
      drawFrame();
    });
    return () => {
      alive = false;
    };
  }, [compositor, drawFrame]);

  useEffect(() => {
    if (!show) return;
    if (!playing) {
      drawFrame();
      return;
    }
    let raf = 0;
    let lastUi = 0;
    let lastFrame: number | null = null;
    const tick = (frameTime: number) => {
      const current = compositorRef.current;
      if (lastFrame !== null && current instanceof CinemaCompositor && shouldSample(tRef.current, show.timing.hook)) {
        current.noteFrame(frameTime - lastFrame, frameTime / 1000);
        qualityRef.current = { tier: current.tier, decided: current.qualityDecided };
      }
      lastFrame = frameTime;
      const now = Math.min(clockRef.current.offset + (performance.now() - clockRef.current.startedAt) / 1000, show.length);
      tRef.current = now;
      drawFrame();
      if (now >= show.length) {
        tRef.current = show.posterTime();
        setShown(tRef.current);
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
  }, [show, playing, drawFrame, aspect, compositor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => drawFrame());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawFrame, compositor]);

  const noteActivity = () => {
    const ms = performance.now();
    lastPointerRef.current = ms;
    setActivity({ lastMs: ms, nowMs: ms });
  };
  const onStagePointer = () => {
    if (performance.now() - lastPointerRef.current > 250) noteActivity();
  };

  useEffect(() => {
    if (!playing && recording === null) return;
    const timer = setTimeout(() => setActivity((a) => ({ ...a, nowMs: performance.now() })), BAR_IDLE_MS + 50);
    return () => clearTimeout(timer);
  }, [playing, recording, activity.lastMs]);

  const audioContext = (): AudioContext => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const ctx = new AudioContext();
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running') {
        if (audioWantedRef.current) interruptedRef.current = true;
        return;
      }
      const interrupted = interruptedRef.current;
      interruptedRef.current = false;
      rejoin('running', interrupted);
    });
    audioCtxRef.current = ctx;
    return ctx;
  };

  const startAudio = (current: Show) => {
    let ctx: AudioContext;
    try {
      ctx = audioContext();
    } catch (err) {
      failSoundRef.current(err);
      return;
    }
    audioWantedRef.current = true;
    const key = scoreKey(current, lastDay);
    const token = audioTokenRef.current;
    preferPlaybackSession();
    Promise.all([scoreBuffer(current), ctx.resume()])
      .then(([buffer]) => {
        if (!buffer || token !== audioTokenRef.current || !scoreCache.holds(key)) return;
        const playhead = clockRef.current.offset + (performance.now() - clockRef.current.startedAt) / 1000;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        const gain = ctx.createGain();
        fade(gain.gain, 0, 1, ctx.currentTime);
        node.connect(gain);
        gain.connect(ctx.destination);
        node.start(0, audioStartOffset(playhead, ctx, buffer.duration));
        sourceRef.current = { node, gain };
        setSourceLive(true);
      })
      .catch((err: unknown) => console.warn('replay soundtrack could not start', err));
  };

  const applyAudio = (next: AudioIntent) => {
    const action = syncAction(audioStateRef.current, next);
    audioStateRef.current = { playing: next.playing, soundOn: next.soundOn, t: next.t };
    if (action.kind === 'none') return;
    stopAudio();
    if (action.kind === 'start' && show) startAudio(show);
  };
  applyAudioRef.current = applyAudio;

  const restartAtPlayhead = () => {
    scrubTimerRef.current = null;
    lastScrubRestartRef.current = performance.now();
    applyAudioRef.current({ ...audioStateRef.current, t: tRef.current, scrubbed: true });
  };

  const scrubAudio = () => {
    if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
    const delay = scrubRestartDelay(lastScrubRestartRef.current, performance.now(), SCRUB_RESTART_MS);
    if (delay === 0) restartAtPlayhead();
    else scrubTimerRef.current = setTimeout(restartAtPlayhead, delay);
  };

  const toggleSound = () => {
    const on = !soundOn;
    setSoundOn(on);
    applyAudio({ playing, soundOn: on, t: tRef.current, scrubbed: false });
  };

  const play = () => {
    if (!show) return;
    const from = tRef.current >= show.posterTime() ? 0 : tRef.current;
    clockRef.current = { startedAt: performance.now(), offset: from };
    tRef.current = from;
    setShown(from);
    setPlaying(true);
    applyAudio({ playing: true, soundOn, t: from, scrubbed: false });
    setHasPlayed(true);
    noteActivity();
    track('replay_play', { length, aspect });
  };

  const scrub = (value: number) => {
    tRef.current = value;
    clockRef.current = { startedAt: performance.now(), offset: value };
    setShown(value);
    if (!playing) drawFrame();
    scrubAudio();
  };

  useEffect(() => () => recordAbortRef.current?.abort(), []);

  const record = async () => {
    if (!show || !showInput || !assets || recording) return;
    setPlaying(false);
    setRecordError(null);
    setSoundNote(null);
    setRecordNote('Recording started');
    const controller = new AbortController();
    recordAbortRef.current = controller;
    setRecording({ progress: 0, controller });
    const recorders: Compositor[] = [];
    try {
      const detached = () => document.createElement('canvas');
      const cut = recordingShow(show, showInput);
      const noCoins: ReadonlyMap<string, CanvasImageSource> = new Map();
      const coins = await settleWithin(coinLoadRef.current ?? Promise.resolve(noCoins), COIN_WAIT_MS, noCoins);
      if (controller.signal.aborted) return;
      await loadCanvasFonts(document.fonts);
      const audio = soundAvailable && (await audioCodecAvailable()) ? await raceAbort(scoreBuffer(cut), controller.signal) : null;
      if (controller.signal.aborted) return;
      const { blob, audible } = await recordWithAudioFallback(
        (soundtrack) =>
          recordWithFallback((recorderKind) => {
            const recorder = buildCompositor(recorderKind, () => CinemaCompositor.isSupported(detached), {
              cinema: () => new CinemaCompositor(cut, stars, assets, detached, RECORDING_CINEMA_OPTIONS),
              classic: () => new ReplayCompositor(cut, stars, assets, detached, { preferGl: recorderKind === 'cinema' && kind !== 'classic' }),
            });
            recorders.push(recorder);
            recorder.setCoinImages(coins);
            if (recorder instanceof CinemaCompositor) recorder.refreshTitle();
            return recordReplay({
              draw: recordingDraw(recorder),
              aspect,
              lengthS: length,
              onProgress: (progress) => setRecording((r) => (r ? { ...r, progress } : r)),
              signal: controller.signal,
              audio: soundtrack,
            });
          }),
        audio,
      );
      if (controller.signal.aborted) return;
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = recordingFilename(lastDay, aspect, slug);
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 5_000);
      track('replay_record', { length, aspect });
      setRecordNote('Recording finished');
      if (!audible) setSoundNote(SILENT_RECORDING_NOTE);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('replay recording failed', err);
        setRecordNote('');
        setRecordError(recordErrorMessage(err));
      }
    } finally {
      if (controller.signal.aborted) setRecordNote('Recording cancelled');
      for (const r of recorders) r.destroy();
      if (recordAbortRef.current === controller) recordAbortRef.current = null;
      setRecording(null);
    }
  };

  const soundBusy = soundPending({ soundOn, playing, ready: show !== null && readyKey === scoreKey(show, lastDay), live: sourceLive });

  if (error) return <p className="card">{error}</p>;
  if (!data || !show) {
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
      <div
        className={`player-stage${barVisible({ playing, recording: recording !== null, lastActivityMs: activity.lastMs, nowMs: activity.nowMs }) ? '' : ' idle'}`}
        onPointerMove={onStagePointer}
        onPointerDown={onStagePointer}
        style={{ aspectRatio: String(RATIO[aspect]), width: `min(100%, ${80 * RATIO[aspect]}vh)` }}
      >
        <canvas ref={canvasRef} aria-label={`Time-lapse of CCIP ${focusName ? `for ${focusName} ` : ''}from ${since} to ${lastDay}`} />
        {!hasPlayed && !playing && (
          <button type="button" className="bigplay" aria-label="Play the replay" disabled={recording !== null} onClick={play}>
            <span className="tri" aria-hidden="true" />
          </button>
        )}
        {recording && (
          <span className="rec-badge" aria-hidden="true">
            <span className="rec-dot" />
            REC 1080p · {aspect}
          </span>
        )}
        <div className="player-bar">
          <button type="button" className="icon-btn" aria-label={playing ? 'Pause' : hasPlayed && shown >= show.posterTime() ? 'Replay' : 'Play'} disabled={recording !== null} onClick={() => (playing ? setPlaying(false) : play())}>
            {playing ? <span className="pause-i" aria-hidden="true" /> : <span className="tri" aria-hidden="true" />}
          </button>
          <Scrubber
            length={show.length}
            time={shown}
            onScrub={scrub}
            marks={show.milestoneMarks().map((m) => ({ ...m, day: formatUtcDay(m.day) }))}
            ticks={show.yearTicks()}
            valueText={formatUtcDay(show.frameAt(shown).story.day)}
            disabled={recording !== null}
          />
          <span className="player-time">
            {formatClock(shown)} / {formatClock(show.length)}
          </span>
          {soundAvailable && (
            <button
              type="button"
              className="icon-btn sound-toggle"
              aria-pressed={soundOn}
              aria-busy={soundBusy}
              aria-label="Sound"
              title={soundOn ? 'Sound on' : 'Sound off'}
              disabled={recording !== null}
              onClick={toggleSound}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
                {soundOn ? <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.4" fill="none" /> : <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.4" />}
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="studio">
        <ChainPicker chains={pickerChains} value={focus} onChange={chooseChain} disabled={recording !== null} />
        <Segmented
          label="Length"
          value={length}
          onChange={(l) => setLength(l)}
          disabled={recording !== null}
          options={REPLAY_LENGTHS.map((l) => ({ value: l, label: `${l}s` }))}
        />
        <ShapePicker value={aspect} onChange={setAspect} disabled={recording !== null} />
        <span className="spacer" />
        <ShareButton
          view={slug ? `replay/${slug}` : 'replay'}
          headline={focusName ? `Watch ${focusName} on Chainlink CCIP` : 'Watch CCIP grow from the first message to today'}
          url={pageUrl}
          cardUrl={`/og/replay${slug ? `/${slug}` : ''}.png`}
          disabled={recording !== null}
        />
        {recordable && !recording && (
          <button type="button" className="btn btn-primary" onClick={() => void record()}>
            <span className="rec-dot" aria-hidden="true" />
            Record video
          </button>
        )}
        {recording && <RecordPill progress={recording.progress} onCancel={() => recording.controller.abort()} />}
        <span className="visually-hidden" role="status">
          {recordNote}
        </span>
        {recordable === false && <span className="muted">Recording works in Chrome, Edge and Safari</span>}
        {soundNote && <span className="muted">{soundNote}</span>}
        {recordError && <span className="down">{recordError}</span>}
      </div>
    </div>
  );
}
