import type { LiveMessage } from '@ccip-dev/core/public';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatUsd } from '../../lib/format';
import { pruneStale, type Planned } from '../../lib/live-scheduler';
import { chainName, type ChainNames } from '../../lib/names';
import { projector, type StarPoint } from '../../sky/layout';
import { ContextLossTracker, createRenderer, type SkyRenderer } from '../../sky/renderer';
import { GlRenderer } from '../../sky/renderer-gl';
import { LiveScene, type Caption, type LaunchInput } from '../../sky/scene';
import { topSelectors } from '../../sky/weights';

interface Props {
  stars: StarPoint[];
  chainValues: [string, number][];
  lanes: { src: string; dst: string; usd: number }[];
  names: ChainNames;
  queue: RefObject<Planned<LiveMessage>[]>;
  reducedMotion: boolean;
  onLaunch: (message: LiveMessage, caption: Caption | null) => void;
  onReady: (ready: boolean) => void;
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
  const [labels, setLabels] = useState<{ selector: string; text: string; x: number; y: number }[]>([]);
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
      sizeScale = Math.min(w, h) / 700;
      const css = projector(wrap.clientWidth, wrap.clientHeight, scene.starPoints);
      const count = wrap.clientWidth < 640 ? 6 : 12;
      setLabels(
        topSelectors(new Map(latest.current.chainValues), count).flatMap((selector) => {
          const star = scene.starPoints.find((s) => s.selector === selector);
          if (!star) return [];
          const [x, y] = css(star.x, star.y);
          return [{ selector, text: chainName(latest.current.names, selector), x, y }];
        }),
      );
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

  return (
    <div className="sky-wrap" ref={wrapRef}>
      <canvas key={canvasKey} aria-hidden="true" />
      <div className="sky-labels" aria-hidden="true">
        {labels.map((l) => (
          <span key={l.selector} style={{ left: l.x, top: l.y }}>
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
}
