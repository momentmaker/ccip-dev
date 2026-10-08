import type { ContextLossTracker } from '../sky/renderer';
import { CinemaCompositor, type CinemaOptions } from './cinema/compositor';
import type { Tier } from './cinema/quality';
import type { ReplayCompositor } from './compose';
import { Show, type ShowInput } from './director/show';

export type Compositor = ReplayCompositor | CinemaCompositor;
export type CompositorKind = 'cinema' | 'classic';
type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const RECORDING_CINEMA_OPTIONS: CinemaOptions = { quality: 'high', reducedMotion: false };

export function liveCinemaOptions(reducedMotion: boolean, startTier: Tier): CinemaOptions {
  return { quality: 'auto', reducedMotion, chrome: false, startTier };
}

export function buildCompositor(
  kind: CompositorKind,
  supported: () => boolean,
  make: { cinema: () => CinemaCompositor; classic: () => ReplayCompositor },
): Compositor {
  if (kind === 'cinema' && supported()) {
    try {
      return make.cinema();
    } catch (err) {
      console.warn('cinema compositor failed; using the classic renderer', err);
    }
  }
  return make.classic();
}

export function kindAfterLoss(tracker: ContextLossTracker, nowMs: number): CompositorKind {
  return tracker.record(nowMs) === 'fallback' ? 'classic' : 'cinema';
}

export function recordingShow(live: Show, input: ShowInput): Show {
  return input.reducedMotion ? new Show({ ...input, reducedMotion: false }) : live;
}

export function recordingDraw(compositor: Compositor): (t: number, ctx: Ctx2d, width: number, height: number) => void {
  return (t, ctx, width, height) => {
    compositor.draw(t, ctx, width, height);
    if (compositor instanceof CinemaCompositor && compositor.lost) throw new Error('replay recording: the WebGL context was lost');
  };
}
