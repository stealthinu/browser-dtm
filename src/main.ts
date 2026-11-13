import "./ui/styles.css";
import sampleSong from "../fixtures/sample-songdoc.json";
import promptTemplate from "../fixtures/llm-prompt-template.txt?raw";
import llmSample from "../fixtures/llm-response-sample.txt?raw";
import { session } from "./audio/session";
import { songDocToDtmMml } from "./songdoc/convert";
import type { SongDoc, VocalEffects } from "./songdoc/types";
import { correctionPrompt, extractSongDocFromText, parseSongDocJson } from "./songdoc/validate";
import { drawPianoRoll } from "./ui/pianoroll";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let song: SongDoc | null = null;

function setStatus(msg: string, kind: "" | "ok" | "err" = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function readFx(): VocalEffects {
  return {
    kerokero: Number(($("fx-kerokero") as HTMLInputElement).value),
    vocoder: Number(($("fx-vocoder") as HTMLInputElement).value),
    bitcrusher: Number(($("fx-bitcrusher") as HTMLInputElement).value),
    doubling: Number(($("fx-doubling") as HTMLInputElement).value),
  };
}

function applyFxToSong(doc: SongDoc): SongDoc {
  const fx = readFx();
  return {
    ...doc,
    tracks: doc.tracks.map((t) => (t.kind === "vocal" ? { ...t, effects: fx } : t)),
  };
}

function refreshRoll(): void {
  drawPianoRoll($("roll") as HTMLCanvasElement, song);
}

function loadSong(doc: SongDoc): void {
  song = doc;
  const fx = doc.tracks.find((t) => t.kind === "vocal")?.effects;
  if (fx) {
    ($("fx-kerokero") as HTMLInputElement).value = String(fx.kerokero ?? 0);
    ($("fx-vocoder") as HTMLInputElement).value = String(fx.vocoder ?? 0);
    ($("fx-bitcrusher") as HTMLInputElement).value = String(fx.bitcrusher ?? 0);
    ($("fx-doubling") as HTMLInputElement).value = String(fx.doubling ?? 0);
  }
  refreshRoll();
  setStatus(`読み込み: ${doc.title} / BPM ${doc.bpm} / ${doc.bars} bars`, "ok");
}

function buildPrompt(): string {
  const lyrics = ($("lyrics") as HTMLInputElement).value || "ゆうやけ そらに とけていく";
  const image = ($("image") as HTMLInputElement).value || "BPM 120、明るいポップ、8小節";
  return promptTemplate.replace("{{LYRICS}}", lyrics).replace("{{IMAGE}}", image);
}

async function onPasteLoad(): Promise<void> {
  const text = ($("paste") as HTMLTextAreaElement).value;
  const { json, error } = extractSongDocFromText(text);
  if (!json) {
    setStatus(`抽出失敗: ${error}`, "err");
    return;
  }
  const v = parseSongDocJson(json);
  if (!v.ok) {
    ($("correction") as HTMLTextAreaElement).value = correctionPrompt(v.errors, v.warnings);
    setStatus(`検査エラー:\n${v.errors.join("\n")}`, "err");
    return;
  }
  ($("correction") as HTMLTextAreaElement).value = v.warnings.length
    ? correctionPrompt([], v.warnings)
    : "";
  loadSong(json as SongDoc);
}

async function onPlay(): Promise<void> {
  if (!song) return setStatus("先に SongDoc を読み込んでください", "err");
  try {
    setStatus("合成中（VocaTab）…");
    const doc = applyFxToSong(song);
    await session.renderVocal(doc);
    setStatus("再生中…");
    const r = await session.play(doc);
    setStatus(`再生開始\nMML:\n${r.mml.slice(0, 240)}…`, "ok");
  } catch (e) {
    setStatus(`再生失敗: ${e instanceof Error ? e.message : String(e)}`, "err");
  }
}

async function onStop(): Promise<void> {
  session.stop();
  setStatus("停止");
}

async function onExport(): Promise<void> {
  if (!song) return setStatus("先に SongDoc を読み込んでください", "err");
  try {
    setStatus("書き出し中（実再生録音→MP3）…数秒〜十数秒かかります");
    const doc = applyFxToSong(song);
    const result = await session.exportMix(doc);
    const blob = new Blob([result.mp3], { type: "audio/mpeg" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.title || "mix"}.mp3`;
    a.click();
    // 受入テスト用に window へ載せる
    (window as unknown as { __lastExport?: unknown }).__lastExport = {
      metrics: result.metrics,
      mp3Bytes: result.mp3.byteLength,
      wavBytes: result.wav.byteLength,
      vocalSeconds: result.vocal.seconds,
      phrases: result.vocal.phrases,
      mml: songDocToDtmMml(doc),
      song: doc,
    };
    setStatus(
      `MP3 ${result.mp3.byteLength} bytes\n` +
        `mix RMS=${result.metrics.mixRms.toFixed(4)} peak=${result.metrics.mixPeak.toFixed(4)}\n` +
        `vocal onset=${result.metrics.vocalOnsetMs.toFixed(1)}ms backing onset=${result.metrics.backingOnsetMs.toFixed(1)}ms\n` +
        `offset(vocal-backing)=${result.metrics.offsetMs.toFixed(1)}ms scheduledDelay=${result.metrics.scheduledDelaySec}s`,
      "ok",
    );
  } catch (e) {
    setStatus(`書き出し失敗: ${e instanceof Error ? e.message : String(e)}`, "err");
  }
}

function wire(): void {
  ($("lyrics") as HTMLInputElement).value = "ゆうやけ そらに とけていく";
  ($("image") as HTMLInputElement).value = "BPM 120、明るいポップ、8小節";
  ($("prompt") as HTMLTextAreaElement).value = buildPrompt();
  ($("paste") as HTMLTextAreaElement).value = llmSample;

  $("btn-prompt").onclick = async () => {
    ($("prompt") as HTMLTextAreaElement).value = buildPrompt();
    await navigator.clipboard.writeText(($("prompt") as HTMLTextAreaElement).value);
    setStatus("プロンプトをコピーしました", "ok");
  };
  $("btn-load-sample").onclick = () => {
    ($("paste") as HTMLTextAreaElement).value = llmSample;
    void onPasteLoad();
  };
  $("btn-paste").onclick = () => void onPasteLoad();
  $("btn-play").onclick = () => void onPlay();
  $("btn-stop").onclick = () => void onStop();
  $("btn-export").onclick = () => void onExport();
  for (const id of ["fx-kerokero", "fx-vocoder", "fx-bitcrusher", "fx-doubling"]) {
    $(id).oninput = () => {
      if (song) {
        song = applyFxToSong(song);
        refreshRoll();
      }
    };
  }

  // 受入テスト API
  Object.assign(window, {
    __browserDtm: {
      loadFixture: () => {
        loadSong(sampleSong as SongDoc);
        return sampleSong;
      },
      loadPaste: onPasteLoad,
      play: onPlay,
      stop: onStop,
      exportMix: onExport,
      getSong: () => song,
      getStatus: () => $("status").textContent,
      session,
    },
  });

  loadSong(sampleSong as SongDoc);
  setStatus("準備完了。見本を読み込み済み。Play / Export を押してください。", "ok");
}

wire();
