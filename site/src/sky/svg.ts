import { laneControl } from './geometry';
import { projector, type StarPoint } from './layout';
import { laneOpacity, starRadius, topSelectors } from './weights';

export interface SkySvgOptions {
  width: number;
  height: number;
  stars: readonly StarPoint[];
  chainValues: Map<string, number>;
  lanes: readonly { src: string; dst: string; usd: number }[];
  labels?: Map<string, string>;
  labelCount?: number;
  background?: boolean;
  title?: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function skySvg(o: SkySvgOptions): string {
  const project = projector(o.width, o.height, o.stars);
  const at = new Map(
    o.stars.map((s) => {
      const [x, y] = project(s.x, s.y);
      return [s.selector, { x, y }] as const;
    }),
  );
  const scale = Math.min(o.width, o.height) / 700;
  const maxValue = Math.max(0, ...o.chainValues.values());
  const maxLane = Math.max(0, ...o.lanes.map((l) => l.usd));
  const radius = (selector: string) => starRadius(o.chainValues.get(selector) ?? 0, maxValue) * scale;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.width} ${o.height}" width="${o.width}" height="${o.height}" role="img" aria-label="${escapeXml(o.title ?? 'CCIP chains and lanes')}">`,
    '<defs><radialGradient id="halo"><stop offset="0" stop-color="#4a7ff0" stop-opacity="0.55"/><stop offset="1" stop-color="#4a7ff0" stop-opacity="0"/></radialGradient></defs>',
  ];
  if (o.background) parts.push(`<rect width="${o.width}" height="${o.height}" fill="#0c0f14"/>`);
  for (const lane of o.lanes) {
    const a = at.get(lane.src);
    const b = at.get(lane.dst);
    if (!a || !b) continue;
    const c = laneControl(a, b);
    parts.push(
      `<path d="M${r1(a.x)} ${r1(a.y)}Q${r1(c.x)} ${r1(c.y)} ${r1(b.x)} ${r1(b.y)}" fill="none" stroke="#4a7ff0" stroke-width="1" stroke-opacity="${laneOpacity(lane.usd, maxLane).toFixed(3)}"/>`,
    );
  }
  for (const s of o.stars) {
    const p = at.get(s.selector)!;
    const r = radius(s.selector);
    parts.push(
      `<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r * 4)}" fill="url(#halo)"/><circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(Math.max(r, 1))}" fill="#e8eaed"/>`,
    );
  }
  if (o.labels && o.labelCount) {
    for (const selector of topSelectors(o.chainValues, o.labelCount)) {
      const p = at.get(selector);
      const text = o.labels.get(selector);
      if (!p || !text) continue;
      parts.push(
        `<text x="${r1(p.x + radius(selector) + 6)}" y="${r1(p.y + 4)}" fill="#8892a0" font-family="Inter, sans-serif" font-size="12">${escapeXml(text)}</text>`,
      );
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
