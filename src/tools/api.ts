/**
 * LLM 向け道具群（事実だけを返す、点数は返さない）。
 * ブラウザと MCP（Node）で同じ実装を共有する。
 */
import { applyLyricsToTrack, convertAndCheck, songDocToDtmMml } from "../songdoc/convert.js";
import { emptySongDoc, isInstTrack, isVocalTrack, type SongDoc, type SongTrack, type VocalEffects, type VocalNote } from "../songdoc/types.js";
import { parseSongDocJson } from "../songdoc/validate.js";

export type ToolName =
  | "get_song"
  | "new_song"
  | "set_chords"
  | "set_track_mml"
  | "set_track_notes"
  | "set_lyrics"
  | "set_drums"
  | "set_mix"
  | "set_effects"
  | "render"
  | "export"
  | "finish";

export interface ToolResult {
  ok: boolean;
  tool: ToolName;
  data: Record<string, unknown>;
}

export interface SongStore {
  get(): SongDoc | null;
  set(doc: SongDoc): void;
}

export interface ExportHooks {
  /** 書き出し実体。未実装ならパスだけ返す */
  exportFile?: (doc: SongDoc, format: "mp3" | "wav" | "json") => Promise<{ path: string; bytes?: number }>;
  renderVocal?: (doc: SongDoc) => Promise<{ phrases: number; seconds: number; error?: string }>;
}

export function createToolRunner(store: SongStore, hooks: ExportHooks = {}) {
  const need = (): SongDoc => {
    const d = store.get();
    if (!d) throw new Error("曲がない。先に new_song するか SongDoc を読み込んでください");
    return d;
  };

  async function run(tool: ToolName, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (tool) {
        case "get_song": {
          const doc = store.get();
          if (!doc) return { ok: true, tool, data: { empty: true } };
          const part = (args.part as string) || "summary";
          if (part === "full") return { ok: true, tool, data: { song: doc } };
          const check = convertAndCheck(doc);
          return {
            ok: true,
            tool,
            data: {
              title: doc.title,
              bpm: doc.bpm,
              bars: doc.bars,
              key: doc.key,
              tracks: doc.tracks.map((t) => ({
                id: t.id,
                kind: t.kind,
                notes: isVocalTrack(t) ? t.notes.length : undefined,
                mmlLen: isInstTrack(t) ? t.mml.length : undefined,
                pattern: t.kind === "drums" ? t.pattern : undefined,
              })),
              vocalNotes: check.vocalNotes,
              instTracks: check.instTracks,
              drumPattern: check.drumPattern,
            },
          };
        }
        case "new_song": {
          const doc = emptySongDoc({
            bpm: Number(args.bpm) || 120,
            beatsPerBar: Number(args.beatsPerBar) || 4,
            key: String(args.key || "C"),
            bars: Number(args.bars) || 8,
            title: args.title ? String(args.title) : "untitled",
          });
          store.set(doc);
          return { ok: true, tool, data: { song: doc } };
        }
        case "set_chords": {
          const doc = { ...need(), chords: String(args.progression || "") };
          store.set(doc);
          return { ok: true, tool, data: { chords: doc.chords } };
        }
        case "set_track_mml": {
          const doc = need();
          const trackId = String(args.trackId);
          const mml = String(args.mml || "");
          let found = false;
          const tracks = doc.tracks.map((t) => {
            if (t.id !== trackId) return t;
            found = true;
            if (t.kind === "inst") {
              return {
                ...t,
                mml,
                program: args.program ? String(args.program) : t.program,
                font: args.font ? (String(args.font) as "FluidR3" | "GeneralUserGS") : t.font,
              };
            }
            return t;
          });
          if (!found) {
            tracks.push({
              id: trackId,
              kind: "inst",
              mml,
              program: args.program ? String(args.program) : "Acoustic Grand Piano",
              font: "FluidR3",
            });
          }
          const next = { ...doc, tracks };
          store.set(next);
          const check = convertAndCheck(next);
          return {
            ok: check.errors.length === 0,
            tool,
            data: {
              trackId,
              mmlChars: mml.length,
              fullMml: check.mml,
              errors: check.errors,
            },
          };
        }
        case "set_track_notes": {
          const doc = need();
          const trackId = String(args.trackId);
          const notes = (args.notes as VocalNote[]) || [];
          let found = false;
          const tracks = doc.tracks.map((t) => {
            if (t.id !== trackId) return t;
            found = true;
            if (t.kind === "vocal") {
              const fromBar = args.fromBar != null ? Number(args.fromBar) : null;
              const toBar = args.toBar != null ? Number(args.toBar) : null;
              const kept = t.notes.filter((n) => {
                if (fromBar != null && n.bar < fromBar) return true;
                if (toBar != null && n.bar > toBar) return true;
                if (fromBar != null || toBar != null) return false;
                return false;
              });
              const merged = fromBar == null && toBar == null ? notes : [...kept, ...notes];
              merged.sort((a, b) => a.bar - b.bar || a.beat - b.beat);
              return { ...t, notes: merged };
            }
            return t;
          });
          if (!found) {
            tracks.push({
              id: trackId,
              kind: "vocal",
              engine: "vocatab",
              singer: 2,
              singerName: "ritsu",
              notes,
            });
          }
          const next = { ...doc, tracks };
          store.set(next);
          const check = convertAndCheck(next);
          return {
            ok: check.errors.length === 0,
            tool,
            data: { trackId, placed: notes.length, vocalNotes: check.vocalNotes, errors: check.errors },
          };
        }
        case "set_lyrics": {
          const doc = need();
          const trackId = String(args.trackId);
          const text = String(args.text || "");
          const fromBar = args.fromBar != null ? Number(args.fromBar) : undefined;
          const { doc: next, assign } = applyLyricsToTrack(doc, trackId, text, fromBar);
          store.set(next);
          return {
            ok: assign.ok,
            tool,
            data: {
              trackId,
              assigned: assign.assigned,
              leftover: assign.leftover,
              extraMoras: assign.extraMoras,
              missingMoras: assign.missingMoras,
              summary: assign.summary,
            },
          };
        }
        case "set_drums": {
          const doc = need();
          const pattern = String(args.pattern || "8beat");
          let found = false;
          const tracks: SongTrack[] = doc.tracks.map((t) => {
            if (t.kind !== "drums") return t;
            found = true;
            return { ...t, pattern };
          });
          if (!found) tracks.push({ id: "dr", kind: "drums", pattern });
          const next = { ...doc, tracks };
          store.set(next);
          return { ok: true, tool, data: { pattern } };
        }
        case "set_mix": {
          const doc = need();
          const trackId = String(args.trackId);
          const tracks = doc.tracks.map((t) => {
            if (t.id !== trackId) return t;
            if (t.kind === "vocal") {
              return {
                ...t,
                volume: args.volume != null ? Number(args.volume) : t.volume,
                pan: args.pan != null ? Number(args.pan) : t.pan,
              };
            }
            if (t.kind === "inst" || t.kind === "drums") {
              return {
                ...t,
                volume: args.volume != null ? Number(args.volume) : t.volume,
              };
            }
            return t;
          });
          store.set({ ...doc, tracks });
          return { ok: true, tool, data: { trackId, volume: args.volume, pan: args.pan } };
        }
        case "set_effects": {
          const doc = need();
          const trackId = String(args.trackId || "vo");
          const fx = (args.effects || args) as VocalEffects;
          const tracks = doc.tracks.map((t) => {
            if (!isVocalTrack(t) || t.id !== trackId) return t;
            return {
              ...t,
              effects: {
                kerokero: clamp01(fx.kerokero ?? t.effects?.kerokero ?? 0),
                vocoder: clamp01(fx.vocoder ?? t.effects?.vocoder ?? 0),
                bitcrusher: clamp01(fx.bitcrusher ?? t.effects?.bitcrusher ?? 0),
                doubling: clamp01(fx.doubling ?? t.effects?.doubling ?? 0),
              },
            };
          });
          store.set({ ...doc, tracks });
          const v = tracks.find((t) => isVocalTrack(t) && t.id === trackId) as { effects?: VocalEffects } | undefined;
          return { ok: true, tool, data: { trackId, effects: v?.effects ?? {} } };
        }
        case "render": {
          const doc = need();
          if (hooks.renderVocal) {
            const r = await hooks.renderVocal(doc);
            return { ok: !r.error, tool, data: r };
          }
          const check = convertAndCheck(doc);
          return {
            ok: check.errors.length === 0,
            tool,
            data: {
              what: args.what || "all",
              phrases: check.vocalNotes > 0 ? 1 : 0,
              seconds: (doc.bars * doc.beatsPerBar * 60) / doc.bpm,
              mmlReady: check.mml.length > 0,
              errors: check.errors,
              note: "ブラウザ側で実合成が走る。ここは準備状態のみ",
            },
          };
        }
        case "export": {
          const doc = need();
          const format = (String(args.format || "mp3") as "mp3" | "wav" | "json");
          if (hooks.exportFile) {
            const r = await hooks.exportFile(doc, format);
            return { ok: true, tool, data: r };
          }
          if (format === "json") {
            return { ok: true, tool, data: { format, song: doc } };
          }
          return {
            ok: true,
            tool,
            data: {
              format,
              mml: songDocToDtmMml(doc),
              note: "音声ファイルはブラウザ/accept:render 経路で書き出す",
            },
          };
        }
        case "finish": {
          return {
            ok: true,
            tool,
            data: { notes: String(args.notes || ""), done: true },
          };
        }
        default:
          return { ok: false, tool, data: { error: `未知の道具: ${tool}` } };
      }
    } catch (e) {
      return {
        ok: false,
        tool,
        data: { error: e instanceof Error ? e.message : String(e) },
      };
    }
  }

  return { run, loadSongDoc: (raw: unknown) => {
    const v = parseSongDocJson(raw);
    if (v.ok) store.set(raw as SongDoc);
    return v;
  } };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export const TOOL_DEFS: Array<{ name: ToolName; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: "get_song",
    description: "現在の曲の要約または全文を返す",
    inputSchema: {
      type: "object",
      properties: { part: { type: "string", enum: ["summary", "full"] } },
    },
  },
  {
    name: "new_song",
    description: "空の SongDoc を作る",
    inputSchema: {
      type: "object",
      required: ["bpm", "bars"],
      properties: {
        bpm: { type: "number" },
        beatsPerBar: { type: "number" },
        key: { type: "string" },
        bars: { type: "number" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "set_chords",
    description: "和音進行を設定する",
    inputSchema: {
      type: "object",
      required: ["progression"],
      properties: { progression: { type: "string" }, fromBar: { type: "number" } },
    },
  },
  {
    name: "set_track_mml",
    description: "伴奏トラックの MML を設定する",
    inputSchema: {
      type: "object",
      required: ["trackId", "mml"],
      properties: {
        trackId: { type: "string" },
        mml: { type: "string" },
        program: { type: "string" },
        font: { type: "string" },
      },
    },
  },
  {
    name: "set_track_notes",
    description: "歌トラックの音符を設定する",
    inputSchema: {
      type: "object",
      required: ["trackId", "notes"],
      properties: {
        trackId: { type: "string" },
        fromBar: { type: "number" },
        toBar: { type: "number" },
        notes: { type: "array" },
      },
    },
  },
  {
    name: "set_lyrics",
    description: "かな歌詞を1モーラ=1音符で割り当てる。ーは伸ばし。っ・んは1モーラ",
    inputSchema: {
      type: "object",
      required: ["trackId", "text"],
      properties: {
        trackId: { type: "string" },
        text: { type: "string" },
        fromBar: { type: "number" },
      },
    },
  },
  {
    name: "set_drums",
    description: "ドラムパターンを設定する",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: { pattern: { type: "string" } },
    },
  },
  {
    name: "set_mix",
    description: "トラックの音量・パンを設定する",
    inputSchema: {
      type: "object",
      required: ["trackId"],
      properties: {
        trackId: { type: "string" },
        volume: { type: "number" },
        pan: { type: "number" },
      },
    },
  },
  {
    name: "set_effects",
    description: "歌トラックのエフェクト強度(0-1)を設定する",
    inputSchema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        kerokero: { type: "number" },
        vocoder: { type: "number" },
        bitcrusher: { type: "number" },
        doubling: { type: "number" },
      },
    },
  },
  {
    name: "render",
    description: "合成の準備状態を返す",
    inputSchema: {
      type: "object",
      properties: { what: { type: "string", enum: ["vocal", "all"] } },
    },
  },
  {
    name: "export",
    description: "mp3 / wav / json を書き出す",
    inputSchema: {
      type: "object",
      properties: { format: { type: "string", enum: ["mp3", "wav", "json"] } },
    },
  },
  {
    name: "finish",
    description: "作業完了を記録する",
    inputSchema: {
      type: "object",
      properties: { notes: { type: "string" } },
    },
  },
];
