import { parseArgs } from 'node:util';
import { launchChrome, probePage, probeProblems } from './browser';

/** `pnpm video:smoke`: can this machine's Chrome record the monthly video? Prints what it found; exits 1 when it cannot. */
const { values } = parseArgs({ options: { base: { type: 'string', default: 'https://ccip.dev' } } });
const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.goto(values.base, { waitUntil: 'load' });
  const probe = await probePage(page);
  console.log(`Chrome ${browser.version()}: ${JSON.stringify(probe)}`);
  const problems = probeProblems(probe);
  if (problems.length > 0) {
    console.error(`Chrome cannot record the monthly video: ${problems.join('; ')}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
