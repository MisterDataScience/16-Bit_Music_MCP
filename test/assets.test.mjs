import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AssetStore, generateTheme, exportPackage, inspectWav, inspectMidi } from '../dist/engine.js';

await mkdir('artifacts/tests', { recursive: true });
test('asset package is reloadable and verified from actual written files', async () => {
  const root = await mkdtemp(path.resolve('artifacts/tests/package-')), store = new AssetStore(root);
  const p = generateTheme({ bars: 2, styleProfile: 'futuristic_city' }, 99); p.renderSettings.sampleRate = 8000;
  const result = await exportPackage(p, store, 'theme');
  assert.equal(result.report.status, 'passed'); assert.equal(result.report.scope, 'exported_assets');
  assert.ok(result.report.checks.some(c => c.name === 'wav_midi_agree' && c.passed));
  const loaded = await store.loadProject('theme/project.json'); assert.deepEqual({ ...loaded, validation: {} }, { ...p, validation: {} });
  const manifest = JSON.parse(await store.read('theme/manifest.json'));
  for (const [file, digest] of Object.entries(manifest.assets)) assert.equal(createHash('sha256').update(await store.read(`theme/${file}`)).digest('hex'), digest);
  const mix = inspectWav(await store.read('theme/mix.wav'));
  for (const file of Object.keys(manifest.assets).filter(n => n.startsWith('stems/'))) assert.equal(inspectWav(await store.read(`theme/${file}`)).frames, mix.frames);
  assert.equal(inspectMidi(await store.read('theme/theme.mid')).hanging, 0);
  await assert.rejects(() => exportPackage(p, store, 'theme'), /already exists/);
});

test('asset paths reject traversal, absolute paths, symlinks and overwrites', async () => {
  const root = await mkdtemp(path.resolve('artifacts/tests/paths-')), store = new AssetStore(root);
  for (const filename of ['../escape', '/tmp/escape', 'C:\\escape', 'x/../../escape', 'x//y', './x']) await assert.rejects(() => store.write(filename, 'bad'));
  await store.write('safe/file.json', '{}');
  await assert.rejects(() => store.write('safe/file.json', 'overwrite'), /EEXIST/);
  assert.equal((await store.read('safe/file.json')).toString(), '{}');
  try {
    await symlink(path.resolve(root, 'safe'), path.resolve(root, 'link'));
    await assert.rejects(() => store.write('link/escape', 'bad'), /Symbolic/);
  } catch (error) { if (process.platform !== 'win32' || error.code !== 'EPERM') throw error; }
  await assert.rejects(() => store.read('safe/file.json', 1), /too large/);
  await store.write('bad.json', '{"version":99}'); await assert.rejects(() => store.loadProject('bad.json'));
});
