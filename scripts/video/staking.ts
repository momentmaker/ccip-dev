import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const SIZE = 1080;
const READY_TIMEOUT_MS = 60_000;
const PLAY_TIMEOUT_MS = 120_000;

/** Re-encodes Playwright's WebM to an MP4 that X and Telegram take: H.264, 4:2:0, 30 fps, no sound. */
export function encodeArgs(webm: string, out: string): string[] {
  return ['-y', '-v', 'error', '-i', webm, '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30', '-an', '-movflags', '+faststart', out];
}

/** `pnpm video:staking`: plays /staking/timelapse/ in Chrome, records it, and saves `--out`/staking-timelapse.mp4. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { base: { type: 'string', default: 'https://ccip.dev' }, out: { type: 'string', default: 'out/video' } } });
  const out = path.resolve(values.out);
  const raw = path.join(out, 'staking-raw');
  await mkdir(raw, { recursive: true });
  // Playwright's own Chromium records the page as WebM itself; ffmpeg makes the MP4, so Chrome's H.264 is not needed here.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, recordVideo: { dir: raw, size: { width: SIZE, height: SIZE } } });
    const page = await context.newPage();
    const url = `${values.base.replace(/\/+$/, '')}/staking/timelapse/`;
    console.log(`Recording ${url}`);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => ['ready', 'failed'].includes(document.documentElement.dataset.timelapse ?? ''), undefined, { timeout: READY_TIMEOUT_MS });
    if ((await page.evaluate(() => document.documentElement.dataset.timelapse)) === 'failed') throw new Error(`${url} could not read staking.json`);
    await page.waitForFunction(() => document.documentElement.dataset.timelapse === 'done', undefined, { timeout: PLAY_TIMEOUT_MS });
    await context.close();
    const webm = (await readdir(raw)).find((f) => f.endsWith('.webm'));
    if (!webm) throw new Error('Playwright saved no recording');
    const mp4 = path.join(out, 'staking-timelapse.mp4');
    execFileSync('ffmpeg', encodeArgs(path.join(raw, webm), mp4), { stdio: 'inherit' });
    await rm(raw, { recursive: true, force: true });
    console.log(`Saved ${mp4}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
