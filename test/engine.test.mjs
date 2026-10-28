import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMusicBrief, generateTheme, generateVariation, regeneratePart, lockPart, setMotif, setStyleProfile,
  STYLES, HARDWARE, PARTS, ProjectSchema, validateProject, validateAudio, renderAudio, encodeWav, exportMidi,
  inspectMidi, inspectWav, durationSeconds, totalTicks } from '../dist/engine.js';

const digest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const theme = (extra = {}, seed = 18427) => { const p = generateTheme({ bars: 4, ...extra }, seed); p.renderSettings.sampleRate = 8000; return p; };

test('brief keywords become explicit constraints, and explicit values win', () => {
  const b = createMusicBrief({ text: 'A lonely frozen village in D Dorian, 16 bars, 76 bpm, no drums', tempo: 80 });
  assert.equal(b.styleProfile, 'lonely_frozen_village'); assert.equal(b.tempo, 80); assert.equal(b.key, 'D'); assert.equal(b.scale, 'dorian'); assert.equal(b.bars, 16); assert.ok(b.prohibitedElements.includes('drums'));
  assert.ok(b.interpretation.some(s => s.includes('keyword')));
  assert.throws(() => createMusicBrief({ tempo: 0 }));
  assert.throws(() => createMusicBrief({ text: '999 bpm' }));
  assert.throws(() => createMusicBrief({ styleProfile: 'made_up' }));
  assert.throws(() => createMusicBrief({ arbitrary: true }));
});

test('the frozen-village lead stays in a narrow register without octave anchor jumps', () => {
  const p = theme({ styleProfile: 'lonely_frozen_village', bars: 16 });
  const notes = p.tracks.find(t => t.part === 'melody').notes;
  const pitches = notes.map(n => n.pitch);
  assert.ok(Math.max(...pitches) - Math.min(...pitches) <= 12);
  assert.ok(notes.slice(1).every((n, i) => Math.abs(n.pitch - notes[i].pitch) <= 12));
});

test('every style composes valid notes across keys, metres and seeds', () => {
  for (const styleProfile of Object.keys(STYLES)) for (const [key, timeSignature, seed] of [['D', '4/4', 0], ['Bb', '3/4', 42], ['F#', '6/8', 4294967295]]) {
    const p = theme({ styleProfile, key, timeSignature }, seed), report = validateProject(p);
    assert.equal(report.status, 'passed', `${styleProfile} ${key}: ${JSON.stringify(report.checks.filter(c => !c.passed))}`);
    assert.ok(p.tracks.every(t => t.notes.every(n => n.tick + n.duration <= totalTicks(p))));
    assert.equal(p.harmony.length, 4);
  }
});

test('seeded source, MIDI and rendered PCM repeat exactly', () => {
  const a = theme({ styleProfile: 'bright_platformer' }), b = theme({ styleProfile: 'bright_platformer' });
  assert.deepEqual(a, b); assert.deepEqual(exportMidi(a), exportMidi(b));
  const aa = renderAudio(a), bb = renderAudio(b);
  assert.equal(digest(encodeWav(aa.mix, aa.sampleRate)), digest(encodeWav(bb.mix, bb.sampleRate)));
  assert.notEqual(digest(a.motifs), digest(theme({}, 37).motifs));
});

test('each sound profile renders non-silent audio with aligned additive stems', () => {
  for (const hardware of Object.keys(HARDWARE)) {
    const p = theme({ hardware, bars: 2, styleProfile: 'heroic_overworld' }), a = renderAudio(p), report = validateAudio(p, a);
    assert.equal(report.status, 'passed', `${hardware}: ${JSON.stringify(report.checks.filter(c => !c.passed))}`);
    assert.equal(a.frames, Math.round(durationSeconds(p) * a.sampleRate));
    for (let i = 0; i < a.frames; i += 41) for (const channel of ['left', 'right']) assert.ok(Math.abs(Object.values(a.stems).reduce((n, stem) => n + stem[channel][i], 0) - a.mix[channel][i]) < 1e-10);
    assert.equal(inspectWav(encodeWav(a.mix, a.sampleRate)).frames, a.frames);
  }
});

test('all eleven sound families have a local finite renderer', () => {
  const waves = ['pulse', 'triangle', 'saw', 'fm_ep', 'fm_bell', 'wavetable', 'sample', 'noise', 'bass', 'pad', 'filtered_lead'];
  for (const wave of waves) {
    const p = theme({ bars: 1, requiredInstruments: [wave], intensityCurve: [1] });
    const a = renderAudio(p);
    assert.ok(p.tracks.some(t => t.instrument.wave === wave));
    assert.ok(a.mix.left.every(Number.isFinite)); assert.ok(a.rmsDb > -65);
  }
});

test('effects, slides and envelopes are repeatable and do not change duration', () => {
  const p = theme({ bars: 2 }); const lead = p.tracks.find(t => t.part === 'melody');
  Object.assign(lead.instrument, { delay: 0.2, reverb: 0.3, chorus: 0.2, bitDepth: 8, sampleHold: 3, highpass: 200, lowpass: 2500, portamento: 0.1, vibrato: 25 });
  lead.notes[0].slide = 2;
  const a = renderAudio(p); assert.equal(validateAudio(p, a).status, 'passed');
  const midi = inspectMidi(exportMidi(p)); assert.equal(midi.hanging, 0); assert.ok(Math.abs(midi.seconds - a.seconds) < 0.001);
});

test('all part locks survive unrelated regeneration and variation', () => {
  for (const part of PARTS) {
    const original = lockPart(theme(), part), originalLock = original.locks[part];
    assert.throws(() => regeneratePart(original, part), /locked/i);
    const varied = generateVariation(original, { seed: 67 });
    assert.equal(varied.locks[part], originalLock);
    assert.equal(validateProject(varied).locked_parts_preserved, true);
    const unlocked = lockPart(original, part, false); assert.equal(unlocked.locks[part], undefined);
  }
});

test('drum and bass revisions preserve the melody, chord plan and original source', () => {
  const p = theme({ styleProfile: 'tense_boss_battle' }), before = structuredClone(p);
  const changed = regeneratePart(p, 'drums', 500);
  assert.deepEqual(p, before);
  for (const track of p.tracks.filter(t => t.part !== 'drums')) assert.deepEqual(changed.tracks.find(t => t.part === track.part), track);
  assert.notEqual(digest(changed.tracks.find(t => t.part === 'drums')), digest(p.tracks.find(t => t.part === 'drums')));
  const variation = generateVariation(p, { seed: 99 });
  assert.deepEqual(variation.motifs.primary, p.motifs.primary); assert.deepEqual(variation.motifs.answer, p.motifs.answer);
  assert.deepEqual(variation.harmony, p.harmony); assert.equal(variation.key, p.key); assert.equal(variation.tempo, p.tempo);
  assert.deepEqual(variation.tracks.map(t => t.instrument), p.tracks.map(t => t.instrument));
  assert.equal(validateProject(variation).status, 'passed');
  assert.throws(() => generateVariation(p, { change: ['melody'], preserve: ['primary_motif'] }), /preserv/i);
});

test('motif edits rebuild their owner and shared motifs honour both locks', () => {
  const p = theme(), motif = { ticks: 1920, events: [{ offset: 0, duration: 480, degree: 0, velocity: 80 }, { offset: 960, duration: 240, degree: 4, velocity: 75 }] };
  const next = setMotif(p, 'primary', motif);
  assert.notEqual(digest(p.tracks[0].notes), digest(next.tracks[0].notes));
  assert.throws(() => setMotif(lockPart(p, 'melody'), 'primary', motif), /locked/);
  assert.throws(() => setMotif(lockPart(p, 'counter_melody'), 'answer', motif), /locked/);
  assert.throws(() => setMotif(p, 'primary', { ticks: 120, events: [{ offset: 100, duration: 100, degree: 0, velocity: 90 }] }));
  assert.notEqual(digest(setMotif(p, 'rhythmic', motif).tracks.find(t => t.part === 'drums')), digest(p.tracks.find(t => t.part === 'drums')));
});

test('style and sound changes preserve locks and reject unknown styles', () => {
  const p = lockPart(theme(), 'melody'), next = setStyleProfile(p, 'dark_dungeon', 'mega_drive');
  assert.deepEqual(next.tracks.find(t => t.part === 'melody'), p.tracks.find(t => t.part === 'melody'));
  assert.equal(next.brief.hardware, 'mega_drive'); assert.equal(validateProject(next).status, 'passed');
  assert.throws(() => setStyleProfile(p, 'unknown'));
});

test('validation detects key, grid, range, boundary, locks, metadata and silence faults', () => {
  const mutations = [
    p => { const n = p.tracks[0].notes[0]; n.pitch = 60; },
    p => { p.tracks[0].notes[0].tick = 1; },
    p => { p.tracks[0].notes[0].pitch = 0; },
    p => { p.tracks[0].notes[0].duration = totalTicks(p) + 10; },
    p => { p.tempo = 99; },
    p => { p.arrangement.sections[0].startBar = 1; },
    p => { p.locks.melody = '0'.repeat(64); }
  ];
  for (const mutate of mutations) { const p = theme(); mutate(p); assert.equal(validateProject(p).status, 'failed'); assert.throws(() => renderAudio(p)); }
  const p = theme(); p.tracks.forEach(t => { t.volume = 0; }); assert.equal(validateProject(p).status, 'failed');
  const a = renderAudio(theme()); a.mix.left.fill(0); a.mix.right.fill(0); a.rmsDb = -160; a.peakDb = -160;
  assert.equal(validateAudio(theme(), a).status, 'failed');
});

test('MIDI read-back has one tempo, no hanging notes and exact track ends', () => {
  for (const timeSignature of ['4/4', '3/4', '6/8']) {
    const p = theme({ timeSignature, tempo: 137.5 }), midi = inspectMidi(exportMidi(p));
    assert.equal(midi.hanging, 0); assert.ok(midi.ends.every(n => n === totalTicks(p)));
    assert.ok(Math.abs(midi.seconds - durationSeconds(p)) < 0.0001);
    const bad = exportMidi(p).subarray(0, 30); assert.throws(() => inspectMidi(bad));
  }
});

test('stingers are non-looping and unsupported versions fail', () => {
  const p = theme({ styleProfile: 'victory_fanfare' }); assert.equal(p.brief.loop, false);
  assert.equal(validateAudio(p, renderAudio(p)).loop, 'not_applicable');
  assert.equal(ProjectSchema.safeParse({ ...p, version: 99 }).success, false);
  assert.throws(() => theme({ bars: 128, tempo: 40 }) && renderAudio(theme({ bars: 128, tempo: 40 })), /budget|validation/i);
});
