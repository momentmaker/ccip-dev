import type { CometKind, SkyFrame } from './frame';
import { appendStar, type StarPoint } from './layout';
import { laneOpacity, starRadius } from './weights';

export const COMET_MS = 2_400;
export const MAX_COMETS = 400;
export const GOLD_USD = 1_000_000;
export const LIVE_LANE_DIM = 0.35;
export const RING_MS = 1_500;
export const CAPTION_MS = 4_000;
export const FLASH_MS = 900;
export const ARRIVAL_RING_MS = 700;
export const ARRIVAL_REACH = 16;
export const ARRIVAL_FRESH_MS = 500;

export interface Arrival {
  star: number;
  selector: string;
  kind: CometKind;
}

export function cometSize(usd: number | null): number {
  return Math.min(1, Math.max(0.15, Math.log10((usd ?? 0) + 1) / 7));
}

export function cometKind(usd: number | null, token: string | null): CometKind {
  if ((usd ?? 0) >= GOLD_USD) return 'gold';
  return (usd ?? 0) > 0 || token !== null ? 'token' : 'data';
}

export interface LaunchInput {
  id: string;
  src: string;
  dst: string;
  usd: number | null;
  token: string | null;
}

export interface Caption {
  id: string;
  text: string;
  until: number;
}

interface LiveComet {
  from: number;
  to: number;
  start: number;
  size: number;
  kind: CometKind;
}

interface LiveRing {
  star: number;
  start: number;
  ms: number;
  kind?: CometKind;
  reach?: number;
}

export class LiveScene {
  private stars: StarPoint[];
  private readonly radii: number[];
  private readonly brightness: number[];
  private readonly index = new Map<string, number>();
  private readonly lanes: SkyFrame['lanes'];
  private comets: LiveComet[] = [];
  private rings: LiveRing[] = [];
  private arrivals: Arrival[] = [];
  private readonly flashes = new Map<number, number>();
  captions: Caption[] = [];

  constructor(stars: StarPoint[], chainValues: Map<string, number>, lanes: readonly { src: string; dst: string; usd: number }[]) {
    this.stars = stars;
    const max = Math.max(0, ...chainValues.values());
    this.radii = stars.map((s) => starRadius(chainValues.get(s.selector) ?? 0, max));
    this.brightness = stars.map((s) => (max > 0 ? 0.5 + 0.5 * Math.sqrt((chainValues.get(s.selector) ?? 0) / max) : 0.6));
    stars.forEach((s, i) => this.index.set(s.selector, i));
    const maxLane = Math.max(0, ...lanes.map((l) => l.usd));
    this.lanes = lanes.flatMap((l) => {
      const from = this.index.get(l.src);
      const to = this.index.get(l.dst);
      return from === undefined || to === undefined ? [] : [{ from, to, opacity: laneOpacity(l.usd, maxLane) * LIVE_LANE_DIM }];
    });
  }

  get starPoints(): readonly StarPoint[] {
    return this.stars;
  }

  starIndex(selector: string): number {
    const known = this.index.get(selector);
    if (known !== undefined) return known;
    this.stars = appendStar(this.stars, selector);
    const i = this.stars.length - 1;
    this.index.set(selector, i);
    this.radii.push(2);
    this.brightness.push(0.6);
    return i;
  }

  launch(m: LaunchInput, now: number, captionText: (m: LaunchInput) => string): Caption | null {
    const from = this.starIndex(m.src);
    const to = this.starIndex(m.dst);
    const kind = cometKind(m.usd, m.token);
    this.comets.push({ from, to, start: now, size: cometSize(m.usd), kind });
    if (this.comets.length > MAX_COMETS) this.comets.splice(0, this.comets.length - MAX_COMETS);
    if (kind !== 'gold') return null;
    this.rings.push({ star: to, start: now + COMET_MS, ms: RING_MS });
    const caption = { id: m.id, text: captionText(m), until: now + CAPTION_MS };
    this.captions.push(caption);
    return caption;
  }

  flash(m: LaunchInput, now: number): void {
    this.flashes.set(this.starIndex(m.src), now);
    this.flashes.set(this.starIndex(m.dst), now);
  }

  takeArrivals(): Arrival[] {
    return this.arrivals.splice(0);
  }

  private land(c: LiveComet, now: number): void {
    const at = c.start + COMET_MS;
    if (now - at > ARRIVAL_FRESH_MS) return;
    this.flashes.set(c.to, at);
    if (c.kind !== 'gold') this.rings.push({ star: c.to, start: at, ms: ARRIVAL_RING_MS, kind: c.kind, reach: ARRIVAL_REACH });
    this.arrivals.push({ star: c.to, selector: this.stars[c.to]!.selector, kind: c.kind });
  }

  frame(now: number): SkyFrame {
    for (const c of this.comets) if (now - c.start >= COMET_MS) this.land(c, now);
    this.comets = this.comets.filter((c) => now - c.start < COMET_MS);
    this.rings = this.rings.filter((r) => now - r.start < r.ms);
    this.captions = this.captions.filter((c) => c.until > now);
    for (const [star, t] of this.flashes) if (now - t >= FLASH_MS) this.flashes.delete(star);
    return {
      stars: this.stars.map((s, i) => {
        const t = this.flashes.get(i);
        return { x: s.x, y: s.y, radius: this.radii[i]!, brightness: this.brightness[i]!, flash: t === undefined ? 0 : Math.max(0, 1 - (now - t) / FLASH_MS) };
      }),
      lanes: this.lanes,
      comets: this.comets
        .filter((c) => c.start <= now)
        .map((c) => ({ from: c.from, to: c.to, progress: (now - c.start) / COMET_MS, size: c.size, kind: c.kind })),
      rings: this.rings
        .filter((r) => r.start <= now)
        .map((r) => ({ star: r.star, progress: (now - r.start) / r.ms, ...(r.kind && { kind: r.kind, reach: r.reach }) })),
    };
  }
}
