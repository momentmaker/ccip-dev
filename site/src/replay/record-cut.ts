import type { StarPoint } from '../sky/layout';
import { CinemaCompositor } from './cinema/compositor';
import { ReplayCompositor, type CompositorAssets } from './compose';
import { buildCompositor, RECORDING_CINEMA_OPTIONS, recordingDraw, recordWithFallback, type Compositor } from './compositors';
import { Show, type ShowInput } from './director/show';
import type { Aspect } from './player';
import { recordReplay } from './recorder';
import { scoreFor } from './score/schedule';
import { renderScore } from './score/synth';
import { loadCanvasFonts } from './story/draw';
import type { ReplayLength } from './timeline';
import type { PcmAudio } from './wav';

export interface CutInputs {
  showInput: ShowInput;
  stars: readonly StarPoint[];
  assets: CompositorAssets;
  coins: () => Promise<ReadonlyMap<string, CanvasImageSource>>;
}

/**
 * Records a cut as the record button does (the cinema renderer, the classic one if WebGL is lost), but without sound, and
 * renders its soundtrack apart: Chrome on Linux cannot encode AAC, so the workflow muxes the two with ffmpeg.
 */
export async function recordCut(inputs: CutInputs, aspect: Aspect, length: ReplayLength, onProgress: (fraction: number) => void): Promise<{ video: Blob; audio: PcmAudio }> {
  const show = new Show({ ...inputs.showInput, length, reducedMotion: false });
  const coins = await inputs.coins();
  await loadCanvasFonts(document.fonts);
  const detached = () => document.createElement('canvas');
  const recorders: Compositor[] = [];
  try {
    const video = await recordWithFallback((kind) => {
      const recorder = buildCompositor(kind, () => CinemaCompositor.isSupported(detached), {
        cinema: () => new CinemaCompositor(show, inputs.stars, inputs.assets, detached, RECORDING_CINEMA_OPTIONS),
        classic: () => new ReplayCompositor(show, inputs.stars, inputs.assets, detached, { preferGl: kind === 'cinema' }),
      });
      recorders.push(recorder);
      recorder.setCoinImages(coins);
      if (recorder instanceof CinemaCompositor) recorder.refreshTitle();
      return recordReplay({ draw: recordingDraw(recorder), aspect, lengthS: length, onProgress, signal: new AbortController().signal, audio: null });
    });
    const buffer = await renderScore(scoreFor(show), show.length);
    return { video, audio: { channels: [buffer.getChannelData(0), buffer.getChannelData(1)], sampleRate: buffer.sampleRate } };
  } finally {
    for (const r of recorders) r.destroy();
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
