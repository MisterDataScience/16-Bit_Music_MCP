import { random } from './random.js';
import { createMusicBrief } from './brief.js';
import { STYLES, instrumentFor } from './profiles.js';
import { ProjectSchema, ResolvedBriefSchema, MotifsSchema, PPQ, degreePitch, ticksPerBar, totalTicks, type MusicBrief, type Project, type Motif, type Track, type Part, type Note } from './model.js';

function makeMotifs(brief: MusicBrief, seed: number): Project['motifs'] {
  const s = STYLES[brief.styleProfile];
  const rng = random(seed, 'motifs');
  const barTicks = ticksPerBar(brief), ticks = barTicks * 2;
  const events: Motif['events'] = [];
  let degree = rng.pick([0, 2, 4]);
  for (let offset = 0; offset < ticks;) {
    const duration = Math.min(ticks - offset, rng.pick(s.density < 0.5 ? [480, 720, 960] : [120, 240, 240, 480]));
    if (offset === 0 || rng.chance(1 - s.rests)) {
      events.push({ offset, duration: Math.max(60, Math.floor(duration * 0.8)), degree, velocity: rng.int(82, 106) });
      degree += rng.int(-s.leap, s.leap) + (s.descending ? -1 : 0);
      degree = Math.max(-2, Math.min(s.leap <= 1 ? 4 : 9, degree));
    }
    offset += duration;
  }
  return MotifsSchema.parse({
    primary: { ticks, events },
    answer: { ticks, events: events.map((n, i) => ({ ...n, degree: i === events.length - 1 ? 0 : Math.max(-2, Math.min(10, n.degree + (i % 2 ? -1 : 2))), velocity: n.velocity - 6 })) },
    bass: { ticks: barTicks, events: (s.sustainBass ? [0] : [0, 480, 960]).filter(t => t < barTicks).map(offset => ({ offset, duration: s.sustainBass ? barTicks - 60 : 240, degree: offset === 480 ? 4 : 0, velocity: 92 })) },
    arpeggio: { ticks: 480, events: [0, 2, 4, 2].map((degree, i) => ({ offset: i * 120, duration: 90, degree, velocity: 65 + i * 4 })) },
    rhythmic: { ticks: barTicks, events: Array.from({ length: barTicks / 240 }, (_, i) => ({ offset: i * 240, duration: 60, degree: i % 2 ? 1 : 0, velocity: i % 2 ? 55 : 85 })) }
  });
}

export function planHarmony(brief: MusicBrief, seed: number): Project['harmony'] {
  const rng = random(seed, 'harmony');
  const s = STYLES[brief.styleProfile];
  // Functional transition grammar, with phrase cadences, suspensions and voice leading.
  const transitions: Record<number, number[]> = { 0: [1, 3, 4, 5], 1: [4, 6], 2: [3, 5], 3: [0, 1, 4], 4: [0, 5], 5: [1, 3, 4], 6: [0, 2] };
  let degree = 0;
  return Array.from({ length: brief.bars }, (_, bar) => {
    if (bar > 0 && bar % 2 === 0) degree = rng.pick(transitions[degree]);
    if (bar === brief.bars - 1) degree = brief.loop ? 4 : 0;
    if (bar === 0) degree = 0;
    const suspension = s.density < 0.5 && rng.chance(0.35);
    const inversion = rng.pick([0, 0, 1, 2]);
    const pitches = [degree, degree + (suspension ? 3 : 2), degree + 4].map(d => degreePitch(d, brief.key, brief.scale, 3));
    if (s.tension > 0.6 && rng.chance(s.tension / 2)) pitches.push(degreePitch(degree + 6, brief.key, brief.scale, 3));
    for (let i = 0; i < inversion; i++) pitches[i] += 12;
    // Optional parallel-minor colour is explicitly annotated for validation.
    const borrowed = brief.scale === 'major' && degree === 3 && s.tension > 0.5 && !brief.prohibitedElements.includes('chromatic_notes') && rng.chance(0.25);
    if (borrowed) pitches[1] -= 1;
    return { bar, degree, pitches: pitches.sort((a, b) => a - b), inversion, suspension, borrowed };
  });
}

export function planArrangement(brief: MusicBrief): Project['arrangement'] {
  if (brief.sections) return { sections: structuredClone(brief.sections), swing: STYLES[brief.styleProfile].swing };
  const sections: Project['arrangement']['sections'] = [];
  const width = Math.max(1, Math.ceil(brief.bars / 4));
  for (let startBar = 0; startBar < brief.bars; startBar += width) {
    const index = Math.floor(startBar / width), count = Math.ceil(brief.bars / width);
    const curveIndex = count <= 1 ? 0 : Math.round(index / (count - 1) * (brief.intensityCurve.length - 1));
    const intensity = brief.intensityCurve[curveIndex];
    const activeParts: Exclude<Part, 'arrangement'>[] = ['melody', 'bass', 'harmony'];
    if (intensity >= 0.3) activeParts.push('drums');
    if (intensity >= 0.4) activeParts.push('arpeggio');
    if (intensity >= 0.6) activeParts.push('counter_melody');
    if (intensity >= 0.7) activeParts.push('effects');
    sections.push({ startBar, bars: Math.min(width, brief.bars - startBar), intensity,
      type: !brief.loop ? (index === 0 ? 'stinger' : 'outro') : index === 2 ? 'breakdown' : index === 3 ? 'escalation' : 'main_loop',
      activeParts: activeParts.filter(p => !brief.prohibitedElements.includes(p as 'drums')) });
  }
  return { sections, swing: STYLES[brief.styleProfile].swing };
}

function inRange(pitch: number, range: [number, number]): number {
  while (pitch < range[0]) pitch += 12;
  while (pitch > range[1]) pitch -= 12;
  if (pitch < range[0] || pitch > range[1]) throw new Error('No pitch fits the instrument range');
  return pitch;
}

export function composePart(p: Project, part: Exclude<Part, 'arrangement'>, revisionSeed = p.seed): Track {
  const existing = p.tracks.find(t => t.part === part);
  const instrument = existing?.instrument ?? instrumentFor(part, p.brief.hardware);
  const s = STYLES[p.styleProfile], rng = random(revisionSeed, `part:${part}`);
  const barTicks = ticksPerBar(p), length = totalTicks(p);
  const notes: Note[] = [];
  const add = (tick: number, duration: number, pitch: number, velocity = 88, chromatic = false, slide = 0) => {
    tick = Math.round(tick); duration = Math.max(1, Math.min(Math.round(duration), length - tick));
    if (tick < length) notes.push({ tick, duration, pitch: inRange(pitch, instrument.range), velocity: Math.max(1, Math.min(127, Math.round(velocity))), slide, chromatic });
  };
  for (let bar = 0; bar < p.bars; bar++) {
    const section = p.arrangement.sections.find(x => bar >= x.startBar && bar < x.startBar + x.bars);
    if (!section || !section.activeParts.includes(part)) continue;
    const intensity = section.intensity, chord = p.harmony[bar], start = bar * barTicks;
    if (part === 'harmony') {
      for (const pitch of chord.pitches) add(start, barTicks - 30, pitch, 66 + intensity * 14, chord.borrowed);
    } else if (part === 'melody' || part === 'counter_melody') {
      const motif = part === 'counter_melody' ? p.motifs.answer : Math.floor(bar / 2) % 4 === 3 ? p.motifs.answer : p.motifs.primary;
      const phase = (bar * barTicks) % motif.ticks;
      for (const event of motif.events) {
        if (event.offset < phase || event.offset >= phase + barTicks) continue;
        const local = event.offset - phase;
        let degree = event.degree + (part === 'counter_melody' ? -7 : 0);
        // Anchor near the motif's register, rather than introducing an octave jump.
        if (local === 0) {
          const chordDegrees = [-14, -7, 0, 7, 14].flatMap(octave => [chord.degree + octave, chord.degree + 2 + octave, chord.degree + 4 + octave]);
          degree = chordDegrees.sort((a, b) => Math.abs(a - degree) - Math.abs(b - degree) || a - b)[0];
        }
        const pitch = degreePitch(degree, p.key, p.scale, 4);
        add(start + local, Math.min(event.duration, barTicks - local), pitch, event.velocity * (0.8 + intensity * 0.2));
      }
    } else if (part === 'bass') {
      for (const n of p.motifs.bass.events) {
        const offset = n.offset % barTicks;
        add(start + offset, Math.min(n.duration, barTicks - offset - 12), degreePitch(chord.degree + n.degree, p.key, p.scale, 2), n.velocity * (0.85 + intensity * 0.15));
        if (!s.sustainBass && intensity > 0.6 && rng.chance(s.syncopation)) add(start + Math.min(offset + 360, barTicks - 120), 90, degreePitch(chord.degree, p.key, p.scale, 2), 78);
      }
    } else if (part === 'arpeggio') {
      for (let tick = 0; tick < barTicks; tick += p.motifs.arpeggio.ticks) for (const event of p.motifs.arpeggio.events) {
        const offset = tick + event.offset;
        if (offset < barTicks && rng.chance(0.45 + s.density * 0.5)) add(start + offset, Math.min(event.duration, barTicks - offset), degreePitch(chord.degree + event.degree, p.key, p.scale, 4), event.velocity);
      }
    } else if (part === 'drums') {
      const steps = barTicks / 120;
      for (let step = 0; step < steps; step++) {
        const tick = step * 120 + (step % 4 === 2 ? Math.round(p.arrangement.swing * 240) : 0);
        const beat = step / 4;
        const fill = bar % 4 === 3 && step >= steps - 4;
        const hook = p.motifs.rhythmic.events.find(n => n.offset === (step * 120) % p.motifs.rhythmic.ticks);
        const kick = Boolean(hook && hook.degree % 2 === 0 && (step === 0 || rng.chance(s.percussion))) || (step % 4 === 3 && rng.chance(s.syncopation * s.percussion));
        if (kick) add(start + tick, 100, 36, 90 + intensity * 15);
        if ((Number.isInteger(beat) && beat % 2 === 1 && rng.chance(s.percussion + 0.15)) || (fill && rng.chance(s.percussion * 0.6))) add(start + tick, 100, 38, fill ? 70 + step : 96);
        if (hook && rng.chance(s.percussion * (0.3 + intensity * 0.7))) add(start + tick, Math.min(55, hook.duration), 42, Math.min(100, hook.velocity));
      }
    } else if (part === 'effects' && bar % 4 === 3) {
      add(start + barTicks - 480, 420, 72, 38, false, 0);
    }
  }
  const stem = part === 'melody' || part === 'counter_melody' ? 'lead' : part === 'arpeggio' ? 'harmony' : part;
  return { id: part, part, stem, instrument, notes: notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch),
    volume: existing?.volume ?? (part === 'harmony' ? 0.3 : part === 'effects' ? 0.18 : part === 'drums' ? 0.55 : 0.45),
    pan: existing?.pan ?? (part === 'counter_melody' ? -0.3 : part === 'arpeggio' ? 0.35 : 0),
    midiProgram: existing?.midiProgram ?? (part === 'bass' ? 38 : part === 'harmony' ? 89 : 80) };
}

export function generateTheme(input: unknown, seed = 18427): Project {
  const resolved = ResolvedBriefSchema.safeParse(input);
  const brief = resolved.success ? resolved.data : createMusicBrief(input);
  const p: Project = ProjectSchema.parse({ version: 1, engineVersion: '0.1.0', title: brief.title, seed,
    tempo: brief.tempo, key: brief.key, scale: brief.scale, timeSignature: brief.timeSignature, bars: brief.bars,
    styleProfile: brief.styleProfile, brief, motifs: makeMotifs(brief, seed), harmony: planHarmony(brief, seed),
    tracks: [{ id: 'melody', part: 'melody', stem: 'lead', instrument: instrumentFor('melody', brief.hardware), notes: [], volume: 0.45, pan: 0, midiProgram: 80 }],
    arrangement: planArrangement(brief), renderSettings: {}, locks: {}, revision: 0, provenance: { operation: 'generate_theme' }, validation: {} });
  p.tracks = (['melody', 'counter_melody', 'bass', 'harmony', 'drums', 'arpeggio', 'effects'] as const)
    .filter(part => !brief.prohibitedElements.includes(part as 'drums')).map(part => composePart(p, part));
  for (const wave of brief.requiredInstruments) {
    if (p.tracks.some(t => t.instrument.wave === wave)) continue;
    const candidate = wave === 'sample' ? p.tracks.find(t => t.part === 'drums') : wave === 'noise' ? p.tracks.find(t => t.part === 'effects') : p.tracks.find(t => t.part !== 'drums' && t.part !== 'effects' && !brief.requiredInstruments.includes(t.instrument.wave));
    if (!candidate) throw new Error(`Cannot fulfil required instrument ${wave} with the allowed parts`);
    candidate.instrument.wave = wave;
  }
  return ProjectSchema.parse(p);
}
