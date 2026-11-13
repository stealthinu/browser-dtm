// 画面（プロンプトコピー欄・貼り戻し欄・エフェクト・ピアノロール・再生/停止・書き出し）と、自動操作用の window.app。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { parseMML } from "@onjmin/dtm";
import { encodeMp3, encodeWav, levels } from "../core/encode";
import { applyWaveEffects, type CarrierNote } from "../core/fx";
import { buildPrompt, type ImportResult, importResponse } from "../core/prompt";
import {
  EFFECT_LABELS, EFFECT_TYPES, effectAmount, type EffectType, type SongDoc, songSeconds, TPQ, toDtmMML, toVocaTabNotes,
  validateSong, vocalTrack,
} from "../core/songdoc";
import { Player, type Recording, SR } from "./player";
import { VocaTabEngine } from "./vocal";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (s: string) => ($("status").textContent = s);
const log = (s: string) => {
  const el = $("log");
  el.textContent = `${new Date().toLocaleTimeString()} ${s}\n${el.textContent}`;
  console.log(s);
};

const engine = new VocaTabEngine();
const player = new Player();
let doc: SongDoc | null = null;
let vocalCache: { key: string; stereo: [Float32Array, Float32Array]; lead: number; mono: Float32Array } | null = null;
let engineReady = false;

engine.onProgress = (l, t) => status(`モデルを読み込み中… ${Math.round((l / t) * 100)}%`);
const ready = engine.init(new URL("/vocatab/", location.href).href).then((idx) => {
  engineReady = true;
  status(`エンジン準備完了（${idx.voicebanks[0].name}）`);
  log(`VocaTab engine ready: ${idx.voicebanks.map((v) => v.key).join(",")} / vocoders ${idx.vocoders.map((v) => v.key).join(",")}`);
  refreshButtons();
});
ready.catch((e) => status(`エンジンの準備に失敗: ${e}`));

function refreshButtons() {
  const ok = engineReady && !!doc;
  for (const id of ["play", "expMp3", "expWav"]) ($(id) as HTMLButtonElement).disabled = !ok;
}

// ---------------------------------------------------------------- 歌の合成とエフェクト

async function renderVocal(): Promise<NonNullable<typeof vocalCache>> {
  if (!doc) throw new Error("曲がありません");
  await ready;
  const v = vocalTrack(doc)!;
  const notes = toVocaTabNotes(doc, v);
  const fx = Object.fromEntries(EFFECT_TYPES.map((t) => [t, effectAmount(v, t)])) as Record<EffectType, number>;
  const key = JSON.stringify([notes, doc.bpm, v.singer, fx]);
  if (vocalCache?.key === key) return vocalCache;
  status("歌を合成中…");
  const r = await engine.render(notes, doc.bpm, v.singer, fx.kero);
  log(`vocal: ${r.phrases} phrases, ${(r.wav.length / SR).toFixed(2)} s, ${Math.round(r.ms)} ms (kero=${fx.kero})`);
  const spt = 60 / (doc.bpm * TPQ);
  const carrier: CarrierNote[] = notes.map((n) => ({ startSec: n.onset * spt, endSec: (n.onset + n.dur) * spt, midi: n.pitch }));
  const stereo = applyWaveEffects(r.wav, SR, fx, carrier, -r.lead / SR);
  vocalCache = { key, stereo, lead: r.lead, mono: r.wav };
  status("歌の合成 完了");
  return vocalCache;
}

const TAIL = 1.5;

async function play(record = false): Promise<Recording | null> {
  if (!doc) throw new Error("曲がありません");
  const vc = await renderVocal();
  const v = vocalTrack(doc)!;
  const seconds = songSeconds(doc) + TAIL;
  status(record ? "鳴らしながら録音中…" : "再生中");
  animate();
  const rec = await player.play(toDtmMML(doc), vc.stereo, vc.lead, seconds, v.volume ?? 1.0, record);
  return rec;
}
player.onEnd = () => status("停止");

// ---------------------------------------------------------------- 書き出し

function download(bytes: Uint8Array, name: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function save(bytes: Uint8Array, name: string) {
  const r = await fetch(`/api/save?name=${encodeURIComponent(name)}`, { method: "POST", body: bytes });
  return (await r.json()).saved as string;
}

interface ExportOpts { format?: "mp3" | "wav"; name?: string; toServer?: boolean; stems?: boolean }

async function exportAudio(o: ExportOpts = {}) {
  const fmt = o.format ?? "mp3";
  const name = o.name ?? (doc?.title || "song");
  const rec = (await play(true))!;
  status("エンコード中…");
  const bytes = fmt === "mp3" ? encodeMp3(rec.mix, SR) : encodeWav(rec.mix, SR);
  const file = `${name}.${fmt}`;
  const vc = vocalCache!;
  const stats = {
    file, bytes: bytes.length, seconds: rec.mix[0].length / SR,
    mixL: levels(rec.mix[0], SR), mixR: levels(rec.mix[1], SR), acc: levels(rec.acc, SR), vox: levels(rec.vox, SR),
    scheduled: rec.scheduled,
  };
  const saved: string[] = [];
  if (o.toServer) {
    saved.push(await save(bytes, file));
    if (o.stems) {
      saved.push(await save(encodeWav([rec.acc], SR), `${name}.acc.wav`));
      saved.push(await save(encodeWav([rec.vox], SR), `${name}.vox.wav`));
      saved.push(await save(encodeWav(rec.mix, SR), `${name}.mix.wav`));
      // 合成したままの歌（エフェクト後、曲の頭に揃えたもの）: 録音の歌と比べて置き場所のずれを測る
      const ref = vc.stereo[0].subarray(vc.lead);
      saved.push(await save(encodeWav([(ref.length ? ref : new Float32Array(1))], SR), `${name}.vox-ref.wav`));
    }
  } else {
    download(bytes, file, fmt === "mp3" ? "audio/mpeg" : "audio/wav");
  }
  status(`書き出し完了: ${file}`);
  log(`export ${file}: ${JSON.stringify(stats)}`);
  return { ...stats, saved };
}

// ---------------------------------------------------------------- ピアノロール

const COLORS = ["#ffb454", "#59c2ff", "#95e6cb", "#d2a6ff", "#f07178", "#c2d94c"];

let instCache: { mml: string; inst: Array<{ t: number; dur: number; midi: number; tr: number }> } | null = null;

function drawRoll(playSec = -1) {
  const cv = $<HTMLCanvasElement>("roll");
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, cv.width, cv.height);
  if (!doc) return;
  const d = doc;
  const totalTicks = d.bars * d.beatsPerBar * TPQ;
  const v = vocalTrack(d)!;
  const vt = toVocaTabNotes(d, v);
  const mml = toDtmMML(d);
  if (instCache?.mml !== mml) {
    const inst: Array<{ t: number; dur: number; midi: number; tr: number }> = [];
    try {
      for (const p of parseMML(mml).placements) {
        inst.push({ t: p.startStep * 10, dur: p.durationSteps * 10, midi: p.pitchUnits / 31, tr: p.trackIndex });
      }
    } catch (e) {
      log(`MML parse error: ${e}`);
    }
    instCache = { mml, inst };
  }
  const inst = instCache.inst;
  const all = [...vt.map((n) => n.pitch), ...inst.map((n) => n.midi)];
  const lo = Math.min(...all) - 2;
  const hi = Math.max(...all) + 2;
  const L = 40, W = cv.width - L - 4, H = cv.height - 22;
  const x = (t: number) => L + (t / totalTicks) * W;
  const y = (m: number) => 4 + ((hi - m) / (hi - lo + 1)) * H;
  const rowH = H / (hi - lo + 1);
  for (let m = lo; m <= hi; m++) {
    const black = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
    g.fillStyle = black ? "#15171c" : "#1b1e24";
    g.fillRect(L, y(m), W, rowH);
    if (m % 12 === 0) {
      g.fillStyle = "#888";
      g.font = "10px sans-serif";
      g.fillText(`C${m / 12 - 1}`, 4, y(m) + rowH - 1);
    }
  }
  for (let b = 0; b <= d.bars * d.beatsPerBar; b++) {
    g.strokeStyle = b % d.beatsPerBar === 0 ? "#555" : "#2a2d35";
    g.beginPath();
    g.moveTo(x(b * TPQ), 4);
    g.lineTo(x(b * TPQ), 4 + H);
    g.stroke();
    if (b % d.beatsPerBar === 0 && b < d.bars * d.beatsPerBar) {
      g.fillStyle = "#aaa";
      g.fillText(String(b / d.beatsPerBar + 1), x(b * TPQ) + 3, cv.height - 6);
    }
  }
  const instTracks = d.tracks.filter((t) => t.kind === "inst");
  for (const n of inst) {
    g.fillStyle = COLORS[(n.tr + 1) % COLORS.length] + "aa";
    g.fillRect(x(n.t), y(n.midi) + 1, Math.max(2, x(n.t + n.dur) - x(n.t) - 1), rowH - 2);
  }
  g.font = "bold 12px sans-serif";
  for (const n of vt) {
    g.fillStyle = COLORS[0];
    g.fillRect(x(n.onset), y(n.pitch), Math.max(2, x(n.onset + n.dur) - x(n.onset) - 1), rowH);
    g.fillStyle = "#111";
    g.fillText(n.lyric, x(n.onset) + 2, y(n.pitch) + rowH - 2);
  }
  if (playSec >= 0) {
    const t = (playSec * d.bpm * TPQ) / 60;
    g.strokeStyle = "#fff";
    g.beginPath();
    g.moveTo(x(t), 0);
    g.lineTo(x(t), cv.height);
    g.stroke();
  }
  const drums = d.tracks.find((t) => t.kind === "drums");
  $("legend").innerHTML = [`<span style="color:${COLORS[0]}">■ 歌 ${v.id}（${v.singer ?? "ritsu"}）</span>`,
    ...instTracks.map((t, i) => `<span style="color:${COLORS[(i + 1) % COLORS.length]}">■ ${t.id}（${(t as any).program ?? "-"}）</span>`),
    drums ? `<span>ドラム: ${(drums as any).pattern}</span>` : "", `<span>BPM ${d.bpm} / ${d.bars} 小節 / ${d.chords ?? ""}</span>`].join("");
}

function animate() {
  const tick = () => {
    if (!player.isPlaying) return drawRoll();
    drawRoll(player.ctx.currentTime - player.songZero);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- エフェクトの欄

function buildFxUi() {
  $("fxs").innerHTML = EFFECT_TYPES.map((t) => `<div class="fx"><input type="checkbox" id="fx-${t}-on">
    <label for="fx-${t}-on">${EFFECT_LABELS[t]}</label><input type="range" id="fx-${t}" min="0" max="1" step="0.05" value="1">
    <span id="fx-${t}-v">1.00</span></div>`).join("");
  for (const t of EFFECT_TYPES) {
    const upd = () => {
      $(`fx-${t}-v`).textContent = Number(($(`fx-${t}`) as HTMLInputElement).value).toFixed(2);
      readFxUi();
    };
    $(`fx-${t}`).addEventListener("input", upd);
    $(`fx-${t}-on`).addEventListener("change", upd);
  }
}

function readFxUi() {
  if (!doc) return;
  const v = vocalTrack(doc)!;
  v.effects = EFFECT_TYPES.filter((t) => ($(`fx-${t}-on`) as HTMLInputElement).checked)
    .map((t) => ({ type: t, amount: Number(($(`fx-${t}`) as HTMLInputElement).value) }));
}

function writeFxUi() {
  if (!doc) return;
  const v = vocalTrack(doc)!;
  for (const t of EFFECT_TYPES) {
    const e = v.effects?.find((x) => x.type === t);
    ($(`fx-${t}-on`) as HTMLInputElement).checked = !!e;
    ($(`fx-${t}`) as HTMLInputElement).value = String(e?.amount ?? 1);
    $(`fx-${t}-v`).textContent = (e?.amount ?? 1).toFixed(2);
  }
}

// ---------------------------------------------------------------- 読み込み

function loadDoc(d: SongDoc): { problems: unknown[] } {
  doc = d;
  vocalCache = null;
  writeFxUi();
  drawRoll();
  refreshButtons();
  return { problems: validateSong(d) };
}

function importText(text: string): ImportResult {
  const r = importResponse(text, ($("lyrics") as HTMLInputElement).value);
  const show = r.problems.length > 0;
  $("problems").textContent = show ? `問題 ${r.problems.length} 件:\n${r.problems.map((p) => `・${p.path}: ${p.message}`).join("\n")}` : "問題なし";
  $("fix").style.display = $("copyFix").style.display = r.fixRequest ? "" : "none";
  ($("fix") as HTMLTextAreaElement).value = r.fixRequest ?? "";
  // 致命的でない問題（歌詞の違いなど）でも、読めた SongDoc は鳴らせるようにする
  if (r.doc && validateSong(r.doc).length === 0) loadDoc(r.doc);
  log(`import: ${r.problems.length} problems`);
  return r;
}

buildFxUi();
$("mkPrompt").onclick = () => {
  ($("prompt") as HTMLTextAreaElement).value = buildPrompt(($("lyrics") as HTMLInputElement).value, ($("image") as HTMLInputElement).value);
};
$("copyPrompt").onclick = () => navigator.clipboard?.writeText(($("prompt") as HTMLTextAreaElement).value);
$("copyFix").onclick = () => navigator.clipboard?.writeText(($("fix") as HTMLTextAreaElement).value);
$("sample").onclick = async () => {
  ($("answer") as HTMLTextAreaElement).value = await (await fetch("/fixtures/sample-response.txt")).text();
};
$("load").onclick = () => importText(($("answer") as HTMLTextAreaElement).value);
$("play").onclick = () => play(false).catch((e) => status(`再生に失敗: ${e}`));
$("stop").onclick = () => {
  player.stop();
  status("停止");
};
$("expMp3").onclick = () => exportAudio({ format: "mp3" }).catch((e) => status(`書き出しに失敗: ${e}`));
$("expWav").onclick = () => exportAudio({ format: "wav" }).catch((e) => status(`書き出しに失敗: ${e}`));
$("expJson").onclick = () => doc && download(new TextEncoder().encode(JSON.stringify(doc, null, 1)), `${doc.title || "song"}.json`, "application/json");
($("prompt") as HTMLTextAreaElement).value = buildPrompt(($("lyrics") as HTMLInputElement).value, ($("image") as HTMLInputElement).value);

// 自動操作（e2e・MCP サーバー）用
(window as any).app = {
  ready, importText, loadDoc, play, exportAudio, renderVocal,
  getDoc: () => doc,
  setEffects: (fx: Array<{ type: EffectType; amount: number }>) => {
    if (doc) vocalTrack(doc)!.effects = fx;
    writeFxUi();
  },
  isPlaying: () => player.isPlaying,
};
