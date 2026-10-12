// Throwaway mockups for the 3b moment cards, drawn with the real 3a card blocks and live public data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { render } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/node_modules/@cf-wasm/og/dist/node.js';
import { iconHref } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/src/lib/chain-icons.ts';
import { CARD_FONTS } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/worker/fonts.ts';
import { h, type Child, type VNode } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/worker/h.ts';
import { bold, broadcastFrame, COLORS, deltaStat, eyebrow, row, statsPanel, TEXT_COLUMN, boldArrows } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/worker/cards/broadcast-frame.ts';
import { glyph } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/worker/cards/glyphs.ts';
import { orbitSky, skyNodes, type OrbitSky } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/worker/cards/orbit-sky.ts';
import { windowWeights } from '/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/src/sky/weights.ts';

const OUT = process.argv[2]!;
const get = async (name: string) => (await fetch(`https://data.ccip.dev/v1/${name}`, { headers: { 'user-agent': 'curl/8.7.1' } })).json() as Promise<any>;
const [replay, chainsFile] = await Promise.all([get('replay.json'), get('chains.json')]);
const nameOf = new Map<string, string>();
for (const c of [...replay.chains, ...chainsFile.chains]) if (!nameOf.has(c.selector)) nameOf.set(c.selector, (c.display_name ?? c.name).replace(/ Mainnet$/, ''));
const sel = (n: string) => [...nameOf].find(([, v]) => v === n)?.[0] ?? '';
const nm = (s: string) => nameOf.get(s) ?? s;
const icon = async (selector: string) => {
  const href = iconHref(selector);
  if (!href) return null;
  const bytes = await readFile(path.join('/Users/rubberduck/GitHub/momentmaker/ccip-dev/site/public', href));
  return `data:${href.endsWith('.png') ? 'image/png' : 'image/svg+xml'};base64,${bytes.toString('base64')}`;
};
const iconsFor = async (sky: OrbitSky) => new Map(await Promise.all(sky.coins.map(async (c) => [c.selector, await icon(c.selector)] as const)));
const skyAround = (hub: string, from: string, to: string, extra: Record<string, unknown> = {}) => {
  const w = windowWeights(replay, from, to);
  const lanes = w.lanes.filter((l) => l.src === hub || l.dst === hub);
  const partners = new Map<string, number>();
  for (const l of lanes) {
    const other = l.src === hub ? l.dst : l.src;
    partners.set(other, (partners.get(other) ?? 0) + l.usd + l.messages);
  }
  const max = Math.max(1, ...partners.values());
  return orbitSky({ chains: [{ selector: hub, value: max * 3, name: nm(hub) }, ...[...partners].map(([s, v]) => ({ selector: s, value: v, name: nm(s) }))], lanes: lanes.map((l) => ({ ...l, usd: l.usd + l.messages })), seed: 20380, ...extra });
};
const skyOf = (from: string, to: string, extra: Record<string, unknown> = {}) => {
  const w = windowWeights(replay, from, to);
  return orbitSky({ chains: [...w.chains].map(([s, v]) => ({ selector: s, value: v, name: nm(s) })), lanes: w.lanes, seed: 20381, ...extra });
};

const pill = (text: string, from: string, to: string, ink: string, g: VNode | null) =>
  row([g, text], { alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 999, backgroundImage: `linear-gradient(90deg, ${from}, ${to})`, color: ink, fontWeight: 800, fontSize: 20, letterSpacing: 3 });
const line = (children: Child[], style: Record<string, unknown> = {}) => row(children, { marginTop: 10, alignSelf: 'flex-start', maxWidth: 660, flexWrap: 'wrap', fontSize: 26, color: COLORS.muted, ...style });
const column = (...kids: (VNode | null)[]) => h('div', { style: { position: 'absolute', left: 52, top: 118, width: 660, display: 'flex', flexDirection: 'column' } }, ...kids);
const big = (text: string, size = 104, glow = 'rgba(74,127,240,0.45)') => h('div', { style: { fontSize: size, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, color: '#fff', textShadow: `0 0 40px ${glow}`, marginTop: 6 } }, text);

async function save(name: string, tree: VNode) {
  const png = await render(tree as never, { width: 1200, height: 675, fonts: CARD_FONTS as never, loadAdditionalAsset: async () => [] }).asPng();
  await writeFile(path.join(OUT, `${name}.png`), png.image);
  console.log(name);
}
await mkdir(OUT, { recursive: true });

// 1. Welcome: the newest chain at the hub of its own sky.
const newest = [...replay.chains].sort((a: any, b: any) => b.first_day.localeCompare(a.first_day))[0];
{
  const sky = skyAround(newest.selector, newest.first_day, '2026-10-11', { gold: newest.selector, starFree: [TEXT_COLUMN] });
  await save('welcome', broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky)),
    eyebrow: 'New chain · Sun, Oct 11, 2026',
    body: column(
      pill('WELCOME TO CCIP', '#7de3ff', '#4a7ff0', '#04101f', glyph('star', 18, '#04101f', { right: 8 })),
      eyebrow('Chain #93 on CCIP', { marginTop: 24 }),
      big(nm(newest.selector), 96),
      line(['First message ', bold('Oct 11, 2026 '), 'to ', bold('Ethereum')]),
      line(['First day: ', bold('38 messages '), '· ', bold('$412.5K '), 'moved'], { fontSize: 24, color: COLORS.soft }),
    ),
    insight: ['Connected to ', bold('Ethereum'), ' · ', bold('Base'), ' · ', bold('Arbitrum')],
    cta: { lead: 'Every chain:', path: 'ccip.dev/chains' },
  }));
}

// 2. Movers: a new #1 headline, then the climbers.
{
  const sky = skyOf('2026-10-05', '2026-10-11', { gold: sel('Base'), starFree: [TEXT_COLUMN] });
  const climber = (rank: string, name: string, board: string, up: number) =>
    row([h('div', { style: { width: 64, fontFamily: 'JetBrains Mono', fontWeight: 800, color: '#fff', fontSize: 26 } }, rank), h('div', { style: { display: 'flex', width: 300 } }, boldArrows(name, 18)), h('div', { style: { width: 170, color: COLORS.muted } }, board), glyph('up', 16, COLORS.up, { right: 6 }), h('span', { style: { color: COLORS.up } }, `${up}`)], { fontSize: 24, marginTop: 10 });
  await save('movers', broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky)),
    eyebrow: 'Leaderboards · Oct 5 – 11, 2026',
    body: column(
      pill('NEW #1', '#ffcf5a', '#ff9f43', '#1a1205', glyph('star', 18, '#1a1205', { right: 8 })),
      eyebrow('Most fees paid to CCIP this week', { marginTop: 24 }),
      big('Base', 112, 'rgba(255,207,90,0.35)'),
      line(['$1.8K in fees · took #1 from ', bold('BNB Chain')]),
      h('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 22, paddingTop: 12, borderTop: '1px solid #1f2a3c', width: 600 } },
        eyebrow('Climbers', { fontSize: 16 }),
        climber('#3', 'Arbitrum', 'by fees', 6),
        climber('#7', 'syrupUSDT', 'by value', 9),
        climber('#9', 'Ink → Ethereum', 'by value', 14)),
    ),
    insight: ['Top token: ', bold('syrupUSDC'), ' · Busiest lane: ', boldArrows('Ethereum → Arc', 16)],
    cta: { lead: 'Every board:', path: 'ccip.dev/top/chain/7d/fees' },
  }));
}

// 3. Countdown: the next milestone with a progress bar.
{
  const sky = skyOf('2026-10-11', '2026-10-11', { dim: true, starFree: [TEXT_COLUMN] });
  const bar = h('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 26, width: 600 } },
    h('div', { style: { display: 'flex', width: 600, height: 18, borderRadius: 9, backgroundColor: '#18202e', overflow: 'hidden' } },
      h('div', { style: { width: 560, height: 18, borderRadius: 9, backgroundImage: 'linear-gradient(90deg, #4a7ff0, #7de3ff)' } })),
    row([h('span', { style: { color: COLORS.muted } }, '$2M · Jul 20'), h('span', { style: { color: COLORS.soft, fontWeight: 700 } }, '$2.43M now'), h('span', { style: { color: COLORS.muted } }, '$2.5M')], { justifyContent: 'space-between', width: 600, fontSize: 20, marginTop: 8 }));
  await save('countdown', broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky)),
    eyebrow: 'Countdown · Mon, Oct 12, 2026',
    body: column(
      pill('COUNTDOWN', '#c6a8ff', '#7d5cff', '#120a26', null),
      eyebrow('All-time fees paid to CCIP', { marginTop: 24 }),
      big('$2.5M', 132),
      line(['About ', bold('6 days '), 'away at ', bold('$11.6K '), 'a day']),
      bar,
    ),
    insight: ['Last milestone: ', bold('$2M'), ' on Jul 20, 2026'],
    cta: { lead: 'Every record:', path: 'ccip.dev/records' },
  }));
}

// 4. Spotlight: the fastest grower at the hub, its week in a glass panel.
{
  const hub = sel('Base') || newest.selector;
  const sky = skyAround(hub, '2026-10-05', '2026-10-11', { gold: hub });
  const partners = h('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 16, paddingTop: 12, borderTop: '1px solid #1f2a3c' } },
    row([h('span', { style: { color: COLORS.muted, fontSize: 16, letterSpacing: 2, fontWeight: 700, width: 150 } }, 'TOP PARTNERS'), bold('Ethereum '), '· ', bold('Arbitrum '), '· ', bold('BNB Chain')], { fontSize: 20 }),
    row([h('span', { style: { color: COLORS.muted, fontSize: 16, letterSpacing: 2, fontWeight: 700, width: 150 } }, 'TOP TOKEN'), bold('USDC '), h('span', { style: { color: COLORS.muted } }, '· $41.2M moved')], { fontSize: 20, marginTop: 8 }));
  await save('spotlight', broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky)),
    eyebrow: 'Chain spotlight · Oct 5 – 11, 2026',
    body: h('div', { style: { position: 'absolute', left: 52, top: 112, width: 540, display: 'flex', flexDirection: 'column', padding: '24px 30px', backgroundColor: 'rgba(10,13,19,0.8)', border: '1px solid #233047', borderRadius: 22 } },
      row([glyph('up', 16, COLORS.up, { right: 8 }), 'FASTEST GROWER · VS LAST WEEK'], { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: COLORS.up }),
      row([h('span', { style: { fontSize: 56, fontWeight: 800, color: '#fff', letterSpacing: -1.5 } }, `${nm(hub)} `), h('span', { style: { fontSize: 24, color: COLORS.muted, marginLeft: 6 } }, '#2 by messages')], { alignItems: 'flex-end', marginTop: 6 }),
      h('div', { style: { display: 'flex', marginTop: 4 } },
        ...[['Messages', '3,412', '85%'], ['Value moved', '$96.4M', '41%'], ['Fees', '$1.8K', '27%']].map(([l, v, d]) =>
          h('div', { style: { display: 'flex', flexDirection: 'column', width: 160, marginTop: 10 } },
            h('div', { style: { fontSize: 15, fontWeight: 700, letterSpacing: 2, color: COLORS.muted, textTransform: 'uppercase' } }, l),
            h('div', { style: { fontSize: 36, fontWeight: 800, fontFamily: 'JetBrains Mono', marginTop: 4 } }, v),
            row([glyph('up', 13, COLORS.up, { right: 5 }), d], { fontSize: 17, color: COLORS.up, marginTop: 2 })))),
      partners),
    insight: [glyph('up', 16, COLORS.up, { right: 8 }), 'Fastest-growing chain on CCIP this week'],
    cta: { lead: 'Every chain:', path: 'ccip.dev/chains' },
  }));
}

// 5. Roundup: the week's new lanes and tokens.
{
  const sky = skyOf('2026-10-05', '2026-10-11', { dim: true, starFree: [TEXT_COLUMN] });
  const item = (kids: Child[]) => row(kids, { fontSize: 24, marginTop: 10, color: COLORS.soft });
  await save('roundup', broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky)),
    eyebrow: 'This week · Oct 5 – 9, 2026',
    body: column(
      pill('NEW ON CCIP', '#7fd4a0', '#2bb673', '#04160c', null),
      h('div', { style: { display: 'flex', marginTop: 24 } },
        h('div', { style: { display: 'flex', flexDirection: 'column', width: 330 } },
          eyebrow('3 new lanes', { fontSize: 18 }),
          item([boldArrows('Ethereum → Tempo', 18)]),
          item([boldArrows('Base → Monad', 18)]),
          item([boldArrows('Plasma → Arc', 18)])),
        h('div', { style: { display: 'flex', flexDirection: 'column', width: 300 } },
          eyebrow('2 new tokens', { fontSize: 18 }),
          item([bold('USDat '), 'on Ethereum']),
          item([bold('PST '), 'on Base']))),
    ),
    insight: ['CCIP now runs ', bold('933 lanes'), ' between ', bold('93 chains')],
    cta: { lead: 'Watch every lane:', path: 'ccip.dev/replay' },
  }));
}

// 6. Poll: last week's answer and the new question.
{
  const sky = skyOf('2026-10-05', '2026-10-11', { dim: true, starFree: [{ x: 40, y: 40, width: 1120, height: 560 }] });
  const share = (name: string, pct: number, win: boolean) =>
    row([h('div', { style: { width: 150, fontWeight: 700, color: win ? '#fff' : COLORS.soft } }, name), h('div', { style: { display: 'flex', width: 220, height: 14, borderRadius: 7, backgroundColor: '#18202e' } }, h('div', { style: { width: Math.round(2.2 * pct), height: 14, borderRadius: 7, backgroundColor: win ? COLORS.gold : '#3a4a68' } })), h('span', { style: { marginLeft: 12, color: win ? COLORS.gold : COLORS.muted, fontWeight: 700 } }, `${pct}%`)], { fontSize: 20, marginTop: 8 });
  const option = (letter: string, text: string) => row([h('div', { style: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1d2a44', color: '#9cc0ff', fontWeight: 800, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12 } }, letter), text], { fontSize: 24, color: '#fff', fontWeight: 700, marginTop: 10 });
  await save('poll', broadcastFrame({
    background: skyNodes(sky, await iconsFor(sky)),
    eyebrow: 'Prediction · Week of Oct 12, 2026',
    body: h('div', { style: { position: 'absolute', left: 52, top: 112, width: 1096, display: 'flex' } },
      h('div', { style: { display: 'flex', flexDirection: 'column', width: 500, padding: '24px 28px', backgroundColor: 'rgba(10,13,19,0.82)', border: '1px solid #233047', borderRadius: 22 } },
        eyebrow('Last week', { fontSize: 18 }),
        h('div', { style: { fontSize: 24, color: COLORS.soft, marginTop: 10 } }, 'Which chain paid the most fees?'),
        row([glyph('star', 20, COLORS.gold, { right: 10 }), bold('Base '), h('span', { style: { color: COLORS.muted } }, '· $1.8K')], { fontSize: 34, marginTop: 10 }),
        share('Base', 38, true), share('BNB Chain', 31, false), share('Ethereum', 22, false), share('Another', 9, false),
        h('div', { style: { fontSize: 22, color: COLORS.gold, fontWeight: 700, marginTop: 14 } }, '38% of you called it')),
      h('div', { style: { display: 'flex', flexDirection: 'column', width: 560, marginLeft: 36, padding: '24px 28px', backgroundColor: 'rgba(16,24,44,0.85)', border: '1px solid #2c4a8a', borderRadius: 22 } },
        eyebrow('This week', { fontSize: 18, color: '#9cc0ff' }),
        h('div', { style: { fontSize: 34, fontWeight: 800, color: '#fff', marginTop: 10, lineHeight: 1.2 } }, 'Will CCIP fees beat last week’s $8.0K?'),
        option('A', 'Up more than 10%'), option('B', 'Within 10%'), option('C', 'Down more than 10%'))),
    insight: ['Vote in the poll below · results next Monday'],
    cta: { lead: 'Every week:', path: 'ccip.dev/history' },
  }));
}
