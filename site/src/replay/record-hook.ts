import type { Aspect } from './player';
import { ASPECT_SIZE, AVC_CODEC } from './recorder';
import { REPLAY_LENGTHS, type ReplayLength } from './timeline';
import { wavBytes, type PcmAudio } from './wav';

export const VIDEO_FILE = 'video.mp4';
export const AUDIO_FILE = 'audio.wav';

export interface RecordRequest {
  aspect: string;
  length: number;
}

export interface RecordedFiles {
  video: string;
  audio: string;
}

export interface RecordHookDeps {
  canRecord: (aspect: Aspect) => Promise<boolean>;
  /** Records the cut without sound, and renders its soundtrack apart. */
  record: (aspect: Aspect, length: ReplayLength, onProgress: (fraction: number) => void) => Promise<{ video: Blob; audio: PcmAudio }>;
  download: (blob: Blob, filename: string) => void;
  log: (line: string) => void;
}

declare global {
  interface Window {
    /** The month page's hook for the monthly video workflow: the silent MP4 and the WAV soundtrack arrive as two downloads. */
    ccipRecord?: (request: RecordRequest) => Promise<RecordedFiles>;
  }
}

const isAspect = (value: string): value is Aspect => Object.hasOwn(ASPECT_SIZE, value);
const isLength = (value: number): value is ReplayLength => (REPLAY_LENGTHS as readonly number[]).includes(value);

/** Logs each tenth of the recording once, so the workflow's log shows it moving. */
function progressLog(log: (line: string) => void): (fraction: number) => void {
  let shown = -1;
  return (fraction) => {
    const tenth = Math.floor(fraction * 10);
    if (tenth <= shown) return;
    shown = tenth;
    log(`ccipRecord: ${tenth * 10}%`);
  };
}

/**
 * The record hook: checks the request and the browser, records, then hands over the video and its soundtrack as
 * `video.mp4` and `audio.wav`. One recording at a time; a request it cannot serve fails with the reason.
 */
export function createRecordHook(deps: RecordHookDeps): (request: RecordRequest) => Promise<RecordedFiles> {
  let busy = false;
  return async ({ aspect, length }) => {
    if (!isAspect(aspect)) throw new Error(`ccipRecord: aspect must be one of ${Object.keys(ASPECT_SIZE).join(', ')}, not ${String(aspect)}`);
    if (!isLength(length)) throw new Error(`ccipRecord: length must be one of ${REPLAY_LENGTHS.join(', ')} seconds, not ${String(length)}`);
    if (busy) throw new Error('ccipRecord: a recording is already running');
    const { width, height } = ASPECT_SIZE[aspect];
    if (!(await deps.canRecord(aspect))) throw new Error(`ccipRecord: this browser cannot encode H.264 (${AVC_CODEC}) at ${width}×${height}`);
    busy = true;
    try {
      const { video, audio } = await deps.record(aspect, length, progressLog(deps.log));
      deps.download(new Blob([video], { type: 'video/mp4' }), VIDEO_FILE);
      deps.download(new Blob([wavBytes(audio)], { type: 'audio/wav' }), AUDIO_FILE);
      return { video: VIDEO_FILE, audio: AUDIO_FILE };
    } finally {
      busy = false;
    }
  };
}
