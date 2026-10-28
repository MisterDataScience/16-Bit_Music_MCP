#!/usr/bin/env node
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMusicBrief, generateTheme, generateVariation, regeneratePart, lockPart, setStyleProfile, setMotif,
  validateProject, validateAudio, renderAudio, renderWav, exportMidi, exportStems, exportPackage, AssetStore,
  BriefInputSchema, ResolvedBriefSchema, PartSchema, HardwareSchema, MotifSchema, STYLES, HARDWARE,
  assertValid, type Project } from './engine/index.js';
import { hash } from './engine/random.js';

const store = new AssetStore(process.env.SYNOD_MUSIC_OUTPUT_DIR ?? path.resolve('output'));
const projects = new Map<string, Project>();
const idSchema = z.string().regex(/^project_[a-f0-9]{24}$/);
const seedSchema = z.number().int().min(0).max(4294967295);
const filenameSchema = z.string().min(1).max(240);
const server = new McpServer({ name: 'synod-16bit-music', version: '0.1.0' }, { maxToolInputElements: 150000 });
function put(project: Project) {
  assertValid(project);
  const id = `project_${hash(project).slice(0, 24)}`;
  if (projects.size >= 64 && !projects.has(id)) throw new Error('Session holds 64 project snapshots. Save projects and restart the server.');
  projects.set(id, project);
  return { projectId: id, title: project.title, revision: project.revision, seed: project.seed, validation: validateProject(project) };
}
function get(id: string): Project {
  const project = projects.get(id);
  if (!project) throw new Error('Unknown projectId. Load a saved project or generate a theme in this session.');
  return project;
}
function tool<T extends z.ZodRawShape>(name: string, description: string, shape: T, handler: (args: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>, readOnly = false) {
  server.registerTool<z.ZodRawShape, z.ZodObject<T>>(name, { description, inputSchema: z.object(shape).strict(), annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } }, async (args) => {
    try {
      const result = await handler(args as z.infer<z.ZodObject<T>>);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error), tool: name }) }] };
    }
  });
}

tool('create_music_brief', 'Interpret a short natural-language brief with deterministic keywords, or use explicit musical parameters. Returns the resolved brief and interpretation limits.', BriefInputSchema.shape, args => ({ brief: createMusicBrief(args) }));
tool('generate_theme', 'Create a complete structured theme. Save the returned projectId. The same resolved brief and seed reproduce the same source.', {
  brief: z.union([ResolvedBriefSchema, BriefInputSchema]), seed: seedSchema.default(18427)
}, args => put(generateTheme(args.brief, args.seed)));
tool('generate_variation', 'Create a new project snapshot while preserving named identity elements and all locked parts. Changes are explicit; tempo and key stay unchanged.', {
  projectId: idSchema, seed: seedSchema.optional(),
  preserve: z.array(z.enum(['primary_motif', 'chord_progression', 'tempo', 'key', 'instrumentation'])).max(5).optional(),
  change: z.array(PartSchema).max(8).optional()
}, args => put(generateVariation(get(args.projectId), args)));
tool('regenerate_part', 'Regenerate one unlocked part. Other note tracks remain unchanged. Arrangement regeneration reapplies layering to unlocked parts.', {
  projectId: idSchema, part: PartSchema, seed: seedSchema.optional()
}, args => put(regeneratePart(get(args.projectId), args.part, args.seed)));
tool('lock_part', 'Lock a part and its owned motif/plan using a content hash.', { projectId: idSchema, part: PartSchema }, args => put(lockPart(get(args.projectId), args.part)));
tool('unlock_part', 'Unlock one part in a new project snapshot.', { projectId: idSchema, part: PartSchema }, args => put(lockPart(get(args.projectId), args.part, false)));
tool('set_style_profile', 'Apply a named musical and/or hardware-inspired sound profile to unlocked parts. Explicit tempo, key and stored motifs are retained.', {
  projectId: idSchema, styleProfile: z.enum(Object.keys(STYLES) as [string, ...string[]]).optional(), hardware: HardwareSchema.optional()
}, args => put(setStyleProfile(get(args.projectId), args.styleProfile, args.hardware)));
tool('set_motif', 'Replace a structured motif and rebuild its unlocked owner tracks. An answer motif is shared by melody and counter-melody.', {
  projectId: idSchema, name: z.enum(['primary', 'answer', 'bass', 'arpeggio', 'rhythmic']), motif: MotifSchema
}, args => put(setMotif(get(args.projectId), args.name, args.motif)));
tool('inspect_project', 'Inspect complete editable source, or list concrete genre constraints and sound palettes when no projectId is supplied.', {
  projectId: idSchema.optional()
}, args => args.projectId ? { project: get(args.projectId), validation: validateProject(get(args.projectId)) } : { styles: STYLES, hardware: HARDWARE, sessionProjects: projects.size, outputDirectory: store.root }, true);
tool('validate_project', 'Validate schema, key, instrument ranges, grid, timing, arrangement, required sounds and lock hashes without rendering.', {
  projectId: idSchema
}, args => validateProject(get(args.projectId)), true);
tool('validate_loop', 'Render locally and inspect exact frames, seam discontinuity, stem alignment, silence and clipping. Cadence compatibility is a documented heuristic.', {
  projectId: idSchema
}, args => { const p = get(args.projectId); assertValid(p); return validateAudio(p, renderAudio(p)); }, true);
tool('render_wav', 'Render and validate a stereo PCM16 WAV. Filename is relative to the output directory. Existing files are never overwritten.', {
  projectId: idSchema, filename: filenameSchema
}, args => renderWav(get(args.projectId), store, args.filename));
tool('export_midi', 'Export format-1 editable MIDI, with tempo, signature, instruments, pan, velocity and aligned end markers. Synth effects and audio timbre are not encoded.', {
  projectId: idSchema, filename: filenameSchema
}, async args => ({ file: await store.write(args.filename, exportMidi(get(args.projectId))) }));
tool('export_stems', 'Export lead, harmony, bass, drums and effects stems present in the project, using the same mix gain and exact frame count.', {
  projectId: idSchema, directory: filenameSchema
}, args => exportStems(get(args.projectId), store, args.directory));
tool('save_project', 'Save complete versioned JSON source, including notes, motifs, locks, arrangement, sound definitions and seed.', {
  projectId: idSchema, filename: filenameSchema
}, async args => ({ file: await store.saveProject(get(args.projectId), args.filename) }));
tool('load_project', 'Load and validate a version-1 JSON project within the output directory. Saved audio is not required.', {
  filename: filenameSchema
}, async args => put(await store.loadProject(args.filename)));
tool('export_package', 'Create a validated department handover: mix, MIDI, stems, project JSON, validation report and checksummed gameplay manifest.', {
  projectId: idSchema, directory: filenameSchema
}, args => exportPackage(get(args.projectId), store, args.directory));

await server.connect(new StdioServerTransport());
process.once('SIGINT', () => { void server.close().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void server.close().then(() => process.exit(0)); });
