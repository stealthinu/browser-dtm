/**
 * VocaTab engine-web を画面なしで呼ぶ薄いラッパ。
 * 上流は改造せず、Worker（ui/dist/engine-worker.js）を import / メッセージで使う。
 */
import { composeF0, phraseParams } from "vocatab-src/engine";
import { defaultBase, type Note, type Project, type Track } from "vocatab-src/model";
import type { AnalyzeResp, SynthResp } from "vocatab-src/engine-web/protocol";
import type { VocaTabNote } from "../songdoc/convert";
import { applyVocalFx, type FxParams } from "../fx/vocal-fx";

const SAMPLE_RATE = 44100;
const HOP = 256;

export interface VocalRenderResult {
  sampleRate: number;
  wav: Float32Array;
  phrases: number;
  seconds: number;
  startSec: number;
}

type WorkerReply =
  | { type: "result"; id: number; result: unknown }
  | { type: "error"; id: number; error: string }
  | { type: "progress"; loaded: number; total: number };

export class VocalEngine {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, { ok: (v: unknown) => void; ng: (e: Error) => void }>();
  private baseUrl: string;
  private ready: Promise<void> | null = null;

  constructor(baseUrl: string, workerUrl: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    this.worker = new Worker(workerUrl, { type: "classic" });
    this.worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.type === "progress") return;
      const wt = this.waiting.get(m.id);
      if (!wt) return;
      this.waiting.delete(m.id);
      if (m.type === "result") wt.ok(m.result);
      else wt.ng(new Error(m.error));
    };
    this.worker.onerror = (e) => {
      const err = new Error(`vocal worker: ${e.message}`);
      for (const wt of this.waiting.values()) wt.ng(err);
      this.waiting.clear();
    };
  }

  private send<T>(m: Record<string, unknown>): Promise<T> {
    const w = this.worker;
    if (!w) return Promise.reject(new Error("worker not running"));
    const id = ++this.seq;
    return new Promise<T>((ok, ng) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, ng });
      w.postMessage({ ...m, id });
    });
  }

  async init(gpu = false): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.send({ type: "init", base: this.baseUrl, gpu }).then(() => undefined);
    return this.ready;
  }

  async render(
    notes: VocaTabNote[],
    bpm: number,
    opts: {
      voicebank?: string;
      singer?: number;
      vocoder?: string;
      effects?: Partial<FxParams> | null;
    } = {},
  ): Promise<VocalRenderResult> {
    await this.init(false);
    const voicebank = opts.voicebank || "leapsinger_ja_3singer";
    const singer = opts.singer ?? 2;
    const vocoder = opts.vocoder || "nhvsing_v3_2_1";

    const analyzed = await this.send<AnalyzeResp>({
      type: "analyze",
      req: {
        voicebank,
        singer,
        bpm,
        seed: 0,
        notes: notes.map((n) => ({
          id: n.id,
          onset: n.onset,
          dur: n.dur,
          pitch: n.pitch,
          lyric: n.lyric,
          retake_f0: 0,
        })),
        lyric_style: "sequential",
      },
    });

    const project = {
      bpm,
      beatsPerBar: 4,
      tracks: [],
      activeTrack: 0,
    } as Project;

    const trackNotes: Note[] = notes.map((n) => ({
      id: n.id,
      onset: n.onset,
      dur: n.dur,
      pitch: n.pitch,
      lyric: n.lyric,
      attrs: { vMod: 1 },
    }));

    const track = {
      id: 1,
      name: "vo",
      voice: "ritsu",
      voicebank,
      color: "#88a",
      notes: trackNotes,
      mute: false,
      solo: false,
      base: defaultBase(),
      params: {},
    } as Track;

    const parts: Array<{ start: number; wav: Float32Array }> = [];
    for (const q of analyzed.phrases) {
      const ph = {
        key: q.key,
        noteIds: q.note_ids,
        startFrame: q.start_frame,
        startSec: q.start_sec,
        nFrames: q.n_frames,
        phonemes: q.phonemes,
        plain: q.plain,
        vib: q.vib,
        uv: q.uv,
        base: q.base,
        seed: q.seed,
        status: "解析済み" as const,
      };
      const { log2 } = composeF0(ph, track, project);
      const params = phraseParams(ph, track, project);
      const synth = await this.send<SynthResp>({
        type: "synthesize",
        req: {
          voicebank,
          singer,
          key: ph.key,
          f0_log2: log2,
          vocoder,
          params,
          mel_out: false,
          mel_plain: false,
          retake_mel: {},
        },
      });
      const wavArr =
        synth.wav instanceof Float32Array
          ? synth.wav
          : new Float32Array(synth.wav as unknown as ArrayLike<number>);
      parts.push({ start: Math.floor(ph.startFrame * HOP), wav: wavArr });
    }

    if (!parts.length) throw new Error("合成された句が無い");
    const wav = assembleParts(parts);
    const effected = applyVocalFx(wav, SAMPLE_RATE, opts.effects);
    const startSec = analyzed.phrases[0]?.start_sec ?? 0;
    return {
      sampleRate: SAMPLE_RATE,
      wav: effected,
      phrases: analyzed.phrases.length,
      seconds: effected.length / SAMPLE_RATE,
      startSec,
    };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

function assembleParts(parts: Array<{ start: number; wav: Float32Array }>): Float32Array {
  const normalized = parts.map((p) => {
    const start = Math.max(0, Math.floor(Number(p.start) || 0));
    const wav =
      p.wav instanceof Float32Array
        ? p.wav
        : new Float32Array(p.wav as unknown as ArrayLike<number>);
    return { start, wav };
  });
  let end = 0;
  for (const p of normalized) end = Math.max(end, p.start + p.wav.length);
  const out = new Float32Array(Math.max(1, end));
  for (const p of normalized) {
    if (p.wav.length === 0) continue;
    if (p.start + p.wav.length > out.length) {
      throw new Error(
        `assembleParts overflow: start=${p.start} wav=${p.wav.length} end=${out.length}`,
      );
    }
    out.set(p.wav, p.start);
  }
  return out;
}

export function resolveVocatabUrls(): { baseUrl: string; workerUrl: string } {
  const basePath =
    (import.meta as { env?: { VITE_VOCATAB_BASE?: string } }).env?.VITE_VOCATAB_BASE || "/vocatab/";
  const origin = typeof location !== "undefined" ? location.href : "http://127.0.0.1:5300/";
  const baseUrl = new URL(basePath, origin).href;
  return {
    baseUrl,
    workerUrl: new URL("ui/dist/engine-worker.js", baseUrl).href,
  };
}
