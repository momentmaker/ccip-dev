import { ContextLossTracker } from '../sky/renderer';
import { CinemaCompositor, type CinemaOptions } from './cinema/compositor';
import type { Tier } from './cinema/quality';
import type { ReplayCompositor } from './compose';
import { Show, type ShowInput } from './director/show';

export type Compositor = ReplayCompositor | CinemaCompositor;
export type CompositorKind = 'cinema' | 'classic';
type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const RECORDING_CINEMA_OPTIONS: Readonly<CinemaOptions> = Object.freeze({ quality: 'high', reducedMotion: false });

export function liveCinemaOptions(reducedMotion: boolean, startQuality: { tier: Tier; decided: boolean }): CinemaOptions {
  return { quality: 'auto', reducedMotion, chrome: false, featherEdge: true, startQuality };
}

export function liveClassicOptions(kind: CompositorKind): { chrome: boolean; preferGl: boolean } {
  return { chrome: false, preferGl: kind !== 'classic' };
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

export class LossPolicy {
  private readonly tracker = new ContextLossTracker();
  private handled: object | null = null;

  onLost(compositor: object, nowMs: number): 'ignore' | 'recreate' | 'fallback' {
    if (this.handled === compositor) return 'ignore';
    this.handled = compositor;
    return this.tracker.record(nowMs) === 'fallback' ? 'fallback' : 'recreate';
  }
}

export function recordingShow(live: Show, input: ShowInput): Show {
  return input.reducedMotion ? new Show({ ...input, reducedMotion: false }) : live;
}

export class RecordingContextLostError extends Error {
  constructor() {
    super('replay recording: the WebGL context was lost');
    this.name = 'RecordingContextLostError';
  }
}

export function recordingDraw(compositor: Compositor): (t: number, ctx: Ctx2d, width: number, height: number) => void {
  return (t, ctx, width, height) => {
    compositor.draw(t, ctx, width, height);
    if (compositor instanceof CinemaCompositor && compositor.lost) throw new RecordingContextLostError();
  };
}

export function recordErrorMessage(err: unknown): string {
  return err instanceof RecordingContextLostError ? 'The graphics context was lost while recording. Try again.' : 'Recording failed — try again or use Chrome';
}
