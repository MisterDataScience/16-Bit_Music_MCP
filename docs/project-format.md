# Version 1 source format

The canonical validation schema is `ProjectSchema` in `src/engine/model.ts`. Every source includes `version: 1` and `engineVersion: "0.1.0"`. Unknown fields and unsupported versions are rejected rather than silently discarded. Future versions require explicit migrations.

The top level contains title, seed, tempo, key, scale, timeSignature, bars, styleProfile, resolved brief, motifs, harmony, tracks, arrangement, renderSettings, locks, revision, provenance and validation.

## Time and pitch

- Time uses integer ticks, 480 per quarter note. 4/4 has 1,920 ticks per bar; 3/4 and 6/8 have 1,440.
- BPM always counts quarter notes. 6/8 groups six eighth notes into a bar.
- Generated note starts use a 12-tick grid, allowing the profile's swing offsets. Durations are integer ticks and need not be a multiple of that start grid.
- Pitches are MIDI integers from 0 to 127. A note's tick plus duration must not exceed the project boundary.
- Note events contain `tick`, `duration`, `pitch`, `velocity`, `slide` in semitones and `chromatic`.
- Chromatic flags are accepted musically only for declared borrowed harmony whose pitch appears in that bar's chord. Drums and noise effects are exempt from pitched scale checks. The no-chromatic constraint also rejects pitch slides.

## Motifs and harmony

Motifs contain a tick length and events with relative offsets, durations, diatonic degrees and velocities. The stored primary and answer phrases recur across the theme. Bass and arpeggio motifs are interpreted against the bar's harmonic degree. The rhythmic motif supplies the drum hook's accent positions.

The harmony array has one entry per bar: its bar number, scale degree, concrete chord pitches, inversion, suspension and borrowed-chord flag. The planner uses seeded functional transitions, phrase endings, inversions, suspensions and optional colour. A loop starts on tonic and closes on tonic or dominant. This is a deliberately simple compatibility rule.

## Arrangement

Sections cover the project exactly once. Each contains:

```json
{
  "type": "main_loop",
  "startBar": 0,
  "bars": 4,
  "intensity": 0.6,
  "activeParts": ["melody", "bass", "harmony", "drums", "arpeggio", "counter_melody"]
}
```

Types are intro, main_loop, breakdown, escalation, boss_phase, outro and stinger. The default planner builds up to four sections from the intensity curve; explicit sections can describe other structures. A project is one exported timeline. To export only a loop without an intro, make the loop its own project. An intro within a project marked `loop: true` will repeat with that timeline.

Locked note tracks can remain active outside newly edited section instructions. Retaining a lock takes precedence over rewriting notes. The renderer always plays the saved notes, so this behaviour is visible in the source and does not depend on an invisible runtime arranger.

## Tracks and instruments

Each track has a unique ID and named part, stem group, instrument definition, note events, volume, pan and MIDI programme. This version accepts one track per part. Melody and counter-melody share the lead stem; harmony and arpeggio share harmony. Bass, drums and effects each have a stem. The stem enum reserves ambience for future use.

Wave families: `pulse`, `triangle`, `saw`, `fm_ep`, `fm_bell`, `wavetable`, `sample`, `noise`, `bass`, `pad`, `filtered_lead`.

`sample` is intended for the drum track and plays original generated PCM one-shots. Noise is intended for percussion or effects. Pitched sound families are used by the other tracks. External sample paths are not part of this version.

Instrument fields include duty cycle, ADSR times in seconds, sustain level, vibrato in cents and hertz, portamento time, low-pass and high-pass cutoffs in hertz, delay/reverb/chorus amounts, bit depth, sample-hold interval, and MIDI pitch range. Exact bounds are in the Zod schema. A note's `slide` supplies a linear pitch move over its gate time. MIDI export does not encode that modulation.

Low-pass and high-pass filters are single-pole. Delay is a finite two-tap effect; short reverb is a finite three-tap approximation; stereo widening uses short modulated delays. These are lightweight offline effects, not studio convolution or a console DSP emulation.

## Rendering

`renderSettings` contains `sampleRate` (8000, 16000, 22050, 32000, 44100 or 48000), `peakDb` (default -1.2) and `seamFadeMs` (default 3).

Notes and release tails are synthesised into track audio. Looping projects wrap those tails, delay taps and short reverb into the beginning; non-looping cues trim tails to the exact timeline. Each stem receives a short endpoint fade. The mix and all stems share one normalisation gain, selected to keep both the mix and every individual stem below the target. Individual stem cancellation can therefore put the mix peak below the requested ceiling.

There is no resampling to make WAV agree with MIDI. WAV frame count is the nearest integer to musical duration multiplied by sample rate. MIDI end markers are at the exact musical end tick. Read-back comparisons allow one audio sample plus integer MIDI-tempo quantisation error.

## Locks and reproducibility

Locks are SHA-256 digests of part content, not advisory booleans. Reloading a project checks them. A changed lock is reported as a failure; unlocking is an explicit edit. Provenance records the parent source hash and operation. A revision is a new snapshot, not an in-place mutation.

The seed drives independent labelled pseudo-random streams for motifs, harmony and individual parts. No timestamps or random project IDs enter composition. Repeatability is scoped to this engine version; a later algorithm version may produce different notes. Saved notes and sound definitions remain the authoritative source for a version-compatible re-render.
