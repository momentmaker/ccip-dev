import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLabelIndex, validateRegistry } from '@ccip-dev/core';

const ROOT = path.resolve(import.meta.dirname, '..');

const projectsDir = path.join(ROOT, 'labels/projects');
const names = (await readdir(projectsDir)).filter((f) => f.endsWith('.toml')).sort();
const files = await Promise.all(
  names.map(async (f) => ({ file: `labels/projects/${f}`, text: await readFile(path.join(projectsDir, f), 'utf8') })),
);
const chainNames = new Set<string>(JSON.parse(await readFile(path.join(ROOT, 'labels/ccip-chains.json'), 'utf8')));
const { projects, errors } = validateRegistry(files, chainNames);

if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`labels ok: ${projects.length} project file(s)`);
} else {
  const out = path.join(ROOT, 'worker/src/generated/labels.json');
  await mkdir(path.dirname(out), { recursive: true });
  const index = buildLabelIndex(projects);
  await writeFile(out, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${Object.keys(index).length} verified address label(s) to worker/src/generated/labels.json`);
}
