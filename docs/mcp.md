# MCP workflow and arguments

The server uses the official MCP SDK over stdio. It does not serve HTTP. Start it with `node /absolute/path/dist/server.js`. Set `SYNOD_MUSIC_OUTPUT_DIR` to the local directory where source and exports belong. With no setting, it uses `output` under the process working directory.

Every edit returns a **new immutable session snapshot** and its `projectId`. The previous ID remains usable. IDs are content-derived, and identical source gives the same ID. There is a hard limit of 64 snapshots, with no silent eviction. Save projects and restart when the limit is reached.

Errors are MCP tool results with `isError: true` and a JSON message. Diagnostics do not go to stdout. All input schemas are strict Zod objects. Tool annotations declare a closed local world and no destructive changes.

## Brief and generation

`create_music_brief` accepts these fields. All except `text` are optional.

| Field | Values |
| --- | --- |
| `text` | Up to 4,000 characters, default empty |
| `title` | 1 to 120 characters |
| `gameplayPurpose`, `emotionalDirection` | Up to 500 characters each |
| `genre`, `mood` | Up to 120 characters each, used for keyword profile selection |
| `styleProfile` | A key returned by `inspect_project` |
| `hardware` | `snes`, `mega_drive`, `pc98`, `fm_towns`, `fantasy`, `action`, `modern_retro` |
| `tempo` | 40 to 240 quarter notes per minute |
| `key` | C to B with recognised sharp or flat spellings |
| `scale` | `major`, `minor`, `dorian`, `harmonic_minor`, `mixolydian`, `phrygian` |
| `timeSignature` | `4/4`, `3/4`, `6/8` |
| `bars` | Integer from 1 to 128, also subject to render budget |
| `requiredInstruments` | Sound families from the project-format guide |
| `prohibitedElements` | `drums`, `arpeggio`, `counter_melody`, `effects`, `chromatic_notes` |
| `intensityCurve` | Values from 0 to 1 used across arrangement sections |
| `sections` | Optional explicit contiguous sections, described in the project format |
| `loop` | Boolean, default true. Victory and defeat profiles produce non-looping cues |

The response is `{ "brief": { ...resolvedFields, "interpretation": [...] } }`.

Call `generate_theme` with `{ "brief": <resolved brief or input fields>, "seed": 18427 }`. Seeds are unsigned 32-bit integers. The engine version, resolved brief and seed determine the output. Exact source/MIDI determinism is tested. PCM is repeatable within the same Node/platform environment; tiny floating-point differences across engines or architectures are not promised away.

## Revision tools

Parts are `melody`, `counter_melody`, `bass`, `harmony`, `drums`, `arpeggio`, `effects`, `arrangement`.

`lock_part` and `unlock_part` take `projectId` and `part`. Locks cover note data, instrumentation and owned motifs/plans. Melody owns both the primary and answer motifs. The answer is shared with counter-melody, so editing it requires both owners to be unlocked. Harmony owns its harmonic plan; arrangement owns its sections and swing. Locking arrangement does not lock every note track.

`regenerate_part` takes `projectId`, `part` and optional `seed`. It rejects a locked part. A note-part revision changes that track and its owned data, leaving the other tracks unchanged. Harmony regeneration revoices the existing progression, keeping its functional roots. Arrangement regeneration reapplies layering to unlocked tracks and retains locked tracks byte for byte. The saved notes remain the authoritative event data.

`generate_variation` accepts:

```json
{
  "projectId": "project_<24 hexadecimal characters>",
  "seed": 731,
  "preserve": ["primary_motif", "chord_progression", "tempo", "key", "instrumentation"],
  "change": ["bass", "drums", "counter_melody", "arrangement"]
}
```

Those arrays are also the defaults. Locked parts are skipped. Preserving the primary motif retains the answer motif as well, because both occur in the main tune. A counter-melody variation in that mode changes expression without replacing the shared answer. Harmony preservation allows velocity/expression changes, retaining the full chord plan. A request to regenerate the main melody while preserving its motif is rejected as contradictory. Tempo and key remain unchanged in this version, regardless of the preservation list. Removing a preservation entry permits changes; it does not require the engine to invent a change outside the requested parts.

`set_motif` takes `projectId`, `name` (`primary`, `answer`, `bass`, `arpeggio`, `rhythmic`) and `motif`: `{ "ticks": 1920, "events": [{ "offset": 0, "duration": 480, "degree": 0, "velocity": 90 }] }`. Events must fit the motif, use valid scale degrees and lead to notes on the project grid. Relative degrees are interpreted in the current key and mode.

`set_style_profile` takes `projectId`, optional `styleProfile` and optional `hardware`. It preserves explicit tempo, key and stored motifs, and reapplies style and/or sound settings to unlocked parts. Locks can retain an older sound palette. The resulting project is validated, including required instruments.

## Inspection and validation

- `inspect_project {}` lists full style constraints and hardware palettes.
- `inspect_project { "projectId": "..." }` returns the complete source and structural report.
- `validate_project { "projectId": "..." }` performs structural checks only.
- `validate_loop { "projectId": "..." }` renders in memory and returns the audio report. No files are written.

## Files

- `render_wav`: `projectId`, `filename` such as `drafts/theme.wav`.
- `export_midi`: `projectId`, `filename` such as `drafts/theme.mid`.
- `export_stems`: `projectId`, `directory` such as `drafts/stems`.
- `save_project`: `projectId`, `filename` such as `sources/theme-r2.json`.
- `load_project`: `filename`, relative to the configured output root.
- `export_package`: `projectId`, `directory` such as `approved/theme-r2`.

Only relative paths within the configured output root are accepted. Parent traversal, absolute paths, backslashes and symbolic links are rejected. Writes use exclusive creation. A failed multi-file export may leave partial files if the disk or process fails; retry into a new directory. The server is intended for a user's local asset directory, not an adversarial shared filesystem.

Standalone MIDI export checks its source. Complete audio/MIDI file correspondence is checked by `export_package`. MIDI is a composition interchange format; the project source is the renderer's complete source of truth.
