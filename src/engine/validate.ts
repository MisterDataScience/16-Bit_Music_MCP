import { ProjectSchema, SCALES, KEYS, PPQ, totalTicks, ticksPerBar, durationSeconds, PARTS, type Project } from './model.js';
import { STYLES } from './profiles.js';
import { assertLocks } from './operations.js';
import type { AudioRender } from './synth.js';

export type Check = { name: string; passed: boolean; detail: string };
export type ValidationReport = {
  status: 'passed' | 'failed'; scope: 'structure' | 'rendered_audio' | 'exported_assets';
  checks: Check[]; warnings: string[]; bars?: number; tempo?: number; key?: string;
  loop?: 'clean' | 'failed' | 'not_rendered' | 'not_applicable'; stems?: number;
  peak_level?: number; rms_level?: number; locked_parts_preserved?: boolean; [key: string]: unknown;
};
export function validateProject(input: unknown): ValidationReport {
  const parsed = ProjectSchema.safeParse(input);
  const checks: Check[] = [], warnings: string[] = [];
  const check = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  if (!parsed.success) return { status: 'failed', scope: 'structure', checks: [{ name: 'project_schema', passed: false, detail: parsed.error.message }], warnings };
  const p = parsed.data, end = totalTicks(p);
  check('project_schema', true, 'Version 1 source loaded successfully');
  check('brief_consistency', ['title', 'tempo', 'key', 'scale', 'bars', 'timeSignature', 'styleProfile'].every(k => p[k as keyof Project] === p.brief[k as keyof Project['brief']]), 'Top-level timing, style and key must match the stored brief');
  check('known_style', Boolean(STYLES[p.styleProfile]), p.styleProfile);
  check('track_identity', new Set(p.tracks.map(t => t.id)).size === p.tracks.length && new Set(p.tracks.map(t => t.part)).size === p.tracks.length, 'Track IDs and part assignments are unique');
  check('instrument_roles', p.tracks.every(t => t.instrument.wave !== 'sample' || t.part === 'drums'), 'PCM sample voices belong to the drum track');
  const keySet = new Set(SCALES[p.scale].map(n => (n + KEYS[p.key]) % 12));
  const errors = { key: 0, range: 0, grid: 0, boundary: 0, chromatic: 0 };
  let noteCount = 0;
  for (const track of p.tracks) for (const note of track.notes) {
    noteCount++;
    if (Math.min(note.pitch, note.pitch + note.slide) < track.instrument.range[0] || Math.max(note.pitch, note.pitch + note.slide) > track.instrument.range[1]) errors.range++;
    if (note.tick % 12 !== 0) errors.grid++;
    if (note.tick + note.duration > end) errors.boundary++;
    if (!['drums', 'effects'].includes(track.part) && !keySet.has(note.pitch % 12)) {
      const chord = p.harmony[Math.floor(note.tick / ticksPerBar(p))];
      const allowedBorrow = track.part === 'harmony' && note.chromatic && chord?.borrowed && chord.pitches.some(n => n % 12 === note.pitch % 12) && !p.brief.prohibitedElements.includes('chromatic_notes');
      if (!allowedBorrow) errors.key++;
    }
    if (note.slide !== 0 && p.brief.prohibitedElements.includes('chromatic_notes')) errors.chromatic++;
  }
  for (const [name, count] of Object.entries(errors)) check(`notes_${name}`, count === 0, `${count} violations`);
  check('has_composition', noteCount > 0 && p.tracks.some(t => !['drums', 'effects'].includes(t.part) && t.notes.length && t.volume > 0), `${noteCount} notes`);
  check('harmonic_plan', p.harmony.length === p.bars && p.harmony.every((c, i) => c.bar === i), 'One ordered harmony entry per bar');
  const coverage = new Uint8Array(p.bars); let bounds = true;
  for (const section of p.arrangement.sections) {
    if (section.startBar + section.bars > p.bars) bounds = false;
    for (let b = section.startBar; b < Math.min(p.bars, section.startBar + section.bars); b++) coverage[b]++;
  }
  check('arrangement_coverage', bounds && coverage.every(c => c === 1), 'Sections cover every bar once with no gaps or overlaps');
  check('prohibited_parts', p.tracks.every(t => !p.brief.prohibitedElements.includes(t.part as 'drums')), 'Prohibited parts are absent');
  check('required_instruments', p.brief.requiredInstruments.every(w => p.tracks.some(t => t.instrument.wave === w)), 'Every required sound family is present');
  let locksPreserved = true;
  try { assertLocks(p); } catch { locksPreserved = false; }
  check('locked_parts', locksPreserved, 'Stored hashes match tracks and owned motifs');
  for (const part of PARTS) if (p.locks[part]) warnings.push(`Locked ${part} is retained even when arrangement instructions change.`);
  const harmonyCompatible = p.harmony.length > 0 && p.harmony[0].degree === 0 && [0, 4].includes(p.harmony.at(-1)!.degree);
  check('loop_harmony', !p.brief.loop || harmonyCompatible, 'Loop begins on tonic and ends on tonic or dominant; this is a heuristic, not a listening judgement');
  check('render_budget', durationSeconds(p) <= 180 && Math.round(durationSeconds(p) * p.renderSettings.sampleRate) * p.tracks.length <= 40_000_000 && noteCount <= 30000, 'Maximum 180 seconds, 40 million track-frames and 30,000 notes per render');
  warnings.push('Musical appeal, genre authenticity and in-game interruption need listening and playtesting.');
  return { status: checks.every(c => c.passed) ? 'passed' : 'failed', scope: 'structure', checks, warnings,
    bars: p.bars, tempo: p.tempo, key: `${p.key} ${p.scale}`, loop: p.brief.loop ? 'not_rendered' : 'not_applicable', locked_parts_preserved: locksPreserved };
}
export function assertValid(input: unknown): asserts input is Project {
  const report = validateProject(input);
  if (report.status !== 'passed') throw new Error(`Project validation failed: ${report.checks.filter(c => !c.passed).map(c => `${c.name}: ${c.detail}`).join('; ')}`);
}

export function validateAudio(p: Project, audio: AudioRender): ValidationReport {
  const report = validateProject(p); report.scope = 'rendered_audio';
  const check = (name: string, passed: boolean, detail: string) => report.checks.push({ name, passed, detail });
  check('exact_frame_count', audio.frames === Math.round(durationSeconds(p) * audio.sampleRate), `${audio.frames} frames at ${audio.sampleRate} Hz`);
  check('non_silent_mix', audio.rmsDb > -65, `${audio.rmsDb.toFixed(2)} dBFS RMS`);
  check('no_clipping', Number.isFinite(audio.peakDb) && audio.peakDb <= -0.49, `${audio.peakDb.toFixed(2)} dBFS peak`);
  check('stem_alignment', Object.values(audio.stems).every(a => a.left.length === audio.frames && a.right.length === audio.frames), 'Every stereo stem begins at frame zero and has exactly the mix length');
  check('finite_samples', [audio.mix, ...Object.values(audio.stems)].every(a => a.left.every(Number.isFinite) && a.right.every(Number.isFinite)), 'Mix and stems contain finite samples');
  const edgeLimit = Math.max(0.01, 4 / Math.max(2, Math.round(p.renderSettings.seamFadeMs / 1000 * audio.sampleRate)));
  check('loop_seam', !p.brief.loop || (audio.seamDelta <= 1 / 32767 && audio.seamEdgeDelta <= edgeLimit), `Endpoint delta ${audio.seamDelta.toFixed(8)}, edge derivative ${audio.seamEdgeDelta.toFixed(6)} (limit ${edgeLimit.toFixed(6)}). Adjacent changes elsewhere in the 10 ms window are diagnostic, since valid treble and percussion can change rapidly.`);
  check('stem_seams', !p.brief.loop || Object.values(audio.stems).every(a => Math.abs(a.left[0] - a.left.at(-1)!) <= 1 / 32767 && Math.abs(a.right[0] - a.right.at(-1)!) <= 1 / 32767), 'Every stem has bounded endpoint discontinuity');
  if (audio.silentWindowCount) report.warnings.push(`${audio.silentWindowCount} quarter-second windows below -70 dBFS; inspect whether these rests suit the brief.`);
  report.status = report.checks.every(c => c.passed) ? 'passed' : 'failed';
  report.loop = p.brief.loop ? report.checks.filter(c => c.name.startsWith('loop_') || c.name === 'stem_seams').every(c => c.passed) ? 'clean' : 'failed' : 'not_applicable';
  return { ...report, stems: Object.keys(audio.stems).length, peak_level: Number(audio.peakDb.toFixed(2)), rms_level: Number(audio.rmsDb.toFixed(2)), frames: audio.frames, duration_seconds: audio.seconds,
    seam_treatment_ms: p.renderSettings.seamFadeMs, silence_windows: audio.silentWindowCount, midi_audio_timbre_match: false };
}
