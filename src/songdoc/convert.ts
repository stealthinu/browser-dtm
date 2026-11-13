import { assignLyrics } from "./lyrics.js";
import {
  barBeatToTick,
  beatsToTicks,
  lenToBeats,
  pitchToMidi,
  TPQ,
} from "./timing.js";
import {
  isDrumTrack,
  isInstTrack,
  isVocalTrack,
  type SongDoc,
  type VocalNote,
  type VocalTrack,
} from "./types.js";

/** VocaTab Note 形（TPQ=480） */
export interface VocaTabNote {
  id: number;
  onset: number;
  dur: number;
  pitch: number;
  lyric: string;
}

export function vocalNoteToVocaTab(
  note: VocalNote,
  id: number,
  beatsPerBar: number,
): VocaTabNote {
  const onset = barBeatToTick(note.bar, note.beat, beatsPerBar);
  const dur = beatsToTicks(lenToBeats(note.len));
  return {
    id,
    onset,
    dur,
    pitch: pitchToMidi(note.pitch),
    lyric: note.lyric || "あ",
  };
}

export function songDocVocalToVocaTab(doc: SongDoc, trackId?: string): VocaTabNote[] {
  const track = doc.tracks.find(
    (t) => isVocalTrack(t) && (trackId ? t.id === trackId : true),
  ) as VocalTrack | undefined;
  if (!track) return [];
  return track.notes.map((n, i) => vocalNoteToVocaTab(n, i + 1, doc.beatsPerBar));
}

/**
 * SongDoc → dtm が loadMML / play できる MML 全体。
 * 歌トラックは含めない（VocaTab 側で鳴らす）。
 */
export function songDocToDtmMml(doc: SongDoc): string {
  const decls: string[] = [];
  const bodies: string[] = [];
  let nextInst = 0;

  decls.push(`#inst=piano`);
  decls.push(`#t0font=FluidR3`);

  for (const t of doc.tracks) {
    if (isDrumTrack(t)) {
      decls.push(`#drum=${t.pattern || "8beat"}`);
      if (t.volume != null) decls.push(`#drumvol=${Math.round(t.volume)}`);
      continue;
    }
    if (!isInstTrack(t)) continue;
    const idx = nextInst++;
    if (t.program) decls.push(`#t${idx}inst=${t.program}`);
    if (t.font) decls.push(`#t${idx}font=${t.font}`);
    if (t.volume != null) decls.push(`#t${idx}vol=${Math.round(t.volume)}`);
    const mml = t.mml.trim().replace(/^@\d+\s*/, "");
    bodies.push(`@${idx} t${doc.bpm} ${mml}`);
  }

  if (!doc.tracks.some(isDrumTrack)) {
    decls.push(`#drum=none`);
  }

  if (bodies.length === 0) {
    // 最低1パート無いと再生が空になるので休符トラック
    bodies.push(`@0 t${doc.bpm} o4 r1`);
  }

  return `${decls.join(" ")};\n${bodies.join("\n")}`;
}

export interface ConvertCheck {
  vocalNotes: number;
  instTracks: number;
  drumPattern: string | null;
  mml: string;
  vocatabNotes: VocaTabNote[];
  errors: string[];
}

export function convertAndCheck(doc: SongDoc): ConvertCheck {
  const errors: string[] = [];
  if (doc.version !== 1) errors.push(`version は 1 である必要がある: ${doc.version}`);
  if (!(doc.bpm > 0)) errors.push(`bpm が不正: ${doc.bpm}`);
  if (!(doc.bars > 0)) errors.push(`bars が不正: ${doc.bars}`);

  const vocal = doc.tracks.filter(isVocalTrack);
  const inst = doc.tracks.filter(isInstTrack);
  const drums = doc.tracks.filter(isDrumTrack);

  for (const v of vocal) {
    for (let i = 0; i < v.notes.length; i++) {
      const n = v.notes[i];
      try {
        vocalNoteToVocaTab(n, i + 1, doc.beatsPerBar);
      } catch (e) {
        errors.push(`vocal ${v.id} note[${i}]: ${e instanceof Error ? e.message : String(e)}`);
      }
      const endTick =
        barBeatToTick(n.bar, n.beat, doc.beatsPerBar) + beatsToTicks(lenToBeats(n.len));
      const songEnd = doc.bars * doc.beatsPerBar * TPQ;
      if (endTick > songEnd + 1) {
        errors.push(`vocal ${v.id} note[${i}] が曲長をはみ出す (tick ${endTick} > ${songEnd})`);
      }
    }
  }

  let mml = "";
  try {
    mml = songDocToDtmMml(doc);
  } catch (e) {
    errors.push(`MML 変換失敗: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    vocalNotes: vocal.reduce((a, t) => a + t.notes.length, 0),
    instTracks: inst.length,
    drumPattern: drums[0]?.pattern ?? null,
    mml,
    vocatabNotes: songDocVocalToVocaTab(doc),
    errors,
  };
}

/** set_lyrics: 指定ボーカルトラックの notes[].lyric を割り当て直す */
export function applyLyricsToTrack(
  doc: SongDoc,
  trackId: string,
  text: string,
  fromBar?: number,
): { doc: SongDoc; assign: ReturnType<typeof assignLyrics> } {
  const tracks = doc.tracks.map((t) => {
    if (!isVocalTrack(t) || t.id !== trackId) return t;
    const notes = t.notes.map((n) => ({ ...n }));
    const targets = notes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => (fromBar == null ? true : n.bar >= fromBar));
    const assign = assignLyrics(
      targets.length,
      text,
    );
    for (let k = 0; k < targets.length; k++) {
      notes[targets[k].i].lyric = assign.assigned[k] || notes[targets[k].i].lyric;
    }
    return { ...t, notes };
  });
  const track = doc.tracks.find((t) => isVocalTrack(t) && t.id === trackId) as VocalTrack | undefined;
  const noteCount = track
    ? track.notes.filter((n) => (fromBar == null ? true : n.bar >= fromBar)).length
    : 0;
  const assign = assignLyrics(noteCount, text);
  return { doc: { ...doc, tracks }, assign };
}
