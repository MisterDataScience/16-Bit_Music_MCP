import { mkdir, lstat, realpath, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectSchema, totalTicks, PPQ, type Project } from './model.js';
import { renderAudio, encodeWav } from './synth.js';
import { exportMidi } from './midi.js';
import { assertValid, validateAudio, type ValidationReport } from './validate.js';

export class AssetStore {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }
  async resolve(relative: string, createParents = false): Promise<string> {
    if (!relative || relative.includes('\0') || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\') || relative.split('/').some(s => s === '..' || s === '.' || !s) || relative.length > 240) throw new Error('Asset paths must be short relative paths within the configured output directory');
    await mkdir(this.root, { recursive: true });
    const canonicalRoot = await realpath(this.root);
    const components = relative.split('/');
    let current = canonicalRoot;
    for (let index = 0; index < components.length; index++) {
      current = path.join(current, components[index]);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Symbolic links are not permitted in asset paths');
        if (index < components.length - 1 && !stat.isDirectory()) throw new Error('Asset parent is not a directory');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (index < components.length - 1) {
          if (createParents) await mkdir(current); else throw new Error('Asset parent directory does not exist');
        }
      }
    }
    if (!current.startsWith(canonicalRoot + path.sep)) throw new Error('Asset path escapes output directory');
    return current;
  }
  async write(relative: string, content: string | Buffer): Promise<string> {
    const file = await this.resolve(relative, true);
    const handle = await open(file, 'wx');
    try { await handle.writeFile(content); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(file).catch(() => {}); throw error; }
    await handle.close();
    return file;
  }
  async read(relative: string, maximum = 12_000_000): Promise<Buffer> {
    const file = await this.resolve(relative), handle = await open(file, 'r');
    try {
      if ((await handle.stat()).size > maximum) throw new Error('Asset is too large to load');
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  async saveProject(p: Project, filename: string): Promise<string> {
    assertValid(p); return this.write(filename, JSON.stringify(ProjectSchema.parse(p), null, 2) + '\n');
  }
  async loadProject(filename: string): Promise<Project> {
    const p = ProjectSchema.parse(JSON.parse((await this.read(filename)).toString('utf8'))); assertValid(p); return p;
  }
}

export function inspectWav(buffer: Buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.toString('ascii', 12, 16) !== 'fmt ' || buffer.toString('ascii', 36, 40) !== 'data') throw new Error('Unsupported or truncated PCM WAV');
  const channels = buffer.readUInt16LE(22), sampleRate = buffer.readUInt32LE(24), bits = buffer.readUInt16LE(34), dataBytes = buffer.readUInt32LE(40);
  if (buffer.readUInt16LE(20) !== 1 || channels !== 2 || bits !== 16 || dataBytes !== buffer.length - 44 || buffer.readUInt32LE(4) !== buffer.length - 8 || dataBytes % 4) throw new Error('Invalid stereo PCM16 WAV length or format');
  let peak = 0, power = 0;
  for (let i = 44; i < buffer.length; i += 2) { const n = buffer.readInt16LE(i) / 32768; peak = Math.max(peak, Math.abs(n)); power += n * n; }
  return { channels, sampleRate, frames: dataBytes / 4, seconds: dataBytes / 4 / sampleRate, peak, rms: Math.sqrt(power / (dataBytes / 2)) };
}

/** Independent SMF inspection checks duration, tempo events and note-off balance. */
export function inspectMidi(buffer: Buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'MThd' || buffer.length < 14 || buffer.readUInt32BE(4) !== 6) throw new Error('Invalid MIDI header');
  const division = buffer.readUInt16BE(12), tracks = buffer.readUInt16BE(10);
  if (!division || division & 0x8000) throw new Error('Unsupported MIDI division');
  let position = 14; const ends: number[] = [], tempos: Array<{tick: number; micros: number}> = [];
  let hanging = 0;
  for (let t = 0; t < tracks; t++) {
    if (buffer.toString('ascii', position, position + 4) !== 'MTrk') throw new Error('Missing MIDI track');
    const end = position + 8 + buffer.readUInt32BE(position + 4); position += 8;
    if (end > buffer.length) throw new Error('Truncated MIDI track');
    let tick = 0, terminated = false;
    const active = new Map<string, number>();
    const vlq = () => {
      let value = 0;
      for (let i = 0; i < 4; i++) { if (position >= end) throw new Error('Truncated MIDI event'); const b = buffer[position++]; value = (value << 7) | (b & 127); if (!(b & 128)) return value; }
      throw new Error('Invalid variable-length MIDI integer');
    };
    while (position < end) {
      tick += vlq(); const status = buffer[position++];
      if (status === 255) {
        const type = buffer[position++], length = vlq();
        if (position + length > end) throw new Error('MIDI meta event exceeds track');
        if (type === 81) { if (length !== 3) throw new Error('Invalid tempo'); tempos.push({ tick, micros: buffer.readUIntBE(position, 3) }); }
        if (type === 47) { if (length !== 0 || position !== end) throw new Error('Invalid end-of-track event'); terminated = true; }
        position += length;
      } else if ((status & 0xf0) === 0x90 || (status & 0xf0) === 0x80) {
        const pitch = buffer[position++], velocity = buffer[position++], key = `${status & 15}:${pitch}`;
        if ((status & 0xf0) === 0x90 && velocity) active.set(key, (active.get(key) ?? 0) + 1);
        else { const count = active.get(key) ?? 0; if (count < 1) throw new Error('Unbalanced MIDI note-off'); active.set(key, count - 1); }
      } else if ((status & 0xf0) === 0xc0) position++;
      else if ((status & 0xf0) === 0xb0) position += 2;
      else throw new Error('Unsupported MIDI event in Synod export');
      if (position > end) throw new Error('MIDI event exceeds track boundary');
    }
    if (!terminated) throw new Error('Missing end-of-track event');
    hanging += [...active.values()].reduce((a, b) => a + b, 0); ends.push(tick);
  }
  if (position !== buffer.length || tempos.length !== 1 || tempos[0].tick !== 0) throw new Error('Expected one tempo at tick zero and no trailing MIDI bytes');
  return { division, tracks, ends, ticks: Math.max(...ends), hanging, tempo: 60_000_000 / tempos[0].micros, seconds: Math.max(...ends) / division * tempos[0].micros / 1_000_000 };
}

export async function renderWav(p: Project, store: AssetStore, filename: string) {
  assertValid(p); const audio = renderAudio(p), report = validateAudio(p, audio);
  if (report.status !== 'passed') throw new Error(`Rendered audio failed validation: ${report.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`);
  const file = await store.write(filename, encodeWav(audio.mix, audio.sampleRate));
  const actual = inspectWav(await readFile(file));
  return { file, ...actual, report };
}
export async function exportStems(p: Project, store: AssetStore, directory: string) {
  assertValid(p); const audio = renderAudio(p), report = validateAudio(p, audio);
  if (report.status !== 'passed') throw new Error('Stem audio failed validation');
  const files: Record<string, string> = {};
  for (const [name, stem] of Object.entries(audio.stems)) files[name] = await store.write(`${directory}/${name}.wav`, encodeWav(stem, audio.sampleRate));
  return { files, frames: audio.frames, sampleRate: audio.sampleRate, report };
}

export async function exportPackage(p: Project, store: AssetStore, directory: string): Promise<{ directory: string; report: ValidationReport; files: string[] }> {
  assertValid(p); const audio = renderAudio(p), report = validateAudio(p, audio);
  if (report.status !== 'passed') throw new Error(`Cannot hand over failed audio: ${report.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`);
  const names = [`${directory}/mix.wav`, `${directory}/theme.mid`, `${directory}/project.json`, `${directory}/report.json`, `${directory}/manifest.json`, ...Object.keys(audio.stems).map(name => `${directory}/stems/${name}.wav`)];
  // Preflight avoids predictable partial exports when a name already exists.
  for (const name of names) {
    const file = await store.resolve(name, true);
    try { await lstat(file); throw new Error(`Output already exists: ${name}. Choose a new directory.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const files: string[] = [];
  const write = async (relative: string, content: string | Buffer) => { const f = await store.write(relative, content); files.push(f); return f; };
  await write(`${directory}/mix.wav`, encodeWav(audio.mix, audio.sampleRate));
  await write(`${directory}/theme.mid`, exportMidi(p));
  for (const [name, stem] of Object.entries(audio.stems)) await write(`${directory}/stems/${name}.wav`, encodeWav(stem, audio.sampleRate));
  const source = { ...p, validation: report };
  await write(`${directory}/project.json`, JSON.stringify(source, null, 2) + '\n');
  const add = (name: string, passed: boolean, detail: string) => report.checks.push({ name, passed, detail });
  const actualWav = inspectWav(await store.read(`${directory}/mix.wav`, 40_000_000));
  const actualMidi = inspectMidi(await store.read(`${directory}/theme.mid`));
  add('midi_duration', actualMidi.ticks === totalTicks(p) && actualMidi.ends.every(n => n === totalTicks(p)) && actualMidi.hanging === 0 && actualMidi.division === PPQ, 'Read-back MIDI has aligned end ticks, one tempo and no hanging notes');
  // MIDI tempo is an integer number of microseconds per quarter; allow its quantisation error.
  const tempoRounding = totalTicks(p) / PPQ * 0.5 / 1_000_000;
  add('wav_midi_agree', Math.abs(actualWav.seconds - actualMidi.seconds) <= 1 / audio.sampleRate + tempoRounding, `WAV ${actualWav.seconds.toFixed(6)} s; MIDI ${actualMidi.seconds.toFixed(6)} s`);
  const decodedStems = await Promise.all(Object.keys(audio.stems).map(async name => inspectWav(await store.read(`${directory}/stems/${name}.wav`, 40_000_000))));
  add('written_stems_align', decodedStems.every(a => a.frames === actualWav.frames && a.sampleRate === actualWav.sampleRate), 'Read-back PCM stems match the mix frame count and rate');
  const reloaded = await store.loadProject(`${directory}/project.json`);
  add('project_reload', JSON.stringify({ ...reloaded, validation: {} }) === JSON.stringify({ ...ProjectSchema.parse(p), validation: {} }), 'Structured source survives JSON save and reload');
  add('output_files_exist', (await Promise.all(files.map(f => lstat(f)))).every(s => s.isFile() && s.size > 0), 'Audio, MIDI, stems and source are present and non-empty');
  report.status = report.checks.every(c => c.passed) ? 'passed' : 'failed'; report.scope = 'exported_assets';
  const hashes: Record<string, string> = {};
  for (const file of files) hashes[path.relative(path.resolve(store.root, directory), file).split(path.sep).join('/')] = createHash('sha256').update(await readFile(file)).digest('hex');
  await write(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await write(`${directory}/manifest.json`, JSON.stringify({ version: 1, engine: 'synod-16bit-music-mcp', engineVersion: p.engineVersion, title: p.title, seed: p.seed,
    gameplayPurpose: p.brief.gameplayPurpose, style: p.styleProfile, hardware: p.brief.hardware,
    loop: p.brief.loop, loopStartFrame: 0, loopEndFrameExclusive: audio.frames, sampleRate: audio.sampleRate,
    bars: p.bars, tempo: p.tempo, key: p.key, scale: p.scale, timeSignature: p.timeSignature,
    status: report.status, assets: hashes,
    playtest: { required: true, checks: ['Audition three consecutive loops', 'Check gameplay entry and interruption', 'Check stem layering at each intensity', 'Assess motif, mood and fatigue'], revisionRoute: 'Return project.json with locked parts and a structured revision request' }
  }, null, 2) + '\n');
  if (report.status !== 'passed') throw new Error(`Export validation failed; inspect ${directory}/report.json`);
  return { directory: path.resolve(store.root, directory), report, files };
}
