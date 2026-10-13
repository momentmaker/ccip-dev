import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { MONTHLY_VIDEO } from '@ccip-dev/core/month';

/** Re-encodes the in-page 1080² recording to the file X accepts (at most 1280×1024, 4:2:0) and adds the soundtrack as AAC. */
export function muxArgs(video: string, audio: string, out: string): string[] {
  const { width, height } = MONTHLY_VIDEO;
  return [
    '-y', '-v', 'error', '-i', video, '-i', audio,
    '-vf', `scale=${width}:${height}:flags=lanczos:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium', '-crf', '18', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out,
  ];
}

/** `pnpm video:mux VIDEO AUDIO OUT`. */
function main([video, audio, out]: string[]): void {
  if (!video || !audio || !out) throw new Error('usage: pnpm video:mux <video.mp4> <audio.wav> <out.mp4>');
  execFileSync('ffmpeg', muxArgs(video, audio, out), { stdio: 'inherit' });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
