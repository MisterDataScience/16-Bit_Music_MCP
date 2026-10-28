import { z } from 'zod';

export const PPQ = 480;
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10]
} as const;
export const KEYS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 } as const;
export const PARTS = ['melody', 'counter_melody', 'bass', 'harmony', 'drums', 'arpeggio', 'effects', 'arrangement'] as const;
export const PartSchema = z.enum(PARTS);
export type Part = z.infer<typeof PartSchema>;
export const HardwareSchema = z.enum(['snes', 'mega_drive', 'pc98', 'fm_towns', 'fantasy', 'action', 'modern_retro']);
export const WaveSchema = z.enum(['pulse', 'triangle', 'saw', 'fm_ep', 'fm_bell', 'wavetable', 'sample', 'noise', 'bass', 'pad', 'filtered_lead']);
export const NoteSchema = z.object({
  tick: z.number().int().min(0).max(250000), duration: z.number().int().min(1).max(250000),
  pitch: z.number().int().min(0).max(127), velocity: z.number().int().min(1).max(127),
  slide: z.number().min(-24).max(24).default(0),
  chromatic: z.boolean().default(false)
}).strict();
export const InstrumentSchema = z.object({
  wave: WaveSchema, duty: z.number().min(0.05).max(0.95).default(0.5),
  attack: z.number().min(0.001).max(2).default(0.008),
  decay: z.number().min(0.001).max(3).default(0.12),
  sustain: z.number().min(0).max(1).default(0.55),
  release: z.number().min(0.001).max(3).default(0.09),
  vibrato: z.number().min(0).max(100).default(5),
  vibratoHz: z.number().min(0.1).max(15).default(5),
  portamento: z.number().min(0).max(1).default(0),
  lowpass: z.number().min(100).max(22000).default(9000),
  highpass: z.number().min(0).max(4000).default(0),
  delay: z.number().min(0).max(0.5).default(0.08),
  reverb: z.number().min(0).max(0.5).default(0.08),
  chorus: z.number().min(0).max(0.4).default(0),
  bitDepth: z.number().int().min(4).max(16).default(16),
  sampleHold: z.number().int().min(1).max(12).default(1),
  range: z.tuple([z.number().int().min(0).max(127), z.number().int().min(0).max(127)])
}).strict().refine(i => i.range[0] <= i.range[1], { message: 'Instrument range must be ascending' });
export const TrackSchema = z.object({
  id: z.string().regex(/^[a-z_]{1,32}$/), part: PartSchema.exclude(['arrangement']),
  stem: z.enum(['lead', 'harmony', 'bass', 'drums', 'effects', 'ambience']),
  instrument: InstrumentSchema, notes: z.array(NoteSchema).max(20000),
  volume: z.number().min(0).max(1), pan: z.number().min(-1).max(1),
  midiProgram: z.number().int().min(0).max(127)
}).strict();
export const SectionSchema = z.object({
  type: z.enum(['intro', 'main_loop', 'breakdown', 'escalation', 'boss_phase', 'outro', 'stinger']),
  startBar: z.number().int().min(0), bars: z.number().int().min(1), intensity: z.number().min(0).max(1),
  activeParts: z.array(PartSchema.exclude(['arrangement'])).max(7)
}).strict();
export const BriefInputSchema = z.object({
  text: z.string().max(4000).default(''), title: z.string().min(1).max(120).optional(),
  gameplayPurpose: z.string().max(500).optional(), genre: z.string().max(120).optional(),
  mood: z.string().max(120).optional(), emotionalDirection: z.string().max(500).optional(),
  tempo: z.number().min(40).max(240).optional(), key: z.enum(Object.keys(KEYS) as [keyof typeof KEYS, ...Array<keyof typeof KEYS>]).optional(),
  scale: z.enum(Object.keys(SCALES) as [keyof typeof SCALES, ...Array<keyof typeof SCALES>]).optional(),
  timeSignature: z.enum(['4/4', '3/4', '6/8']).default('4/4'), bars: z.number().int().min(1).max(128).optional(),
  styleProfile: z.string().max(80).optional(), hardware: HardwareSchema.optional(),
  requiredInstruments: z.array(WaveSchema).max(7).default([]),
  prohibitedElements: z.array(z.enum(['drums', 'arpeggio', 'counter_melody', 'effects', 'chromatic_notes'])).max(5).default([]),
  intensityCurve: z.array(z.number().min(0).max(1)).min(1).max(128).optional(),
  sections: z.array(SectionSchema).min(1).max(32).optional(), loop: z.boolean().default(true)
}).strict();
export const ResolvedBriefSchema = z.object({
  title: z.string().min(1).max(120), text: z.string().max(4000), gameplayPurpose: z.string().max(500),
  genre: z.string().max(120), mood: z.string().max(120), emotionalDirection: z.string().max(500),
  tempo: z.number().min(40).max(240), key: z.enum(Object.keys(KEYS) as [keyof typeof KEYS, ...Array<keyof typeof KEYS>]),
  scale: z.enum(Object.keys(SCALES) as [keyof typeof SCALES, ...Array<keyof typeof SCALES>]),
  timeSignature: z.enum(['4/4', '3/4', '6/8']), bars: z.number().int().min(1).max(128),
  styleProfile: z.string().max(80), hardware: HardwareSchema,
  requiredInstruments: z.array(WaveSchema).max(7),
  prohibitedElements: BriefInputSchema.shape.prohibitedElements,
  intensityCurve: z.array(z.number().min(0).max(1)).min(1).max(128),
  sections: z.array(SectionSchema).min(1).max(32).optional(), loop: z.boolean(),
  interpretation: z.array(z.string().max(300)).max(30)
}).strict();
export const MotifSchema = z.object({
  ticks: z.number().int().min(120).max(15360),
  events: z.array(z.object({ offset: z.number().int().min(0), duration: z.number().int().min(1), degree: z.number().int().min(-21).max(21), velocity: z.number().int().min(1).max(127) }).strict()).min(1).max(128)
}).strict().superRefine((m, ctx) => {
  for (const n of m.events) if (n.offset + n.duration > m.ticks) ctx.addIssue({ code: 'custom', message: 'Motif events must fit its tick length' });
});
export const MotifsSchema = z.object({ primary: MotifSchema, answer: MotifSchema, bass: MotifSchema, arpeggio: MotifSchema, rhythmic: MotifSchema }).strict();
export const HarmonySchema = z.array(z.object({
  bar: z.number().int().min(0), degree: z.number().int().min(0).max(6),
  pitches: z.array(z.number().int().min(0).max(127)).min(2).max(5),
  inversion: z.number().int().min(0).max(2), suspension: z.boolean(), borrowed: z.boolean()
}).strict()).min(1).max(128);
export const RenderSettingsSchema = z.object({
  sampleRate: z.union([z.literal(8000), z.literal(16000), z.literal(22050), z.literal(32000), z.literal(44100), z.literal(48000)]).default(32000),
  peakDb: z.number().min(-12).max(-0.5).default(-1.2),
  seamFadeMs: z.number().min(1).max(10).default(3)
}).strict();
export const ProjectSchema = z.object({
  version: z.literal(1), engineVersion: z.literal('0.1.0'), title: z.string().min(1).max(120),
  seed: z.number().int().min(0).max(4294967295), tempo: z.number().min(40).max(240),
  key: ResolvedBriefSchema.shape.key, scale: ResolvedBriefSchema.shape.scale,
  timeSignature: ResolvedBriefSchema.shape.timeSignature, bars: z.number().int().min(1).max(128),
  styleProfile: z.string().max(80), brief: ResolvedBriefSchema, motifs: MotifsSchema,
  harmony: HarmonySchema, tracks: z.array(TrackSchema).min(1).max(7),
  arrangement: z.object({ sections: z.array(SectionSchema).min(1).max(32), swing: z.number().min(0).max(0.45) }).strict(),
  renderSettings: RenderSettingsSchema,
  locks: z.partialRecord(PartSchema, z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  revision: z.number().int().min(0), provenance: z.object({ parentHash: z.string().optional(), operation: z.string().max(200) }).strict(),
  validation: z.record(z.string(), z.unknown()).default({})
}).strict();
export type MusicBrief = z.infer<typeof ResolvedBriefSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
export type Motif = z.infer<typeof MotifSchema>;
export const ticksPerBar = (p: {timeSignature: string}) => p.timeSignature === '3/4' ? 1440 : p.timeSignature === '6/8' ? 1440 : 1920;
export const totalTicks = (p: {timeSignature: string; bars: number}) => ticksPerBar(p) * p.bars;
export const durationSeconds = (p: {timeSignature: string; bars: number; tempo: number}) => totalTicks(p) / PPQ * 60 / p.tempo;
export function degreePitch(degree: number, key: keyof typeof KEYS, scale: keyof typeof SCALES, octave = 4): number {
  const step = ((degree % 7) + 7) % 7;
  return 12 * (octave + 1) + KEYS[key] + SCALES[scale][step] + 12 * Math.floor(degree / 7);
}
