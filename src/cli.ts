#!/usr/bin/env node
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createMusicBrief, generateTheme, validateProject, exportPackage, AssetStore, STYLES, HARDWARE } from './engine/index.js';

const [command = 'help', ...args] = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
try {
  if (command === 'profiles') console.log(JSON.stringify({ styles: STYLES, hardware: HARDWARE }, null, 2));
  else if (command === 'compose' || command === 'self-test') {
    const brief = command === 'self-test' ? createMusicBrief({ text: 'Frozen village, no drums', bars: 4 }) : createMusicBrief(JSON.parse(await readFile(flag('brief') ?? 'examples/frozen-village.brief.json', 'utf8')));
    const project = generateTheme(brief, Number(flag('seed') ?? 18427));
    if (command === 'self-test') project.renderSettings.sampleRate = 8000;
    const destination = path.resolve(flag('out') ?? (command === 'self-test' ? `output/self-test-${randomUUID()}` : 'output/frozen-village'));
    const result = await exportPackage(project, new AssetStore(path.dirname(destination)), path.basename(destination));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'validate') {
    const filename = flag('project');
    if (!filename) throw new Error('Use validate --project path/to/project.json');
    const report = validateProject(JSON.parse(await readFile(filename, 'utf8')));
    console.log(JSON.stringify(report, null, 2)); if (report.status !== 'passed') process.exitCode = 1;
  } else {
    console.log('synod-music compose --brief examples/frozen-village.brief.json --seed 18427 --out output/frozen-village\nsynod-music self-test [--out output/check]\nsynod-music validate --project output/frozen-village/project.json\nsynod-music profiles\nMCP: node /absolute/path/dist/server.js');
    if (command !== 'help') process.exitCode = 1;
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
