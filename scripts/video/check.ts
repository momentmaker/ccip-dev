import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MONTHLY_VIDEO } from '@ccip-dev/core/month';

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
}

/** ffprobe's JSON for `-show_entries format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt`. */
export interface Probe {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string };
}

export const DURATION_S = { min: 29.5, max: 30.5 } as const;
/** X takes only 4:2:0 video; Chrome writes yuv420p on Linux and yuvj420p (full range) on a Mac. */
const PIXEL_FORMATS = ['yuv420p', 'yuvj420p'];

/** Why the muxed video must not be uploaded; empty when it may. */
export function videoProblems(probe: Probe): string[] {
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  const audio = probe.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration);
  const size = Number(probe.format?.size);
  const problems: string[] = [];
  if (!(duration >= DURATION_S.min && duration <= DURATION_S.max)) problems.push(`it lasts ${probe.format?.duration ?? 'no'} s, not ${DURATION_S.min}–${DURATION_S.max} s`);
  if (!video) problems.push('it has no video');
  else {
    if (video.width !== MONTHLY_VIDEO.width || video.height !== MONTHLY_VIDEO.height) problems.push(`its video is ${video.width}×${video.height}, not ${MONTHLY_VIDEO.width}×${MONTHLY_VIDEO.height}`);
    if (video.codec_name !== 'h264') problems.push(`its video is ${video.codec_name ?? 'of no codec'}, not H.264`);
    if (!PIXEL_FORMATS.includes(video.pix_fmt ?? '')) problems.push(`its pixels are ${video.pix_fmt ?? 'of no format'}, not 4:2:0`);
  }
  if (audio?.codec_name !== 'aac') problems.push(audio ? `its audio is ${audio.codec_name ?? 'of no codec'}, not AAC` : 'it has no audio');
  if (!(size > 0 && size < MONTHLY_VIDEO.maxBytes)) problems.push(`it is ${probe.format?.size ?? 'of no'} bytes, not under ${MONTHLY_VIDEO.maxBytes / 1_000_000} MB`);
  return problems;
}

/** `pnpm video:check <file>`: fails the workflow, so nothing is uploaded, unless the file is the video the Worker may post. */
function main(file: string | undefined): void {
  if (!file) throw new Error('usage: pnpm video:check <file.mp4>');
  const json = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  const problems = videoProblems(JSON.parse(json) as Probe);
  if (problems.length > 0) {
    console.error(`${file} is not a valid monthly video: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log(`${file} is valid: ${json.replace(/\s+/g, ' ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv[2]);
