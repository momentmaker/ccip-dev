import { chromium, type Browser, type Page } from 'playwright';

/** Chrome stable (Playwright's own Chromium has no H.264 encoder), headless, with SwiftShader for WebGL on a runner without a GPU. */
export const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome', headless: true, args: CHROME_ARGS });
}

export interface BrowserProbe {
  webgl2: boolean;
  renderer: string | null;
  /** true, false, or the error isConfigSupported threw. */
  h264: boolean | string;
}

/** What the recording needs from the browser, read in `page` (a secure context: WebCodecs needs one). */
export function probePage(page: Page): Promise<BrowserProbe> {
  return page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info') ?? null;
    let h264: boolean | string;
    try {
      h264 =
        typeof VideoEncoder !== 'undefined' &&
        (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1080, bitrate: 8_000_000, framerate: 30 })).supported === true;
    } catch (err) {
      h264 = String(err);
    }
    return { webgl2: gl !== null, renderer: gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null, h264 };
  });
}

export function probeProblems(probe: BrowserProbe): string[] {
  const problems: string[] = [];
  if (!probe.webgl2) problems.push('WebGL2 is unavailable');
  if (probe.h264 !== true) problems.push(`H.264 (avc1.640028) at 1080×1080 cannot be encoded${typeof probe.h264 === 'string' ? `: ${probe.h264}` : ''}`);
  return problems;
}
