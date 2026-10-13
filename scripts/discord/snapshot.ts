import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CallsignSnapshot } from '../../discord/src/draw';
import { buildSnapshot, checkSnapshot } from '../../discord/src/snapshot';
import { readAllowedTags, readArchive, readLore } from './archive';

/** `pnpm discord:snapshot [--archive ../chainlinkmeme]`: writes discord/src/data/callsigns.json from the archive at its checked-out commit. */
const root = join(import.meta.dirname, '..', '..');
const { values } = parseArgs({ options: { archive: { type: 'string', default: join(root, '..', 'chainlinkmeme') } } });
const archive = resolve(values.archive);
if (!existsSync(join(archive, 'memes'))) throw new Error(`no chainlinkmeme checkout at ${archive}: pass --archive <path to it>`);
const sha = execFileSync('git', ['-C', archive, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const out = join(root, 'discord', 'src', 'data', 'callsigns.json');
const previous = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as CallsignSnapshot) : null;
const build = (version: number) =>
  buildSnapshot({
    allowed: readAllowedTags(readFileSync(join(root, 'docs', 'callsigns', 'tags.toml'), 'utf8')),
    memes: readArchive(archive),
    lore: readLore(readFileSync(join(root, 'docs', 'callsigns', 'lore.toml'), 'utf8')),
    repo: 'momentmaker/chainlinkmeme',
    sha,
    version,
  });
const started = performance.now();
let snapshot = build(previous?.version ?? 1);
const simulationMs = Math.round(performance.now() - started);
checkSnapshot(snapshot);
if (previous && JSON.stringify(previous) !== JSON.stringify(snapshot)) snapshot = { ...snapshot, version: previous.version + 1 };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(snapshot)}\n`);
console.log(`wrote discord/src/data/callsigns.json: version ${snapshot.version}, ${snapshot.tags.length} tags, chainlinkmeme ${sha.slice(0, 7)}, built in ${simulationMs} ms`);
