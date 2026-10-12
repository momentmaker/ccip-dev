import { h, type Child, type VNode } from '../h';

export type GlyphName = 'up' | 'down' | 'right' | 'play' | 'star';

const PATHS: Record<GlyphName, string> = {
  up: 'M12 4 21 19H3z',
  down: 'M3 5h18l-9 15z',
  right: 'M3 10.5h13.4l-4.7-4.7 2.1-2.1 8.3 8.3-8.3 8.3-2.1-2.1 4.7-4.7H3z',
  play: 'M6 4 20 12 6 20z',
  star: 'M12 2.5l2.9 6.2 6.8.8-5 4.6 1.4 6.7L12 17.4l-6.1 3.4 1.4-6.7-5-4.6 6.8-.8z',
};

/** The embedded card fonts have none of these characters; card text must never contain them. */
export const MISSING_GLYPHS = /[→▲▼★▶≈]/;

export function glyph(name: GlyphName, size: number, color: string, margin: { left?: number; right?: number } = {}): VNode {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${PATHS[name]}" fill="${color}"/></svg>`;
  return h('img', {
    src: `data:image/svg+xml;base64,${btoa(svg)}`,
    width: size,
    height: size,
    style: { width: size, height: size, flexShrink: 0, marginLeft: margin.left ?? 0, marginRight: margin.right ?? 0 },
  });
}

export function withArrows(text: string, size: number, color: string): Child[] {
  return text.split(' → ').flatMap((part, i): Child[] => (i === 0 ? [part] : [glyph('right', size, color, { left: 8, right: 8 }), part]));
}
