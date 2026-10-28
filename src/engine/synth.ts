import { hash } from './random.js';
import { ProjectSchema, PPQ, durationSeconds, type Project, type Instrument, type Track } from './model.js';
import { assertValid } from './validate.js';

export type Stereo = { left: Float64Array; right: Float64Array };
export type AudioRender = {
  sampleRate: number; frames: number; seconds: number; mix: Stereo; stems: Record<string, Stereo>;
  peakDb: number; rmsDb: number; gain: number; seamDelta: number; seamEdgeDelta: number; seamWindowPeakDelta: number; silentWindowCount: number;
};
const TAU = Math.PI * 2;
const frequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
const db = (value: number) => value > 0 ? 20 * Math.log10(value) : -160;
const allocate = (frames: number): Stereo => ({ left: new Float64Array(frames), right: new Float64Array(frames) });
function noise(seed: number) {
  let state = seed || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
}
function polyBlep(phase: number, dt: number) {
  if (phase < dt) { const t = phase / dt; return t + t - t * t - 1; }
  if (phase > 1 - dt) { const t = (phase - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function oscillator(phase: number, dt: number, instrument: Instrument, time: number, randomNoise: () => number): number {
  const sine = Math.sin(TAU * phase);
  switch (instrument.wave) {
    case 'pulse': return (phase < instrument.duty ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase - instrument.duty + 1) % 1, dt);
    case 'saw': case 'filtered_lead': return 2 * phase - 1 - polyBlep(phase, dt);
    case 'triangle': return 1 - 4 * Math.abs(phase - 0.5);
    case 'fm_ep': return Math.sin(TAU * phase + 2.8 * Math.exp(-time * 4) * Math.sin(TAU * phase * 2));
    case 'fm_bell': return Math.sin(TAU * phase + 3.2 * Math.exp(-time * 2) * Math.sin(TAU * phase * 3.5)) * Math.exp(-time * 1.3);
    case 'wavetable': { const index = Math.floor(phase * 64) / 64; return (Math.sin(TAU * index) + 0.4 * Math.sin(TAU * index * 2) + 0.18 * Math.sin(TAU * index * 3)) / 1.58; }
    case 'bass': return (sine + 0.4 * Math.sin(TAU * phase * 2 + 1.8 * Math.exp(-time * 7) * sine)) / 1.4;
    case 'pad': return (sine + 0.3 * Math.sin(TAU * phase * 2) + 0.12 * Math.sin(TAU * phase * 3)) / 1.42;
    case 'noise': return randomNoise();
    case 'sample': return 0;
  }
}

/** Original synthesised PCM one-shots, generated locally and then played as samples. */
function makeDrumSample(pitch: number, sampleRate: number): Float64Array {
  const kind = pitch === 36 ? 'kick' : pitch === 38 ? 'snare' : 'hat';
  const duration = kind === 'kick' ? 0.32 : kind === 'snare' ? 0.2 : 0.08;
  const sample = new Float64Array(Math.ceil(duration * sampleRate));
  const rng = noise(pitch * 18427); let phase = 0, previous = 0;
  for (let i = 0; i < sample.length; i++) {
    const t = i / sampleRate, n = rng();
    if (kind === 'kick') { phase += TAU * (48 + 120 * Math.exp(-t * 45)) / sampleRate; sample[i] = Math.sin(phase) * Math.exp(-t * 17); }
    else if (kind === 'snare') sample[i] = (0.72 * n + 0.28 * Math.sin(TAU * 180 * t)) * Math.exp(-t * 24);
    else sample[i] = (n - previous) * 0.5 * Math.exp(-t * 65);
    previous = n;
    sample[i] *= Math.min(1, t / 0.001) * Math.min(1, (sample.length - 1 - i) / Math.max(1, sampleRate * 0.002));
  }
  return sample;
}

function envelope(time: number, gate: number, instrument: Instrument): number {
  const held = (t: number) => t < instrument.attack ? t / instrument.attack : t < instrument.attack + instrument.decay ? 1 - (1 - instrument.sustain) * (t - instrument.attack) / instrument.decay : instrument.sustain;
  return time <= gate ? held(time) : held(gate) * Math.max(0, 1 - (time - gate) / instrument.release);
}

function filter(samples: Float64Array, cutoff: number, sampleRate: number, highpass: boolean, loop: boolean) {
  if (cutoff === 0) return;
  const coefficient = 1 - Math.exp(-TAU * Math.min(cutoff, sampleRate * 0.45) / sampleRate);
  let state = 0;
  if (loop) for (let i = 0; i < samples.length; i++) state += coefficient * (samples[i] - state);
  for (let i = 0; i < samples.length; i++) {
    state += coefficient * (samples[i] - state);
    samples[i] = highpass ? samples[i] - state : state;
  }
}

function renderTrack(p: Project, track: Track, frames: number, sampleRate: number, kit: Map<number, Float64Array>): Stereo {
  const mono = new Float64Array(frames), ins = track.instrument;
  const secondsPerTick = 60 / (p.tempo * PPQ);
  let previousPitch: number | undefined;
  for (const [index, note] of track.notes.entries()) {
    const start = Math.round(note.tick * secondsPerTick * sampleRate), gate = note.duration * secondsPerTick;
    const percussion = track.part === 'drums';
    const sample = (percussion && ins.wave === 'sample') ? kit.get(note.pitch) ?? kit.get(42)! : undefined;
    const length = sample ? sample.length : Math.ceil((gate + ins.release) * sampleRate);
    const rng = noise(Number.parseInt(hash([p.seed, track.id, index]).slice(0, 8), 16));
    let phase = 0, held = 0;
    for (let i = 0; i < length; i++) {
      const target = start + i;
      if (target >= frames && !p.brief.loop) break;
      const time = i / sampleRate;
      if (sample) { mono[target % frames] += sample[i] * note.velocity / 127; continue; }
      const glide = previousPitch === undefined || ins.portamento === 0 ? 0 : (previousPitch - note.pitch) * Math.max(0, 1 - time / ins.portamento);
      const pitch = note.pitch + glide + note.slide * Math.min(1, time / Math.max(gate, 0.001)) + ins.vibrato / 100 * Math.sin(TAU * ins.vibratoHz * time) * Math.min(1, time * 10);
      const freq = Math.min(frequency(pitch), sampleRate * 0.4), dt = freq / sampleRate;
      if (i % ins.sampleHold === 0) {
        const raw = oscillator(phase, dt, ins, time, rng);
        const levels = 2 ** (ins.bitDepth - 1);
        held = Math.round(raw * levels) / levels;
      }
      const gateValue = percussion ? Math.exp(-time * (note.pitch === 36 ? 17 : 45)) * Math.min(1, time / 0.001) : envelope(time, gate, ins);
      mono[target % frames] += held * gateValue * note.velocity / 127;
      phase = (phase + dt) % 1;
    }
    previousPitch = note.pitch;
  }
  filter(mono, ins.lowpass, sampleRate, false, p.brief.loop);
  filter(mono, ins.highpass, sampleRate, true, p.brief.loop);
  const stereo = allocate(frames), leftGain = Math.cos((track.pan + 1) * Math.PI / 4) * track.volume;
  const rightGain = Math.sin((track.pan + 1) * Math.PI / 4) * track.volume;
  const delayFrames = Math.round(sampleRate * 60 / p.tempo * 0.75);
  const taps = [0.037, 0.061, 0.097].map(t => Math.round(t * sampleRate));
  const read = (index: number) => p.brief.loop ? mono[((index % frames) + frames) % frames] : index >= 0 && index < frames ? mono[index] : 0;
  const chorusCycles = Math.max(1, Math.round(frames / sampleRate * 0.3));
  const fade = Math.max(2, Math.round(p.renderSettings.seamFadeMs / 1000 * sampleRate));
  for (let i = 0; i < frames; i++) {
    let wet = mono[i];
    wet += ins.delay * (read(i - delayFrames) + 0.45 * read(i - delayFrames * 2));
    for (let k = 0; k < taps.length; k++) wet += ins.reverb * read(i - taps[k]) / (k + 2);
    const modulation = Math.round(sampleRate * (0.012 + 0.003 * Math.sin(TAU * chorusCycles * i / frames)));
    const widthLeft = ins.chorus * read(i - modulation), widthRight = ins.chorus * read(i - modulation - Math.round(sampleRate * 0.004));
    // A short, explicit seam treatment bounds endpoint discontinuity on every stem.
    const gain = Math.min(1, i / fade, (frames - 1 - i) / fade);
    stereo.left[i] = (wet + widthLeft) * leftGain * gain;
    stereo.right[i] = (wet + widthRight) * rightGain * gain;
  }
  return stereo;
}

export function renderAudio(input: Project): AudioRender {
  assertValid(input);
  const p = ProjectSchema.parse(input), sampleRate = p.renderSettings.sampleRate;
  const seconds = durationSeconds(p), frames = Math.round(seconds * sampleRate);
  if (seconds > 180 || frames * p.tracks.length > 40_000_000) throw new Error('Render budget exceeded: shorten the project, lower the sample rate, or reduce tracks (180 seconds / 40 million track-frames maximum).');
  if (p.tracks.reduce((sum, t) => sum + t.notes.length, 0) > 30000) throw new Error('Render budget exceeded: too many notes');
  const kit = new Map([36, 38, 42].map(pitch => [pitch, makeDrumSample(pitch, sampleRate)]));
  const mix = allocate(frames), stems: Record<string, Stereo> = {};
  for (const track of p.tracks) {
    const audio = renderTrack(p, track, frames, sampleRate, kit);
    const stem = stems[track.stem] ??= allocate(frames);
    for (let i = 0; i < frames; i++) {
      stem.left[i] += audio.left[i]; stem.right[i] += audio.right[i];
      mix.left[i] += audio.left[i]; mix.right[i] += audio.right[i];
    }
  }
  // One shared gain preserves exact additive reconstruction from stems.
  let peak = 0;
  for (const audio of [mix, ...Object.values(stems)]) for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(audio.left[i]), Math.abs(audio.right[i]));
  const target = 10 ** (p.renderSettings.peakDb / 20), gain = peak ? target / peak : 1;
  for (const audio of [mix, ...Object.values(stems)]) for (let i = 0; i < frames; i++) { audio.left[i] *= gain; audio.right[i] *= gain; }
  let sumSquares = 0, mixPeak = 0;
  for (let i = 0; i < frames; i++) { sumSquares += mix.left[i] ** 2 + mix.right[i] ** 2; mixPeak = Math.max(mixPeak, Math.abs(mix.left[i]), Math.abs(mix.right[i])); }
  const seamDelta = Math.max(Math.abs(mix.left[0] - mix.left[frames - 1]), Math.abs(mix.right[0] - mix.right[frames - 1]));
  const seamEdgeDelta = Math.max(Math.abs(mix.left[1] - mix.left[0]), Math.abs(mix.right[1] - mix.right[0]), Math.abs(mix.left[frames - 1] - mix.left[frames - 2]), Math.abs(mix.right[frames - 1] - mix.right[frames - 2]));
  const seamWindow = Math.min(Math.round(sampleRate * 0.01), frames - 1);
  let seamWindowPeakDelta = seamDelta;
  for (let j = 0; j < seamWindow; j++) for (const channel of [mix.left, mix.right]) {
    seamWindowPeakDelta = Math.max(seamWindowPeakDelta, Math.abs(channel[j + 1] - channel[j]), Math.abs(channel[frames - j - 1] - channel[frames - j - 2]));
  }
  let silentWindowCount = 0;
  const window = Math.round(sampleRate * 0.25);
  for (let start = 0; start + window <= frames; start += window) {
    let power = 0;
    for (let i = start; i < start + window; i++) power += mix.left[i] ** 2 + mix.right[i] ** 2;
    if (db(Math.sqrt(power / (window * 2))) < -70) silentWindowCount++;
  }
  return { sampleRate, frames, seconds: frames / sampleRate, mix, stems, peakDb: db(mixPeak), rmsDb: db(Math.sqrt(sumSquares / (frames * 2))), gain, seamDelta, seamEdgeDelta, seamWindowPeakDelta, silentWindowCount };
}

export function encodeWav(audio: Stereo, sampleRate: number): Buffer {
  const frames = audio.left.length;
  if (audio.right.length !== frames) throw new Error('Stereo channel lengths differ');
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio.left[i] * 32767))), 44 + i * 4);
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio.right[i] * 32767))), 46 + i * 4);
  }
  return buffer;
}
