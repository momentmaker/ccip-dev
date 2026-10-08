import type { Aspect } from './player';
import { REPLAY_FPS } from './timeline';

export const RECORD_BITRATE = 8_000_000;
export const AVC_CODEC = 'avc1.640028';
export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
};

export function totalFrames(lengthS: number): number {
  return REPLAY_FPS * lengthS;
}

export function recordingFilename(lastDay: string, aspect: Aspect, slug: string | null = null): string {
  return `ccip-replay-${slug ? `${slug}-` : ''}${lastDay}-${aspect.replace(':', 'x')}.mp4`;
}

export async function canRecord(aspect: Aspect): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: AVC_CODEC,
      ...ASPECT_SIZE[aspect],
      framerate: REPLAY_FPS,
      bitrate: RECORD_BITRATE,
    });
    return supported === true;
  } catch {
    return false;
  }
}

export interface RecordOptions {
  draw: (t: number, ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) => void;
  aspect: Aspect;
  lengthS: number;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
  audio?: AudioBuffer | null;
}

export const AUDIO_BITRATE = 128_000;

export async function audioCodecAvailable(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const { getFirstEncodableAudioCodec } = await import('mediabunny');
    return (await getFirstEncodableAudioCodec(['aac'], { numberOfChannels: 2, sampleRate: 48_000 })) === 'aac';
  } catch (err) {
    console.warn('recording: probing the AAC encoder failed; recording without sound', err);
    return false;
  }
}

export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export class AudioEncodeError extends Error {
  constructor(cause: unknown) {
    super('recording: the soundtrack could not be encoded', { cause });
    this.name = 'AudioEncodeError';
  }
}

export async function recordWithAudioFallback(
  attempt: (audio: AudioBuffer | null) => Promise<Blob>,
  audio: AudioBuffer | null,
): Promise<{ blob: Blob; audible: boolean }> {
  if (!audio) return { blob: await attempt(null), audible: false };
  try {
    return { blob: await attempt(audio), audible: true };
  } catch (err) {
    if (!(err instanceof AudioEncodeError)) throw err;
    console.warn('replay recording could not encode its soundtrack; recording again without sound', err);
    return { blob: await attempt(null), audible: false };
  }
}

async function addSoundtrack(source: { add(buffer: AudioBuffer): Promise<void>; close(): void }, audio: AudioBuffer): Promise<void> {
  try {
    await source.add(audio);
    source.close();
  } catch (err) {
    throw new AudioEncodeError(err);
  }
}

export async function recordReplay(opts: RecordOptions): Promise<Blob> {
  const { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } = await import('mediabunny');
  const { width, height } = ASPECT_SIZE[opts.aspect];
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('recording: no 2D canvas context');
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: RECORD_BITRATE });
  output.addVideoTrack(source, { frameRate: REPLAY_FPS });
  const audioSource = opts.audio ? new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  const frames = totalFrames(opts.lengthS);
  try {
    await output.start();
    if (audioSource && opts.audio) await addSoundtrack(audioSource, opts.audio);
    for (let f = 0; f < frames; f++) {
      if (opts.signal.aborted) throw new DOMException('Recording cancelled', 'AbortError');
      const t = f / REPLAY_FPS;
      opts.draw(t, ctx as OffscreenCanvasRenderingContext2D, width, height);
      await source.add(t, 1 / REPLAY_FPS);
      opts.onProgress((f + 1) / frames);
    }
    if (opts.signal.aborted) throw new DOMException('Recording cancelled', 'AbortError');
    await output.finalize();
  } catch (err) {
    try {
      await output.cancel();
    } catch (cancelErr) {
      console.warn('recording: cancelling the output failed', cancelErr);
    }
    throw err;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('recording: the MP4 is empty');
  return new Blob([buffer], { type: 'video/mp4' });
}
