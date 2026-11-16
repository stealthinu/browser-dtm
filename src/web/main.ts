// 画面（プロンプトコピー欄・貼り戻し欄・エフェクト・ピアノロール・再生/停止・書き出し）と、自動操作用の window.app。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { GALLERY } from "../core/gallery";
import { PianoRoll } from "./pianoroll";
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
let lastVocalRender: unknown = null;
let engineReady = false;
let action = 0;

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
  lastVocalRender = { ms: r.ms, analyzeMs: r.analyzeMs, cached: r.cached, phrases: r.phrases, phraseTimings: r.phraseTimings };
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
  const token = ++action, snapshot = doc;
  const vc = await renderVocal();
  if (token !== action || snapshot !== doc) throw new Error("再生は停止されました");
  const v = vocalTrack(doc)!;
  const seconds = songSeconds(doc) + TAIL;
  status(record ? "書き出し用の音を描画・再生中…" : "再生用の音を描画中…");
  const promise = player.play(toDtmMML(doc), vc.stereo, vc.lead, seconds, v.volume ?? 1.0, record, ($("soundfont") as HTMLInputElement).checked);
  return await promise;
}
player.onWarning = (s) => { $("soundfontWarning").textContent = s; if (s) log(s); };
player.onStart = () => { status("再生中"); animate(); };
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
    scheduled: rec.scheduled, playback: rec.playback, soundfont: rec.soundfont, vocalRender: lastVocalRender,
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

const roll = new PianoRoll($("roll") as HTMLCanvasElement, () => doc, (notes) => {
  if (!doc) return;
  action++; player.stop();
  // 新しい参照で合成中の古い曲も無効化する。
  doc = structuredClone(doc);
  vocalTrack(doc)!.notes = notes;
  vocalCache = null;
  updatePrompt();
}, status);
function drawRoll(playSec = -1) { roll.draw(playSec); }

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
  const problems = validateSong(d);
  if (problems.length) return { problems };
  action++;
  player.stop();
  doc = d;
  vocalCache = null;
  writeFxUi();
  roll.reset();
  updatePrompt();
  drawRoll();
  refreshButtons();
  return { problems: validateSong(d) };
}

function importText(text: string): ImportResult {
  const r = importResponse(text, ($("lyrics") as HTMLInputElement).value);
  const show = r.problems.length > 0;
  $("repairs").textContent = r.repairs.length ? `自動修正した点:\n${r.repairs.map((s) => `・${s}`).join("\n")}` : "";
  $("problems").textContent = show ? `問題 ${r.problems.length} 件:\n${r.problems.map((p) => `・${p.path}: ${p.message}`).join("\n")}` : "問題なし";
  $("fix").style.display = $("copyFix").style.display = r.fixRequest ? "" : "none";
  ($("fix") as HTMLTextAreaElement).value = r.fixRequest ?? "";
  // 致命的でない問題（歌詞の違いなど）でも、読めた SongDoc は鳴らせるようにする
  if (r.doc && validateSong(r.doc).length === 0) loadDoc(r.doc);
  log(`import: ${r.problems.length} problems`);
  return r;
}

buildFxUi();
function updatePrompt() {
  const text = buildPrompt(($("lyrics") as HTMLInputElement).value, ($("image") as HTMLInputElement).value, ($("baseSong") as HTMLInputElement).checked ? doc : null);
  ($("prompt") as HTMLTextAreaElement).value = text;
  return text;
}
$("mkPrompt").onclick = updatePrompt;
for (const id of ["lyrics", "image", "baseSong"]) $(id).addEventListener("input", updatePrompt);
async function copyText(text: string, field: HTMLTextAreaElement) {
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    status("コピーしました");
  } catch {
    field.focus(); field.select();
    const copied = document.execCommand("copy");
    status(copied ? "コピーしました" : "文章を選択しました。手動でコピーしてください");
  }
}
$("copyPrompt").onclick = () => copyText(updatePrompt(), $("prompt") as HTMLTextAreaElement);
$("copyFix").onclick = () => copyText(($("fix") as HTMLTextAreaElement).value, $("fix") as HTMLTextAreaElement);
$("sample").onclick = async () => {
  ($("answer") as HTMLTextAreaElement).value = await (await fetch("/fixtures/sample-response.txt")).text();
};
let loading = false;
$("load").onclick = async () => {
  if (loading) return;
  loading = true;
  ($("load") as HTMLButtonElement).disabled = true;
  try {
    player.stop();
    const r = importText(($("answer") as HTMLTextAreaElement).value);
    if (r.doc && !r.problems.length) await play(false);
    else status("問題を確認して修正依頼文を LLM に返してください");
  } catch (e) { status(`読み込み・再生に失敗: ${e}`); }
  finally { loading = false; ($("load") as HTMLButtonElement).disabled = false; }
};
$("play").onclick = () => play(false).catch((e) => status(`再生に失敗: ${e}`));
$("stop").onclick = () => {
  action++;
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
  rollLayout: () => roll.layout(),
  setEffects: (fx: Array<{ type: EffectType; amount: number }>) => {
    if (doc) vocalTrack(doc)!.effects = fx;
    writeFxUi();
  },
  isPlaying: () => player.isPlaying,
};

// URL は一覧のIDだけを受け付ける。
const sampleId = new URLSearchParams(location.search).get("sample");
if (GALLERY.some(s => s.id === sampleId)) {
  fetch(`/fixtures/gallery/${sampleId}.json`).then(r => r.json()).then(d => {
    ($("lyrics") as HTMLInputElement).value = vocalTrack(d)!.notes.map(n => n.lyric ?? "").join("");
    ($("answer") as HTMLTextAreaElement).value = JSON.stringify(d, null, 2);
    importText(JSON.stringify(d));
    status("サンプルを読み込みました。再生ボタンで試聴できます");
  }).catch(e => status(`サンプルの読み込みに失敗: ${e}`));
}
