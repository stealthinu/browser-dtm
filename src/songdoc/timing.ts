/** 音価・音名・小節拍 ↔ tick / MIDI（TPQ=480） */

export const TPQ = 480;
/** dtm: 1小節 = 192 step、4分 = 48 step → VocaTab tick = step × 10 */
export const STEPS_PER_BAR = 192;
export const STEPS_PER_BEAT_4_4 = 48;
export const TICKS_PER_STEP = 10;

const NOTE_TO_MIDI: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  "E#": 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

/** 音価文字列 → 4分音符を1とした長さ（例: "4"=1, "8"=0.5, "8."=0.75, "4t"=2/3） */
export function lenToBeats(len: string): number {
  const m = /^(\d+)([.]?)(t?)$/.exec(len.trim());
  if (!m) throw new Error(`未知の音価: ${len}`);
  const base = 4 / Number(m[1]);
  let beats = base;
  if (m[2] === ".") beats *= 1.5;
  if (m[3] === "t") beats *= 2 / 3;
  return beats;
}

export function beatsToTicks(beats: number): number {
  return Math.round(beats * TPQ);
}

/** bar(1始まり)・beat(1始まり) → 曲頭からの tick */
export function barBeatToTick(bar: number, beat: number, beatsPerBar: number): number {
  if (bar < 1) throw new Error(`bar は1始まり: ${bar}`);
  if (beat < 1) throw new Error(`beat は1始まり: ${beat}`);
  return Math.round(((bar - 1) * beatsPerBar + (beat - 1)) * TPQ);
}

export function tickToBarBeat(tick: number, beatsPerBar: number): { bar: number; beat: number } {
  const totalBeats = tick / TPQ;
  const bar = Math.floor(totalBeats / beatsPerBar) + 1;
  const beat = (totalBeats % beatsPerBar) + 1;
  return { bar, beat };
}

/** "G4" / "C#5" / "Bb3" → MIDI */
export function pitchToMidi(pitch: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(pitch.trim());
  if (!m) throw new Error(`未知の音名: ${pitch}`);
  const name = m[1].toUpperCase() + (m[2] || "");
  const oct = Number(m[3]);
  const pc = NOTE_TO_MIDI[name];
  if (pc === undefined) throw new Error(`未知の音名: ${pitch}`);
  return (oct + 1) * 12 + pc;
}

export function midiToPitch(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${names[pc]}${oct}`;
}

export function songDurationSec(bars: number, bpm: number, beatsPerBar: number): number {
  return (bars * beatsPerBar * 60) / bpm;
}

export function secPerTick(bpm: number): number {
  return 60 / (bpm * TPQ);
}
