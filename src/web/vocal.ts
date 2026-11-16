// VocaTab の歌声合成エンジン（ui/src/engine-web、MIT, Copyright (c) 2026 wavtechyukky）を画面なしで呼ぶ薄い窓口。
// 上流は改造しない: Worker は上流の worker.ts を esbuild で包んだもの（dist/engine-worker.js）、F0 の組み立ては上流の
// composeF0 / phraseParams を import して使う。流れは上流の render.ts と同じ（analyze → composeF0 → synthesize → 句を並べる）。
import { composeF0, type EPhrase, phraseParams } from "@vocatab/engine";
import type { AnalyzeReq, AnalyzeResp, SynthReq, SynthResp, WorkerCall, WorkerReply } from "@vocatab/engine-web/protocol";
import type { WebIndex } from "@vocatab/engine-web/types";
import { defaultBase, FPS, type Project, type Track } from "@vocatab/model";
import type { VtNote } from "../core/songdoc";

export const SR = 44100;
const HOP = 256;

export interface PhraseTiming { index: number; startSec: number; seconds: number; ms: number; notes: number }

export interface VocalRender {
  phraseTimings: PhraseTiming[];
  analyzeMs: number;
  cached: boolean;
  /** 曲の頭（0 秒）= サンプル `lead` の位置。頭の前（最初の句の前の pau・子音）が要るので前に余白を持つ */
  wav: Float32Array;
  lead: number;
  phrases: number;
  ms: number;
}

export class VocaTabEngine {
  private worker: Worker;
  private seq = 0;
  private waiting = new Map<number, { ok: (v: any) => void; ng: (e: Error) => void }>();
  index: WebIndex | null = null;
  onProgress: (loaded: number, total: number) => void = () => {};
  private cache = new Map<string, { wav: Float32Array; phraseTimings: PhraseTiming[] }>();

  constructor(workerUrl = "/dist/engine-worker.js") {
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.type === "progress") return this.onProgress(m.loaded, m.total);
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.type === "result") w.ok(m.result);
      else w.ng(new Error(m.error));
    };
  }

  private send<T>(m: WorkerCall, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, ng) => {
      this.waiting.set(id, { ok, ng });
      this.worker.postMessage({ ...m, id }, transfer);
    });
  }

  /** base: VocaTab のリポジトリの頭の URL（web_index.json・voicebanks・vocoders がある所） */
  async init(base: string): Promise<WebIndex> {
    this.index = await this.send<WebIndex>({ type: "init", base, gpu: false }); // GPU は使わない（SPEC §4）
    return this.index;
  }

  singerId(name?: string): number {
    const vb = this.index!.voicebanks[0];
    return vb.singers.find((s) => s.name === name)?.id ?? vb.singers.find((s) => s.name === "ritsu")?.id ?? 0;
  }

  /**
   * 歌トラックを合成して、曲の時間軸に並べた 1 本の波形にする。
   * kero（0〜1）: ケロケロボイス。最後の F0 を音符の音高の階段へ寄せる（1 で完全に平ら＝ビブラート・しゃくりが消える）。
   */
  async render(notes: VtNote[], bpm: number, singer: string | undefined, kero = 0): Promise<VocalRender> {
    const t0 = performance.now();
    const vb = this.index!.voicebanks[0];
    const voc = this.index!.vocoders.find((v) => v.key === vb.default_vocoder) ?? this.index!.vocoders[0];
    const sid = this.singerId(singer);
    const key = JSON.stringify([notes, bpm, sid, kero, voc.key]);
    const hit = this.cache.get(key);
    const req: AnalyzeReq = { voicebank: vb.key, singer: sid, bpm, seed: 0, lyric_style: "sequential",
                              notes: notes.map((n) => ({ id: n.id, onset: n.onset, dur: n.dur, pitch: n.pitch, lyric: n.lyric,
                                                         retake_f0: 0, ph_shift: {} })) };
    const an = await this.send<AnalyzeResp>({ type: "analyze", req });
    const analyzeMs = performance.now() - t0;
    const track: Track = { id: 1, name: "vo", voice: singer ?? "ritsu", color: "", mute: false, solo: false, base: defaultBase(),
                           params: {}, notes: notes.map((n) => ({ ...n, attrs: { vMod: 1 } })) };
    const project: Project = { bpm, beatsPerBar: 4, tracks: [track], activeTrack: 1 };
    const pitchOf = new Map(notes.map((n) => [n.id, Math.log2(440) + (n.pitch - 69) / 12]));
    const minStart = Math.min(0, ...an.phrases.map((q) => q.start_frame * HOP));
    const lead = -minStart + HOP * 4;
    if (hit) return { wav: hit.wav, phraseTimings: hit.phraseTimings, analyzeMs, cached: true, lead, phrases: an.phrases.length, ms: performance.now() - t0 };
    const phraseTimings: PhraseTiming[] = [];
    const parts: Array<{ start: number; wav: Float32Array }> = [];
    for (const [index, q] of an.phrases.entries()) {
      const phraseStart = performance.now();
      const ph: EPhrase = { key: q.key, noteIds: q.note_ids, startFrame: q.start_frame, startSec: q.start_sec, nFrames: q.n_frames,
                            phonemes: q.phonemes, plain: q.plain, base: q.base, vib: q.vib, uv: q.uv, seed: q.seed, status: "解析済み" };
      const { log2 } = composeF0(ph, track, project);
      if (kero > 0) flattenF0(log2, ph, pitchOf, kero);
      const sreq: SynthReq = { voicebank: vb.key, singer: sid, key: q.key, f0_log2: log2, vocoder: voc.key,
                               params: phraseParams(ph, track, project), mel_out: false, mel_plain: false, retake_mel: {}, ph_dip: {} };
      const res = await this.send<SynthResp>({ type: "synthesize", req: sreq });
      for (let i = 0; i < res.wav.length; i++) if (!Number.isFinite(res.wav[i])) res.wav[i] = 0;
      parts.push({ start: q.start_frame * HOP + lead, wav: res.wav });
      phraseTimings.push({ index, startSec: q.start_frame * HOP / SR, seconds: res.wav.length / SR, ms: performance.now() - phraseStart, notes: q.note_ids.length });
    }
    let n = lead;
    for (const p of parts) n = Math.max(n, p.start + p.wav.length);
    const wav = new Float32Array(n);
    for (const p of parts) for (let i = 0; i < p.wav.length; i++) wav[p.start + i] += p.wav[i];
    this.cache.set(key, { wav, phraseTimings });
    return { wav, lead, phrases: an.phrases.length, ms: performance.now() - t0, phraseTimings, analyzeMs, cached: false };
  }
}

/** ケロケロボイス: 音符に属するフレームの F0 を、その音符の音高（12 平均律の階段）へ amount の割合だけ寄せる。 */
export function flattenF0(log2: Float32Array, ph: EPhrase, pitchOf: Map<number, number>, amount: number): void {
  let f = 0;
  for (const p of ph.phonemes) {
    const target = p.note === null ? undefined : pitchOf.get(p.note);
    for (let k = 0; k < p.frames && f < log2.length; k++, f++) {
      if (target !== undefined) log2[f] += (target - log2[f]) * amount;
    }
  }
}

export { FPS };
