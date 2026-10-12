import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildHandles, buildLabelIndex, validateChainHandles, validateRegistry } from '@ccip-dev/core';

const ROOT = path.resolve(import.meta.dirname, '..');

const projectsDir = path.join(ROOT, 'labels/projects');
const names = (await readdir(projectsDir)).filter((f) => f.endsWith('.toml')).sort();
const files = await Promise.all(
  names.map(async (f) => ({ file: `labels/projects/${f}`, text: await readFile(path.join(projectsDir, f), 'utf8') })),
);
const chainNames = new Set<string>(JSON.parse(await readFile(path.join(ROOT, 'labels/ccip-chains.json'), 'utf8')));
const { projects, errors } = validateRegistry(files, chainNames);

const chainFile = await readFile(path.join(ROOT, 'labels/chain-x.json'), 'utf8');
const { handles: chainHandles, errors: chainErrors } = validateChainHandles(chainFile, chainNames);
const allErrors = [...errors, ...chainErrors];

if (allErrors.length > 0) {
  for (const e of allErrors) console.error(e);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`labels ok: ${projects.length} project file(s), ${Object.keys(chainHandles).length} chain handle(s)`);
} else {
  const generated = path.join(ROOT, 'worker/src/generated');
  await mkdir(generated, { recursive: true });
  const index = buildLabelIndex(projects);
  await writeFile(path.join(generated, 'labels.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${Object.keys(index).length} verified address label(s) to worker/src/generated/labels.json`);
  const handles = buildHandles(projects, chainHandles);
  await writeFile(path.join(generated, 'handles.json'), `${JSON.stringify(handles, null, 2)}\n`);
  console.log(`wrote ${Object.keys(handles.chains).length} chain handle(s) and ${handles.tokens.length} token handle(s) to worker/src/generated/handles.json`);
}
