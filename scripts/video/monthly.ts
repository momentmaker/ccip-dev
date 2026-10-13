import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Download } from 'playwright';
import { isMonth, previousMonth } from '@ccip-dev/core/month';
import { launchChrome, probePage, probeProblems } from './browser';

const READY_TIMEOUT_MS = 120_000;
const DOWNLOAD_WAIT_MS = 30_000;
export const RECORDED_FILES = ['video.mp4', 'audio.wav', 'summary.json'] as const;

/** The month to record: `--month`, or the month before `now`'s (UTC). */
export function pickMonth(arg: string | undefined, now: Date): string {
  const month = arg ? arg : previousMonth(now.toISOString().slice(0, 7));
  if (!isMonth(month)) throw new Error(`--month must be YYYY-MM, not ${month}`);
  return month;
}

export function monthPageUrl(base: string, month: string): string {
  return `${base.replace(/\/+$/, '')}/replay/month/?m=${month}`;
}

/** `pnpm video:monthly --month YYYY-MM`: records the month page's cut in Chrome and saves video.mp4, audio.wav and summary.json to `--out`. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { month: { type: 'string' }, base: { type: 'string', default: 'https://ccip.dev' }, out: { type: 'string', default: 'out/video' } } });
  const month = pickMonth(values.month, new Date());
  const out = path.resolve(values.out);
  await mkdir(out, { recursive: true });
  const browser = await launchChrome();
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.on('console', (m) => console.log(`[page] ${m.text()}`));
    const downloads: Download[] = [];
    page.on('download', (d) => downloads.push(d));
    const url = monthPageUrl(values.base, month);
    console.log(`Recording ${url} in Chrome ${browser.version()}`);
    await page.goto(url, { waitUntil: 'load' });
    const problems = probeProblems(await probePage(page));
    if (problems.length > 0) throw new Error(`Chrome cannot record the monthly video: ${problems.join('; ')}`);
    await page.waitForFunction(() => document.documentElement.dataset.month !== undefined, undefined, { timeout: READY_TIMEOUT_MS });
    if ((await page.evaluate(() => document.documentElement.dataset.month)) !== 'ready') {
      throw new Error(`${url} shows no such month: the month is not over, or its last day is not finalized yet`);
    }
    const started = Date.now();
    await page.evaluate(() => (window as unknown as { ccipRecord: (r: { aspect: string; length: number }) => Promise<unknown> }).ccipRecord({ aspect: '1:1', length: 30 }));
    for (const deadline = Date.now() + DOWNLOAD_WAIT_MS; downloads.length < RECORDED_FILES.length && Date.now() < deadline; ) await new Promise((r) => setTimeout(r, 200));
    const names = downloads.map((d) => d.suggestedFilename());
    if (!RECORDED_FILES.every((f) => names.includes(f))) throw new Error(`the page handed over ${names.join(', ') || 'nothing'}, not ${RECORDED_FILES.join(', ')}`);
    for (const d of downloads) await d.saveAs(path.join(out, d.suggestedFilename()));
    console.log(`Recorded ${month} in ${Math.round((Date.now() - started) / 1000)} s: ${RECORDED_FILES.map((f) => path.join(out, f)).join(', ')}`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
