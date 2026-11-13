import { songDocVocalToVocaTab } from "../songdoc/convert";
import { parseMML } from "@onjmin/dtm";
import { songDocToDtmMml } from "../songdoc/convert";
import { unitsToMidi } from "@onjmin/dtm";
import type { SongDoc } from "../songdoc/types";
import { TPQ } from "../songdoc/timing";

const STEPS_PER_BAR = 192;

export function drawPianoRoll(canvas: HTMLCanvasElement, doc: SongDoc | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#1a1f24";
  ctx.fillRect(0, 0, w, h);
  if (!doc) {
    ctx.fillStyle = "#8a93a0";
    ctx.font = "14px ui-monospace, monospace";
    ctx.fillText("SongDoc を読み込むとピアノロールが表示されます", 16, 28);
    return;
  }

  const bars = doc.bars;
  const minMidi = 36;
  const maxMidi = 84;
  const rows = maxMidi - minMidi + 1;
  const rowH = h / rows;
  const colW = w / bars;

  // 鍵盤背景
  for (let m = minMidi; m <= maxMidi; m++) {
    const y = (maxMidi - m) * rowH;
    const black = [1, 3, 6, 8, 10].includes(m % 12);
    ctx.fillStyle = black ? "#22282f" : "#2a3138";
    ctx.fillRect(0, y, w, rowH);
  }
  // 小節線
  ctx.strokeStyle = "#3a4450";
  ctx.lineWidth = 1;
  for (let b = 0; b <= bars; b++) {
    const x = b * colW;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // 伴奏
  try {
    const mml = songDocToDtmMml(doc);
    const parsed = parseMML(mml);
    ctx.fillStyle = "rgba(80, 160, 220, 0.55)";
    for (const p of parsed.placements) {
      const midi = unitsToMidi(p.pitchUnits);
      if (midi < minMidi || midi > maxMidi) continue;
      const startBar = p.startStep / STEPS_PER_BAR;
      const durBar = p.durationSteps / STEPS_PER_BAR;
      const x = startBar * colW;
      const bw = Math.max(2, durBar * colW - 1);
      const y = (maxMidi - midi) * rowH + 1;
      ctx.fillRect(x, y, bw, rowH - 2);
    }
  } catch {
    /* MML parse optional for display */
  }

  // 歌
  const notes = songDocVocalToVocaTab(doc);
  const songTicks = doc.bars * doc.beatsPerBar * TPQ;
  ctx.fillStyle = "rgba(230, 120, 90, 0.85)";
  for (const n of notes) {
    if (n.pitch < minMidi || n.pitch > maxMidi) continue;
    const x = (n.onset / songTicks) * w;
    const bw = Math.max(2, (n.dur / songTicks) * w - 1);
    const y = (maxMidi - n.pitch) * rowH + 1;
    ctx.fillRect(x, y, bw, rowH - 2);
  }

  ctx.fillStyle = "#c8d0d8";
  ctx.font = "12px ui-monospace, monospace";
  ctx.fillText(`${doc.title}  BPM ${doc.bpm}  ${doc.bars} bars  (橙=歌 / 青=伴奏)`, 8, 14);
}
