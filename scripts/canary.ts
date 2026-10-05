import { createCcipClient, DetailMessage, type HttpDeps } from '@ccip-dev/core';

const deps: HttpDeps = {
  fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock: () => Date.now(),
};

async function check(name: string, run: () => Promise<string>): Promise<boolean> {
  try {
    console.log(`ok   ${name}: ${await run()}`);
    return true;
  } catch (err) {
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main(): Promise<void> {
  const ccip = createCcipClient(deps);
  let firstId = '';
  const results = [
    await check('list messages', async () => {
      const page = await ccip.listMessages({ limit: 5 });
      firstId = page.messages[0]?.messageId ?? '';
      return `${page.messages.length} messages, next cursor ${page.cursor ? 'present' : 'absent'}`;
    }),
    await check('message detail', async () => {
      const detail = DetailMessage.parse(await ccip.getMessageRaw(firstId));
      return `version ${detail.version}, ${detail.tokenAmounts.length} token(s)`;
    }),
    await check('chains', async () => `${(await ccip.listChains()).length} mainnet chains`),
    await check('tokens', async () => `${(await ccip.listTokens({ limit: 5 })).tokens.length} tokens on first page`),
  ];
  if (results.includes(false)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
