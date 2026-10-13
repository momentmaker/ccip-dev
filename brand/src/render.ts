import { Show } from '../../site/src/replay/director/show';
import { CinemaRenderer } from '../../site/src/replay/cinema/renderer';
import { createSceneBuilder, dustField } from '../../site/src/replay/cinema/scene';
import { TIERS } from '../../site/src/replay/cinema/quality';
import { buildLayout } from '../../site/src/sky/layout';
import replay from './replay.json';
import history from './history.json';

const stars = buildLayout(replay.chains as never);
const show = new Show({ replay: replay as never, history: (history as { days: never[] }).days, stars, length: 30, focus: null, eligible: () => true });
const fullExtent = Math.max(1e-6, ...stars.map((s) => Math.hypot(s.x, s.y)));
const dust = dustField(17, fullExtent);

export function renderSky(t: number, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const renderer = CinemaRenderer.create(canvas as never);
  if (!renderer) throw new Error('WebGL2 unavailable');
  renderer.resize(width, height);
  const scene = createSceneBuilder()(show.frameAt(t), {
    width, height, tier: TIERS.high, dust, fullExtent, atlas: new Map(), titleTargets: [],
    reducedMotion: false, seed: 5, finaleSeconds: show.timing.finale, edgeFeather: 0,
  });
  renderer.render(scene);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d')!.drawImage(canvas, 0, 0);
  return out;
}

(window as unknown as { renderSky: typeof renderSky; showLength: number }).renderSky = renderSky;
(window as unknown as { showLength: number }).showLength = show.length;
