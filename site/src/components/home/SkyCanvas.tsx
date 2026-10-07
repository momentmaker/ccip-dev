import type { LiveMessage } from '@ccip-dev/core/public';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatCount, formatUsd } from '../../lib/format';
import { hasIcon, iconHref } from '../../lib/chain-icons';
import { pruneStale, type Planned } from '../../lib/live-scheduler';
import { chainName, type ChainNames } from '../../lib/names';
import { chainMessages, coinCount, nearestStar } from '../../sky/coins';
import { projector, type StarPoint } from '../../sky/layout';
import { cardPosition, cardSize, skyOverlay, type OverlayCoin, type OverlayPoint, type Rect } from '../../sky/overlay';
import { ContextLossTracker, createRenderer, type SkyRenderer } from '../../sky/renderer';
import { GlRenderer } from '../../sky/renderer-gl';
import { LiveScene, type Caption, type LaunchInput } from '../../sky/scene';
import { skyScale } from '../../sky/weights';

interface Props {
  stars: StarPoint[];
  chainValues: [string, number][];
  lanes: { src: string; dst: string; usd: number; messages: number }[];
  names: ChainNames;
  queue: RefObject<Planned<LiveMessage>[]>;
  reducedMotion: boolean;
  avoid?: string;
  onLaunch: (message: LiveMessage, caption: Caption | null) => void;
  onReady: (ready: boolean) => void;
}

function avoidRects(wrap: HTMLElement, selector: string | undefined): Rect[] {
  if (!selector || !wrap.parentElement) return [];
  const origin = wrap.getBoundingClientRect();
  return [...wrap.parentElement.querySelectorAll(selector)].map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
  });
}

function captionText(m: LaunchInput, names: ChainNames): string {
  return `${formatUsd(m.usd)}${m.token ? ` ${m.token}` : ''} · ${chainName(names, m.src)} → ${chainName(names, m.dst)}`;
}

export default function SkyCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<LiveScene | null>(null);
  const trackerRef = useRef(new ContextLossTracker());
  const latest = useRef(props);
  latest.current = props;
  const [canvasKey, setCanvasKey] = useState(0);
  const [forceFlat, setForceFlat] = useState(false);
  const [labels, setLabels] = useState<{ selector: string; text: string; x: number; y: number; side: 'right' | 'left' }[]>([]);
  const [coins, setCoins] = useState<OverlayCoin[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const pointsRef = useRef<OverlayPoint[]>([]);
  const widthRef = useRef(0);
  const heightRef = useRef(0);
  const brokenRef = useRef(new Set<string>());
  sceneRef.current ??= new LiveScene(props.stars, new Map(props.chainValues), props.lanes);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = wrap.querySelector('canvas')!;
    const scene = sceneRef.current!;
    let renderer: SkyRenderer;
    try {
      renderer = createRenderer(canvas, { preferGl: !forceFlat });
    } catch (err) {
      console.warn('sky renderer failed to start', err);
      if (!forceFlat) {
        setForceFlat(true);
        setCanvasKey((k) => k + 1);
        return;
      }
      console.warn('sky renderer unavailable; showing the static sky', err);
      latest.current.onReady(false);
      return;
    }
    let project = projector(1, 1, scene.starPoints);
    let sizeScale = 1;
    let raf = 0;
    let onScreen = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr));
      renderer.resize(w, h);
      project = projector(w, h, scene.starPoints);
      sizeScale = skyScale(w, h);
      const overlay = skyOverlay(scene.starPoints, new Map(latest.current.chainValues), wrap.clientWidth, wrap.clientHeight, {
        coins: coinCount(wrap.clientWidth),
        labels: wrap.clientWidth < 640 ? 6 : 12,
        avoid: avoidRects(wrap, latest.current.avoid),
        labelWidth: (s) => chainName(latest.current.names, s).length * 7 + 4,
        hasIcon: (s) => hasIcon(s) && !brokenRef.current.has(s),
      });
      pointsRef.current = overlay.points;
      widthRef.current = wrap.clientWidth;
      heightRef.current = wrap.clientHeight;
      setCoins(overlay.coins);
      setLabels(overlay.labels.map((l) => ({ ...l, text: chainName(latest.current.names, l.selector) })));
    };

    const loop = (now: number) => {
      raf = 0;
      if (document.hidden || !onScreen) return;
      const queue = latest.current.queue.current;
      while (queue.length > 0 && queue[0]!.at <= now) {
        const { message } = queue.shift()!;
        const input = { id: message.id, src: message.src, dst: message.dst, usd: message.usd, token: message.token };
        const starsBefore = scene.starPoints.length;
        if (latest.current.reducedMotion) {
          scene.flash(input, now);
          latest.current.onLaunch(message, null);
        } else {
          latest.current.onLaunch(message, scene.launch(input, now, (m) => captionText(m, latest.current.names)));
        }
        if (scene.starPoints.length !== starsBefore) resize();
      }
      renderer.draw(scene.frame(now), project, sizeScale);
      raf = requestAnimationFrame(loop);
    };
    const dropStaleComets = () => {
      const queue = latest.current.queue.current;
      queue.splice(0, queue.length, ...pruneStale(queue, performance.now()));
    };
    const start = () => {
      if (!raf && !document.hidden && onScreen) raf = requestAnimationFrame(loop);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    resize();
    const intersection = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen) dropStaleComets();
      start();
    });
    intersection.observe(wrap);
    const onVisibility = () => {
      if (document.hidden) return;
      dropStaleComets();
      start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onLost = (e: Event) => {
      e.preventDefault();
      if (trackerRef.current.record(performance.now()) === 'fallback') {
        setForceFlat(true);
        setCanvasKey((k) => k + 1);
      }
    };
    const onRestored = () => {
      if (renderer instanceof GlRenderer) renderer.init();
      resize();
      start();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    latest.current.onReady(true);
    start();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.destroy();
    };
  }, [canvasKey, forceFlat]);

  useEffect(() => {
    if (hover === null) return;
    const close = () => setHover(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, { passive: true });
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [hover]);

  const pick = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return nearestStar(pointsRef.current, clientX - rect.left, clientY - rect.top);
  };
  const dropCoin = (selector: string) => {
    brokenRef.current.add(selector);
    setCoins((cs) => cs.filter((c) => c.selector !== selector));
  };
  const hovered = hover === null ? undefined : pointsRef.current.find((p) => p.selector === hover);
  const values = new Map(props.chainValues);
  const shownCoins =
    hovered && hasIcon(hovered.selector) && !brokenRef.current.has(hovered.selector) && !coins.some((c) => c.selector === hovered.selector)
      ? [...coins, { selector: hovered.selector, x: hovered.x, y: hovered.y, d: hovered.d }]
      : coins;

  return (
    <div
      className="sky-wrap"
      ref={wrapRef}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') setHover(pick(e.clientX, e.clientY));
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHover(null);
      }}
      onClick={(e) => {
        if ((e.nativeEvent as PointerEvent).pointerType === 'mouse') return;
        const next = pick(e.clientX, e.clientY);
        setHover((current) => (next === current ? null : next));
      }}
    >
      <canvas key={canvasKey} aria-hidden="true" />
      <div className="sky-coins" aria-hidden="true">
        {shownCoins.map((c) => (
          <img
            key={c.selector}
            src={iconHref(c.selector) ?? undefined}
            alt=""
            width={Math.round(c.d)}
            height={Math.round(c.d)}
            decoding="async"
            style={{ left: c.x, top: c.y }}
            onError={() => dropCoin(c.selector)}
          />
        ))}
      </div>
      <div className="sky-labels" aria-hidden="true">
        {labels.map((l) => (
          <span key={l.selector} className={l.side === 'left' ? 'left' : undefined} style={{ left: l.x, top: l.y }}>
            {l.text}
          </span>
        ))}
      </div>
      {hovered && (
        <div className="sky-card card" aria-hidden="true" style={{ ...cardPosition(hovered, { width: widthRef.current, height: heightRef.current }, cardSize(widthRef.current)), width: cardSize(widthRef.current).width }}>
          {hasIcon(hovered.selector) && !brokenRef.current.has(hovered.selector) && (
            <img src={iconHref(hovered.selector)!} alt="" width={40} height={40} onError={() => dropCoin(hovered.selector)} />
          )}
          <div>
            <strong>{chainName(props.names, hovered.selector)}</strong>
            <span className="muted">
              {formatUsd(values.get(hovered.selector) ?? 0)} moved · {formatCount(chainMessages(props.lanes, hovered.selector))} messages · 30 days
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
