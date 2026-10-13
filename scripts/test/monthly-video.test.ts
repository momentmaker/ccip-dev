import { describe, expect, it } from 'vitest';
import { probeProblems } from '../video/browser';

describe('probeProblems', () => {
  it('passes a browser with WebGL2 and an H.264 encoder, and names what another lacks', () => {
    // #given
    const capable = { webgl2: true, renderer: 'SwiftShader', h264: true };
    const incapable = { webgl2: false, renderer: null, h264: false };
    const throwing = { webgl2: true, renderer: null, h264: 'NotSupportedError: unsupported codec' };

    // #when
    const results = [capable, incapable, throwing].map(probeProblems);

    // #then
    expect(results).toEqual([
      [],
      ['WebGL2 is unavailable', 'H.264 (avc1.640028) at 1080×1080 cannot be encoded'],
      ['H.264 (avc1.640028) at 1080×1080 cannot be encoded: NotSupportedError: unsupported codec'],
    ]);
  });
});
