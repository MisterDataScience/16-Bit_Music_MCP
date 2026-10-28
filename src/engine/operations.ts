import { hash } from './random.js';
import { composePart, generateTheme, planArrangement } from './compose.js';
import { createMusicBrief } from './brief.js';
import { STYLES, instrumentFor } from './profiles.js';
import { ProjectSchema, PartSchema, MotifSchema, PARTS, type Project, type Part } from './model.js';

export function partContent(p: Project, part: Part): unknown {
  if (part === 'arrangement') return p.arrangement;
  return {
    tracks: p.tracks.filter(t => t.part === part),
    ...(part === 'melody' ? { primary: p.motifs.primary, answer: p.motifs.answer } : {}),
    ...(part === 'counter_melody' ? { answer: p.motifs.answer } : {}),
    ...(part === 'harmony' ? { harmony: p.harmony } : {}),
    ...(part === 'bass' ? { motif: p.motifs.bass } : {}),
    ...(part === 'arpeggio' ? { motif: p.motifs.arpeggio } : {}),
    ...(part === 'drums' ? { motif: p.motifs.rhythmic } : {})
  };
}
export const partHash = (p: Project, part: Part) => hash(partContent(p, part));
export function assertLocks(p: Project): void {
  for (const part of PARTS) if (p.locks[part] && partHash(p, part) !== p.locks[part]) throw new Error(`Locked part was changed: ${part}`);
}
function revised(input: Project, operation: string): Project {
  const p = ProjectSchema.parse(input); assertLocks(p);
  p.revision++;
  p.provenance = { parentHash: hash(input), operation };
  p.validation = {};
  return p;
}
function finish(p: Project): Project { assertLocks(p); return ProjectSchema.parse(p); }

export function lockPart(input: Project, part: Part, locked = true): Project {
  PartSchema.parse(part);
  const p = revised(input, `${locked ? 'lock' : 'unlock'}_part:${part}`);
  if (locked) p.locks[part] = partHash(p, part); else delete p.locks[part];
  return finish(p);
}

export function regeneratePart(input: Project, part: Part, seed?: number): Project {
  PartSchema.parse(part);
  const p = revised(input, `regenerate_part:${part}`);
  if (p.locks[part]) throw new Error(`Part is locked: ${part}. Unlock it first.`);
  const variationSeed = seed ?? (p.seed + p.revision * 7919) >>> 0;
  if (part === 'arrangement') {
    p.brief.intensityCurve = p.brief.intensityCurve.map((v, i) => Math.max(0.2, Math.min(1, v + ((variationSeed + i) % 3 - 1) * 0.16)));
    delete p.brief.sections;
    p.arrangement = planArrangement(p.brief);
    // Arrangement edits must never rewrite locked note data.
    for (const track of p.tracks) if (!p.locks[track.part]) Object.assign(track, composePart(p, track.part, variationSeed));
  } else {
    const track = p.tracks.find(t => t.part === part);
    if (!track) throw new Error(`Part is absent or prohibited: ${part}`);
    if (part === 'melody' || part === 'counter_melody') {
      const newMotifs = generateTheme(p.brief, variationSeed).motifs;
      if (part === 'melody') {
        // answer is also used by the main tune, so a counter-melody lock protects it.
        if (p.locks.counter_melody) throw new Error('The answer motif is protected by the counter_melody lock');
        p.motifs.primary = newMotifs.primary; p.motifs.answer = newMotifs.answer;
      } else {
        if (p.locks.melody) throw new Error('The answer motif is protected by the melody lock');
        p.motifs.answer = newMotifs.answer;
      }
    }
    if (part === 'bass') {
      p.motifs.bass.events = p.motifs.bass.events.map((n, i) => ({ ...n, duration: Math.max(60, n.duration - (variationSeed % 3 + 1) * 24), velocity: 78 + ((variationSeed + i * 7) % 24) }));
    }
    if (part === 'harmony') {
      // Revoice the stored progression without silently changing other parts' harmony.
      p.harmony = p.harmony.map((chord, i) => ({ ...chord, inversion: ((chord.inversion + 1 + variationSeed % 2) % 3), pitches: chord.pitches.map((pitch, j) => j === (variationSeed + i) % chord.pitches.length ? pitch + (pitch < 65 ? 12 : -12) : pitch).sort((a, b) => a - b) }));
    }
    Object.assign(track, composePart(p, part, variationSeed));
  }
  return finish(p);
}

export type Preserve = 'primary_motif' | 'chord_progression' | 'tempo' | 'key' | 'instrumentation';
export function generateVariation(input: Project, options: {seed?: number; preserve?: Preserve[]; change?: Part[]} = {}): Project {
  ProjectSchema.parse(input); assertLocks(input);
  const preserve = options.preserve ?? ['primary_motif', 'chord_progression', 'tempo', 'key', 'instrumentation'];
  const changes = options.change ?? ['bass', 'drums', 'counter_melody', 'arrangement'];
  if (preserve.includes('primary_motif') && changes.includes('melody')) throw new Error('Cannot change melody while preserving the primary motif');
  let p = structuredClone(input);
  const seed = options.seed ?? (p.seed + (p.revision + 1) * 7919) >>> 0;
  for (const part of changes) {
    PartSchema.parse(part);
    if (p.locks[part]) continue;
    // The primary tune uses the answer motif, so identity preservation keeps both.
    if (part === 'counter_melody' && (preserve.includes('primary_motif') || p.locks.melody)) {
      const next = revised(p, 'generate_variation:counter_melody');
      const track = next.tracks.find(t => t.part === part);
      if (track) { track.notes = track.notes.map((n, i) => ({ ...n, velocity: Math.max(1, n.velocity - 5 + (seed + i) % 11) })); }
      p = finish(next);
    } else if (part === 'harmony' && preserve.includes('chord_progression')) {
      const next = revised(p, 'generate_variation:harmony_voicing');
      const track = next.tracks.find(t => t.part === part);
      if (track) track.notes = track.notes.map(n => ({ ...n, velocity: 54 + (seed + n.tick) % 18 }));
      p = finish(next);
    } else if (part === 'arrangement') {
      // Keep notes of every unchanged part, as well as locks, byte-for-byte stable.
      const next = regeneratePart(p, part, seed);
      for (const track of next.tracks) if (!changes.includes(track.part) || p.locks[track.part]) Object.assign(track, structuredClone(p.tracks.find(t => t.id === track.id)!));
      p = finish(next);
    } else if (p.tracks.some(t => t.part === part)) p = regeneratePart(p, part, seed);
  }
  p.provenance = { parentHash: hash(input), operation: `generate_variation:${changes.join(',')}:seed=${seed}` };
  // Preservation is verified, rather than merely described in metadata.
  if (preserve.includes('primary_motif') && hash([p.motifs.primary, p.motifs.answer]) !== hash([input.motifs.primary, input.motifs.answer])) throw new Error('Variation failed motif preservation');
  if (preserve.includes('chord_progression') && hash(p.harmony) !== hash(input.harmony)) throw new Error('Variation failed harmony preservation');
  if (preserve.includes('instrumentation') && hash(p.tracks.map(t => t.instrument)) !== hash(input.tracks.map(t => t.instrument))) throw new Error('Variation failed instrument preservation');
  return finish(p);
}

export function setMotif(input: Project, name: keyof Project['motifs'], motifInput: unknown): Project {
  const owner: Record<keyof Project['motifs'], Part[]> = { primary: ['melody'], answer: ['melody', 'counter_melody'], bass: ['bass'], arpeggio: ['arpeggio'], rhythmic: ['drums'] };
  if (!Object.hasOwn(owner, name)) throw new Error('Unknown motif name');
  const p = revised(input, `set_motif:${name}`);
  for (const part of owner[name]) if (p.locks[part]) throw new Error(`Motif belongs to locked part: ${part}`);
  p.motifs[name] = MotifSchema.parse(motifInput);
  for (const part of owner[name]) {
    const track = p.tracks.find(t => t.part === part);
    if (track) Object.assign(track, composePart(p, track.part));
  }
  return finish(p);
}

export function setStyleProfile(input: Project, styleProfile?: string, hardware?: Project['brief']['hardware']): Project {
  const p = revised(input, 'set_style_profile');
  if (styleProfile && !STYLES[styleProfile]) throw new Error(`Unknown style profile: ${styleProfile}`);
  p.brief = createMusicBrief({ ...Object.fromEntries(Object.entries(p.brief).filter(([key]) => key !== 'interpretation')), styleProfile: styleProfile ?? p.styleProfile, hardware: hardware ?? p.brief.hardware });
  p.styleProfile = p.brief.styleProfile;
  if (!p.locks.arrangement) p.arrangement = planArrangement(p.brief);
  for (const track of p.tracks) if (!p.locks[track.part]) {
    if (hardware) track.instrument = instrumentFor(track.part, hardware);
    Object.assign(track, composePart(p, track.part, p.seed + p.revision));
  }
  return finish(p);
}
