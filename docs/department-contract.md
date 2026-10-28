# Synod department contract

This repository supplies a local music MCP server and file contract. It does not assume or modify an unseen Synod scheduler. A Synod adapter can call the tools below or import `dist/engine.js`.

## Request

The studio supplies a request ID, gameplay context and the music brief. Request IDs live in the surrounding work order, while the music brief stays focused on composition. See `examples/department-request.json` for an envelope. Pass its `brief` field to `create_music_brief`; the engine's strict brief schema deliberately rejects the outer department envelope.

The coordinator owns scheduling and approval. The music department owns source generation, bounded revision, rendering and validation. The playtest department owns the gameplay and listening observations.

## Handover

Use `export_package` only after a draft has the desired musical direction. Its folder contains the complete editable source, mix, MIDI, aligned stems, report and gameplay manifest. The manifest identifies the seed, engine version, intended gameplay use, loop frame range, sample rate, musical length and SHA-256 hashes of source/audio/MIDI assets.

The report distinguishes structure-only checks, rendered audio checks and exported-file checks using its `scope`. A successful structural report alone is not evidence that a WAV exists or a seam was measured. Failed audio is refused before export; read-back failures produce a failed report and no successful handover response.

The manifest uses zero-based frames and an **exclusive** loop end. A runtime should load the mix or stems at their native sample rate and loop over `[loopStartFrame, loopEndFrameExclusive)`. Do not independently trim or normalise stems. For adaptive layers, start them at the same playback frame and retain their shared gain.

## Playtest output and revision

Playtest should attach the exact manifest and project version/hash, gameplay event or frame of the observation, expected behaviour, observed behaviour and requested editable parts. Include listening observations on:

- Three or more consecutive loops, especially the seam and the harmonic return.
- Starting, stopping, pausing and interrupting the cue in gameplay.
- Switching intensity layers without offsetting their playback positions.
- Mood, readability against sound effects, melodic identity and repetition fatigue.

An example revision envelope is `examples/department-revision.json`. Its routing is a contract for an adapter, not an automatic background job. Load the saved `project.json`, apply the requested locks, call `generate_variation` or `regenerate_part`, then export into a new directory. Return the new manifest and report to the requesting department. Preserve the previous folder for comparison.

Automated validation does not approve artistic quality. `status: passed` means the named checks passed. It does not mean a game was run or that a person listened.
