import { BriefInputSchema, ResolvedBriefSchema, type MusicBrief } from './model.js';
import { STYLES } from './profiles.js';

export function createMusicBrief(input: unknown = {}): MusicBrief {
  const data = BriefInputSchema.parse(input);
  const words = [data.text, data.genre, data.mood].filter(Boolean).join(' ').toLowerCase();
  const profileId = data.styleProfile ?? Object.keys(STYLES).find(id => STYLES[id].aliases.some(a => words.includes(a))) ?? 'heroic_overworld';
  const profile = STYLES[profileId];
  if (!profile) throw new Error(`Unknown style profile: ${profileId}. Use inspect_project to list profiles.`);
  const interpretation = ['Deterministic keyword interpretation; explicit parameters override recognised words.', `Style ${profileId}: density ${profile.density}, rest probability ${profile.rests}, tension ${profile.tension}, swing ${profile.swing}.`];
  const parsedTempo = words.match(/\b(\d+(?:\.\d+)?)\s*bpm\b/);
  const parsedBars = words.match(/\b(\d+)\s*bars?\b/);
  const parsedKey = data.text.match(/\b([A-G](?:#|b)?)\s+(major|minor|dorian|harmonic minor|mixolydian|phrygian)\b/i);
  const prohibited = [...data.prohibitedElements];
  if (/\b(no|without)\s+(drums|percussion)\b/.test(words) && !prohibited.includes('drums')) prohibited.push('drums');
  const hardware = data.hardware ?? (/(mega drive|megadrive|genesis)/.test(words) ? 'mega_drive' : /pc.?98/.test(words) ? 'pc98' : /fm towns/.test(words) ? 'fm_towns' : /snes/.test(words) ? 'snes' : /modern retro/.test(words) ? 'modern_retro' : 'fantasy');
  const key = data.key ?? (parsedKey ? parsedKey[1][0].toUpperCase() + parsedKey[1].slice(1) : 'D');
  const scale = data.scale ?? (parsedKey ? parsedKey[2].toLowerCase().replace(' ', '_') : profile.scale);
  let tempo = data.tempo ?? (parsedTempo ? Number(parsedTempo[1]) : Math.round((profile.tempo[0] + profile.tempo[1]) / 2));
  if (!data.tempo && !parsedTempo && /\bslow\b/.test(words)) tempo = profile.tempo[0];
  if (!data.tempo && !parsedTempo && /\bfast\b/.test(words)) tempo = profile.tempo[1];
  if (!data.styleProfile && profileId === 'heroic_overworld' && words && !STYLES[profileId].aliases.some(a => words.includes(a))) interpretation.push('No known style keyword found. Used heroic_overworld; choose an explicit profile to control style.');
  return ResolvedBriefSchema.parse({
    ...data, title: data.title ?? profile.label, gameplayPurpose: data.gameplayPurpose ?? 'gameplay',
    genre: data.genre ?? profile.label, mood: data.mood ?? profile.label,
    emotionalDirection: data.emotionalDirection ?? 'Develop the motif and return to the opening mood.',
    styleProfile: profileId, hardware, key, scale, tempo, bars: data.bars ?? (parsedBars ? Number(parsedBars[1]) : profile.bars),
    prohibitedElements: prohibited, intensityCurve: data.intensityCurve ?? [0.45, 0.65, 0.35, 0.8],
    loop: data.loop && !['victory_fanfare', 'defeat_game_over'].includes(profileId), interpretation
  });
}
