# Synod 16-Bit Music MCP

An offline music department for the Synod. Give it a brief, keep the bits that work, and revise the rest without losing the tune.

It turns structured creative briefs into repeatable, editable game music, with a local MCP server for AI assistants. You get the composition, the sound settings and the checks alongside the audio, so the next department has something proper to work with.

This is a working first version of a **rule-based composition engine**, not a neural music model. The assistant supplies musical direction. The engine handles motifs, harmony, rhythm, arrangement and rendering. There is no cloud music service, paid API, GPU requirement or account check.

## What is working

- Fifteen named musical profiles, including lonely frozen village, heroic overworld, bright platformer, dark dungeon, boss battle and short victory or defeat cues.
- Seven separate sound palettes: SNES-inspired, Mega Drive-inspired, PC-98-inspired, FM Towns-inspired, fantasy, action and modern retro.
- Stored melody, answer, bass, arpeggio and rhythm motifs, with a harmonic plan and explicit arrangement sections.
- Deterministic seeds, variations, individual part regeneration and content-hashed locks.
- Pulse, triangle, saw, FM piano, FM bell, wavetable, bass, pad and filtered lead voices, plus original sampled and noise percussion.
- Envelopes, vibrato, pitch slides, portamento, filters, delay, stereo widening, short reverb, bit reduction, sample-rate reduction, pan and track volume.
- Stereo PCM16 WAV, editable format-1 MIDI, separate WAV stems and versioned project JSON.
- Structural checks, rendered loop checks and file read-back checks before an asset package passes.
- Seventeen MCP tools through a local stdio process, using the official MCP TypeScript SDK and Zod validation.

The sound palettes take their cues from those machines. They are **not exact hardware emulators**. The engine is original code; the earlier [8-bit MCP project](https://github.com/ZwitterKaneda/8-bits-music-mcp) informed the separation between protocol and engine.

## Get it running

You need **Node.js 22 or later**. Installation needs internet access to fetch the pinned dependencies. Normal music generation and MCP use do not.

```sh
git clone https://github.com/MisterDataScience/16-Bit_Music_MCP.git
cd 16-Bit_Music_MCP
node scripts/install.mjs
```

The installer keeps a local npm cache, builds the server, runs the tests and makes a self-test export. On Linux with a C compiler, it also runs the kernel-enforced offline check. That check blocks IPv4 and IPv6 sockets, proves the block is active, then exercises generation, export and a real MCP client connection. It does not need root.

To run the steps yourself:

```sh
npm ci --cache .npm-cache --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run self-test
npm run bundle:offline
# Linux and a C compiler are needed for this verification step only:
npm run verify:offline
```

Once built, launch the files directly with `node`. Do not use `npx` at runtime. The build bundles all runtime packages into the JavaScript files in `dist`. Keep that folder, or use `artifacts/synod-music-0.1.0`, to move the engine onto an offline machine with Node installed. You do not need `node_modules` there. The portable folder includes dependency licence notices and checksums.

To reinstall the development dependencies from the local cache, use `npm ci --offline --cache .npm-cache --ignore-scripts --no-audit --no-fund`. If something is missing, npm fails instead of going online. The cache covers the platform used for installation; the portable JavaScript runtime avoids that platform-specific install step.

## Make a track without an assistant

```sh
node dist/cli.js compose --brief examples/frozen-village.brief.json --seed 18427 --out output/frozen-village
node dist/cli.js compose --brief examples/boss-battle.brief.json --seed 831 --out output/boss-battle
node dist/cli.js profiles
node dist/cli.js validate --project output/frozen-village/project.json
```

Each export folder contains:

| File | What it is for |
| --- | --- |
| `mix.wav` | Stereo PCM16 audio ready to audition in the game |
| `theme.mid` | Editable notes, velocity, tempo, metre, instrument programmes and pan |
| `stems/*.wav` | Lead, harmony, bass, drums and effects groups present in the project |
| `project.json` | Complete source, including motifs, notes, arrangement, instruments, locks and seed |
| `report.json` | Machine-readable validation results and measured audio levels |
| `manifest.json` | Loop frame positions, gameplay purpose, asset hashes and playtest checks |

All stems use one shared gain, start at frame zero and contain exactly the same number of frames as the mix. Summing them reconstructs the mix, apart from PCM rounding. A prohibited part is omitted. An allowed but unused stem can be silent when the arrangement has no events for it.

MIDI preserves the note composition and duration. It does not reproduce the internal synthesiser, its effects or pitch modulation. Keep `project.json` for a faithful re-render.

## Connect an assistant

Use absolute paths in your MCP client's configuration:

```json
{
  "mcpServers": {
    "synod-music": {
      "command": "node",
      "args": ["/absolute/path/16-Bit_Music_MCP/dist/server.js"],
      "env": {
        "SYNOD_MUSIC_OUTPUT_DIR": "/absolute/path/synod-music-assets"
      }
    }
  }
}
```

Use your full Node executable path if the client cannot find `node`. Windows paths can use forward slashes, for example `C:/Synod/music/dist/server.js`. The process uses stdin and stdout for MCP only, and opens no network listener.

Start with `inspect_project` without a project ID to see the available profile parameters. Then:

1. Call `create_music_brief` with the creative direction and explicit constraints.
2. Pass its resolved `brief` to `generate_theme` with a seed.
3. Inspect the source and call `validate_loop`.
4. Lock the parts worth keeping, and use the **new project ID returned by each edit**.
5. Generate a variation or regenerate one part.
6. Use `export_package` to hand the assets to the studio or playtest department.

For example, a brief can say:

```json
{
  "text": "A lonely frozen village at 76 BPM in D Dorian, 16 bars. No drums.",
  "title": "The Last Light in the Snow",
  "styleProfile": "lonely_frozen_village",
  "hardware": "snes",
  "intensityCurve": [0.35, 0.6, 0.3, 0.7]
}
```

The built-in brief interpreter recognises a limited set of style keywords, BPM, bar count, named key and mode, sound palette names, and requests for no drums. It is not a general language model. Explicit fields take precedence, and the resolved brief explains its interpretation. For an unusual genre or a precise musical direction, have the assistant choose concrete parameters and edit the structured source.

## Tools

| Tool | Job |
| --- | --- |
| `create_music_brief` | Resolve a creative request into explicit musical constraints |
| `generate_theme` | Compose the first complete draft |
| `generate_variation` | Change selected parts while preserving selected identity elements |
| `regenerate_part` | Rebuild one unlocked part |
| `lock_part`, `unlock_part` | Protect or release a part and its owned musical data |
| `set_style_profile` | Apply a musical profile or sound palette to unlocked parts |
| `set_motif` | Replace a stored motif and rebuild its owners |
| `inspect_project` | Read the complete source or list profiles |
| `validate_project` | Check musical structure and constraints |
| `validate_loop` | Render and measure the loop and stems |
| `render_wav` | Export the full mix |
| `export_midi` | Export editable note data |
| `export_stems` | Export aligned audio layers |
| `save_project`, `load_project` | Preserve and restore complete source |
| `export_package` | Export and verify the complete department handover |

Tool arguments and revision behaviour are in [the MCP guide](docs/mcp.md). The [project format](docs/project-format.md) describes editing instruments, sections and notes directly, with [JSON schemas](schema/) for other tools. The [department contract](docs/department-contract.md) covers requests, handovers and revision routing.

## What the checks can tell you

The engine checks scale membership, declared borrowed harmony, instrument range, note starts on the tick grid, note boundaries, arrangement coverage, tempo metadata, lock hashes, exact render length, stem alignment, clipping, overall silence and seam discontinuity. A package also reads back its written WAV, MIDI and project files, compares their durations, and hashes the assets.

Loop rendering wraps release and effect tails, then applies a short configurable fade at each endpoint, normally 3 ms. `loop: clean` means the mechanical seam and cadence checks passed. The cadence check accepts tonic or dominant harmony returning to tonic. Neither check can promise that a tune feels right when it repeats.

Listen to several repeats, try the entry and interruption points in the game, and check the layers during play. Musical appeal, style authenticity and fatigue still need that judgement. This engine does not pretend otherwise.

## Current limits

- One tempo, key, scale and time signature per project. Supported metres are 4/4, 3/4 and 6/8. BPM always measures quarter notes, including 6/8.
- Musical variety comes from profiles, seeded grammars, stored motifs and arrangement. It will not interpret every named genre as a bespoke composition system.
- The default composer makes seven parts, with one track per named part in this version.
- A render is limited to 180 seconds, 40 million track-frames and 30,000 notes to bound local CPU and memory use. Long or slow briefs may need fewer bars or a lower sample rate.
- MCP projects are session snapshots, up to 64 per process. Save source before restarting.
- Output paths stay inside the configured directory. Existing files are never overwritten; use a new filename or export folder.
- OGG, VST hosting, exact console emulation and a live adapter inside the wider Synod are not included. The local tools and file contract are ready for that integration.

## Development

TypeScript source lives in `src/engine`. The MCP layer is `src/server.ts`; it calls the engine rather than composing music itself. The engine has no browser audio dependency, sample download or neural model. Its percussion samples are original PCM generated locally from synthesis code.

`npm test` covers repeatability, keys and metres, sound palettes, part locks, motif edits, selective revisions, malformed projects, output confinement, asset read-back and an official SDK client talking to the actual stdio server. Linux CI also performs the offline socket-denial test and builds a portable artifact.

MIT licensed. See [LICENSE](LICENSE). The portable build includes full third-party notices.
