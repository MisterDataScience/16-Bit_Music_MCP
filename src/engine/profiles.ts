import { InstrumentSchema, type Instrument, type MusicBrief, type Part } from './model.js';

export type Style = {
  label: string; aliases: string[]; tempo: [number, number]; scale: MusicBrief['scale'];
  density: number; rests: number; leap: number; percussion: number; syncopation: number;
  swing: number; tension: number; descending: boolean; sustainBass: boolean; bars: number;
};
const style = (label: string, aliases: string[], tempo: [number, number], scale: Style['scale'], values: Partial<Style> = {}): Style => ({
  label, aliases, tempo, scale, density: 0.65, rests: 0.18, leap: 2, percussion: 0.6,
  syncopation: 0.2, swing: 0, tension: 0.3, descending: false, sustainBass: false, bars: 16, ...values
});
export const STYLES: Record<string, Style> = {
  lonely_frozen_village: style('Lonely frozen village', ['frozen', 'snow', 'lonely'], [68, 82], 'dorian', { density: 0.32, rests: 0.45, percussion: 0.08, descending: true, sustainBass: true, tension: 0.25, leap: 1 }),
  heroic_overworld: style('Heroic overworld', ['heroic', 'overworld', 'adventure', 'orchestral'], [112, 136], 'major', { leap: 4, density: 0.8, tension: 0.25 }),
  bright_platformer: style('Bright platformer', ['platformer', 'bright', 'happy', 'upbeat'], [128, 156], 'major', { density: 0.85, syncopation: 0.42, leap: 3, percussion: 0.8 }),
  dark_dungeon: style('Dark dungeon', ['dungeon', 'dark'], [72, 100], 'phrygian', { density: 0.45, rests: 0.35, tension: 0.65, percussion: 0.4 }),
  melancholic_village: style('Melancholic village', ['melancholic', 'village', 'sad'], [70, 92], 'minor', { density: 0.4, rests: 0.35, sustainBass: true, descending: true, percussion: 0.15 }),
  mysterious_ruins: style('Mysterious ruins', ['ruins', 'mysterious', 'ambient'], [74, 96], 'dorian', { density: 0.4, rests: 0.4, tension: 0.5, percussion: 0.2, sustainBass: true }),
  tense_boss_battle: style('Tense boss battle', ['boss', 'battle', 'combat', 'metal'], [152, 188], 'harmonic_minor', { density: 0.95, rests: 0.1, leap: 4, percussion: 1, tension: 0.85, syncopation: 0.45 }),
  tragic_character_theme: style('Tragic character theme', ['tragic', 'character'], [60, 80], 'harmonic_minor', { density: 0.35, rests: 0.4, descending: true, sustainBass: true, percussion: 0.05, tension: 0.65 }),
  comic_shop_theme: style('Comic shop theme', ['shop', 'comic', 'jazz', 'swing'], [104, 132], 'mixolydian', { swing: 0.2, syncopation: 0.5, leap: 3, percussion: 0.45 }),
  futuristic_city: style('Futuristic city', ['city', 'futuristic', 'synthwave', 'electronic'], [100, 124], 'dorian', { density: 0.8, syncopation: 0.4, percussion: 0.8, tension: 0.4 }),
  industrial_factory: style('Industrial factory', ['factory', 'industrial', 'techno'], [120, 148], 'minor', { density: 0.85, percussion: 1, syncopation: 0.35, tension: 0.7 }),
  horror_pursuit: style('Horror pursuit', ['horror', 'pursuit', 'chase'], [140, 176], 'phrygian', { density: 0.9, percussion: 0.9, tension: 0.95, rests: 0.12, leap: 1 }),
  calm_menu: style('Calm menu', ['calm', 'menu', 'peaceful'], [64, 84], 'major', { density: 0.3, rests: 0.4, percussion: 0.05, sustainBass: true }),
  victory_fanfare: style('Victory fanfare', ['victory', 'fanfare', 'win'], [120, 144], 'major', { density: 0.9, leap: 4, percussion: 0.8, bars: 4 }),
  defeat_game_over: style('Defeat or game over', ['defeat', 'game over', 'game-over'], [56, 76], 'minor', { density: 0.3, descending: true, percussion: 0.05, sustainBass: true, bars: 4 })
};

/** Sound profiles are deliberately separate from musical style. No hardware emulation claims. */
export const HARDWARE: Record<MusicBrief['hardware'], { label: string; lead: Instrument['wave']; harmony: Instrument['wave']; bass: Instrument['wave']; bits: number; hold: number; reverb: number }> = {
  snes: { label: 'SNES-inspired', lead: 'wavetable', harmony: 'pad', bass: 'bass', bits: 16, hold: 1, reverb: 0.22 },
  mega_drive: { label: 'Mega Drive-inspired', lead: 'fm_bell', harmony: 'fm_ep', bass: 'bass', bits: 14, hold: 1, reverb: 0.04 },
  pc98: { label: 'PC-98-inspired', lead: 'fm_ep', harmony: 'fm_bell', bass: 'saw', bits: 16, hold: 1, reverb: 0.06 },
  fm_towns: { label: 'FM Towns-inspired', lead: 'fm_bell', harmony: 'wavetable', bass: 'bass', bits: 16, hold: 1, reverb: 0.15 },
  fantasy: { label: 'General 16-bit fantasy', lead: 'pulse', harmony: 'pad', bass: 'triangle', bits: 16, hold: 1, reverb: 0.2 },
  action: { label: 'General 16-bit action', lead: 'filtered_lead', harmony: 'saw', bass: 'bass', bits: 12, hold: 1, reverb: 0.04 },
  modern_retro: { label: 'Modern retro', lead: 'filtered_lead', harmony: 'pad', bass: 'bass', bits: 16, hold: 1, reverb: 0.18 }
};

export function instrumentFor(part: Part, hardware: MusicBrief['hardware']): Instrument {
  const h = HARDWARE[hardware];
  const wave = part === 'melody' ? h.lead : part === 'bass' ? h.bass : part === 'drums' ? 'sample' : part === 'effects' ? 'noise' : part === 'harmony' ? h.harmony : 'fm_ep';
  return InstrumentSchema.parse({ wave, duty: part === 'melody' ? 0.25 : 0.5,
    range: part === 'bass' ? [28, 59] : part === 'drums' ? [35, 81] : part === 'effects' ? [24, 100] : part === 'harmony' ? [36, 88] : [48, 96],
    attack: part === 'harmony' ? 0.04 : 0.005, decay: wave === 'fm_bell' ? 0.4 : 0.12,
    sustain: part === 'harmony' ? 0.6 : part === 'drums' ? 0 : 0.45,
    release: part === 'harmony' ? 0.22 : 0.07, vibrato: part === 'melody' ? 8 : 0,
    lowpass: part === 'bass' ? 2000 : hardware === 'snes' ? 6500 : 10000,
    highpass: part === 'effects' ? 1600 : 0, reverb: part === 'bass' || part === 'drums' ? 0 : h.reverb,
    delay: part === 'arpeggio' ? 0.18 : part === 'melody' ? 0.1 : 0,
    chorus: part === 'harmony' ? 0.12 : 0, bitDepth: h.bits, sampleHold: h.hold });
}
