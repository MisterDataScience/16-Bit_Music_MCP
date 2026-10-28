import { ProjectSchema, PPQ, totalTicks, type Project } from './model.js';

function variableLength(value: number): number[] {
  const bytes = [value & 127];
  while ((value >>>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
}
type Event = { tick: number; order: number; bytes: number[] };
function chunk(events: Event[], end: number): Buffer {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes: number[] = []; let previous = 0;
  for (const event of events) { bytes.push(...variableLength(event.tick - previous), ...event.bytes); previous = event.tick; }
  bytes.push(...variableLength(end - previous), 255, 47, 0);
  const head = Buffer.alloc(8); head.write('MTrk'); head.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([head, Buffer.from(bytes)]);
}

export function exportMidi(input: Project): Buffer {
  const p = ProjectSchema.parse(input), end = totalTicks(p);
  const micros = Math.round(60_000_000 / p.tempo), [numerator, denominator] = p.timeSignature.split('/').map(Number);
  const tonicSignature: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6 };
  const meta: Event[] = [
    { tick: 0, order: 0, bytes: [255, 81, 3, (micros >>> 16) & 255, (micros >>> 8) & 255, micros & 255] },
    { tick: 0, order: 1, bytes: [255, 88, 4, numerator, Math.log2(denominator), denominator === 8 ? 36 : 24, 8] },
    // Mode is kept in a text event. Major/minor key-signature metadata alone cannot express all modes.
    { tick: 0, order: 2, bytes: [255, 1, ...variableLength(Buffer.byteLength(`${p.key} ${p.scale}`)), ...Buffer.from(`${p.key} ${p.scale}`)] }
  ];
  if (p.scale === 'major') meta.push({ tick: 0, order: 3, bytes: [255, 89, 2, (tonicSignature[p.key] ?? 0) & 255, 0] });
  const chunks = [chunk(meta, end)]; let melodicChannel = 0;
  for (const track of p.tracks) {
    if (melodicChannel === 9) melodicChannel++;
    const channel = track.part === 'drums' ? 9 : melodicChannel++;
    const name = Buffer.from(track.id);
    const events: Event[] = [
      { tick: 0, order: -4, bytes: [255, 3, ...variableLength(name.length), ...name] },
      { tick: 0, order: -3, bytes: [192 | channel, track.midiProgram] },
      { tick: 0, order: -2, bytes: [176 | channel, 7, Math.round(track.volume * 127)] },
      { tick: 0, order: -1, bytes: [176 | channel, 10, Math.round((track.pan + 1) * 63.5)] }
    ];
    // Overlapping same-pitch notes on one MIDI channel are merged to avoid early note-offs.
    const merged: Array<{pitch: number; tick: number; end: number; velocity: number}> = [];
    for (const n of [...track.notes].sort((a, b) => a.pitch - b.pitch || a.tick - b.tick)) {
      const prev = merged.at(-1);
      if (prev && prev.pitch === n.pitch && n.tick < prev.end) { prev.end = Math.max(prev.end, n.tick + n.duration); prev.velocity = Math.max(prev.velocity, n.velocity); }
      else merged.push({ pitch: n.pitch, tick: n.tick, end: n.tick + n.duration, velocity: n.velocity });
    }
    for (const n of merged) {
      if (n.end > end) throw new Error('MIDI note extends beyond project boundary');
      events.push({ tick: n.tick, order: 1, bytes: [144 | channel, n.pitch, n.velocity] }, { tick: n.end, order: 0, bytes: [128 | channel, n.pitch, 0] });
    }
    chunks.push(chunk(events, end));
  }
  const header = Buffer.alloc(14); header.write('MThd'); header.writeUInt32BE(6, 4); header.writeUInt16BE(1, 8); header.writeUInt16BE(chunks.length, 10); header.writeUInt16BE(PPQ, 12);
  return Buffer.concat([header, ...chunks]);
}
