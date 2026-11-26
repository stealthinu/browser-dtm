// フルコーラス SongDoc（未編集の LLM 返答）をアプリのパーサと MML 長で検査する。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "out/fullchorus");
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [resolve(ROOT, "src/core/prompt.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: resolve(ROOT, "out/fullchorus/prompt-node.mjs"),
});
await build({
  entryPoints: [resolve(ROOT, "src/core/tools.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: resolve(ROOT, "out/fullchorus/tools-node.mjs"),
});
await build({
  entryPoints: [resolve(ROOT, "src/core/songdoc.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: resolve(ROOT, "out/fullchorus/songdoc-node.mjs"),
});
const { importResponse } = await import("../out/fullchorus/prompt-node.mjs");
const { SongSession } = await import("../out/fullchorus/tools-node.mjs");
const { splitMorae, pitchToMidi } = await import("../out/fullchorus/songdoc-node.mjs");
globalThis.Worker ??= class { postMessage() {} addEventListener() {} };
const { parseMML } = await import("@onjmin/dtm");

const plans = JSON.parse(readFileSync(resolve(OUT, "prompts/stage1-songs.json"), "utf8")).songs;
const required = process.argv.slice(2);
const ids = required.length ? required : plans.map((s) => s.id);

function lyricsLine(s) {
  return s.lyrics_hiragana.replace(/\n+/g, " ").replace(/ +/g, " ").trim();
}

function sectionOf(bar, barMap) {
  for (const x of barMap) {
    const [a, b] = x.bars.split("-").map(Number);
    if (bar >= a && bar <= b) return x.section;
  }
  return null;
}

function check(list, name, ok, detail = {}) {
  list.push({ name, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail) : ""}`);
}

const results = { songs: [] };
let allOk = true;

for (const id of ids) {
  const plan = plans.find((s) => s.id === id);
  const answerPath = resolve(OUT, "answers", `${id}.txt`);
  const songRes = { id, checks: [], doc: null, problems: [], repairs: [], facts: {} };
  results.songs.push(songRes);
  if (!plan) { check(songRes.checks, `${id}.plan`, false, { message: "stage1にない" }); allOk = false; continue; }
  if (!existsSync(answerPath)) { check(songRes.checks, `${id}.answer-file`, false, { path: answerPath }); allOk = false; continue; }
  const text = readFileSync(answerPath, "utf8");
  const lyrics = lyricsLine(plan);
  const want = splitMorae(lyrics).morae;
  const imp = importResponse(text, lyrics);
  songRes.problems = imp.problems;
  songRes.repairs = imp.repairs;
  check(songRes.checks, `${id}.import`, !!imp.doc && imp.problems.length === 0, {
    problems: imp.problems, repairs: imp.repairs,
  });
  if (!imp.doc) { allOk = false; continue; }
  const doc = imp.doc;
  songRes.doc = { title: doc.title, bpm: doc.bpm, bars: doc.bars, key: doc.key, tracks: doc.tracks.map((t) => ({ id: t.id, kind: t.kind, instrument: t.instrument, program: t.program, pattern: t.pattern, volume: t.volume, notes: t.notes?.length, mmlChars: t.mml?.length })) };
  const vocal = doc.tracks.find((t) => t.kind === "vocal");
  const inst = doc.tracks.filter((t) => t.kind === "inst");
  const drums = doc.tracks.filter((t) => t.kind === "drums");
  const seconds = doc.bars * (doc.beatsPerBar || 4) * 60 / doc.bpm;
  check(songRes.checks, `${id}.meta`,
    doc.title === plan.title && doc.bpm === plan.bpm && doc.bars === plan.bars && (doc.beatsPerBar || 4) === 4,
    { title: doc.title, bpm: doc.bpm, bars: doc.bars, seconds: +seconds.toFixed(1), singer: vocal?.singer });
  check(songRes.checks, `${id}.duration-2-3min`, seconds >= 120 && seconds <= 180, { seconds: +seconds.toFixed(1) });
  check(songRes.checks, `${id}.morae`, vocal && vocal.notes.length === want.length, { want: want.length, got: vocal?.notes.length });
  check(songRes.checks, `${id}.lyrics-seq`, vocal && vocal.notes.map((n) => n.lyric ?? "").join("") === want.join(""), {});
  const midis = (vocal?.notes ?? []).map((n) => pitchToMidi(n.pitch)).filter((x) => Number.isFinite(x));
  const lo = midis.length ? Math.min(...midis) : null, hi = midis.length ? Math.max(...midis) : null;
  check(songRes.checks, `${id}.vocal-range`, lo != null && lo >= 48 && hi <= 84, { lo, hi, preferA3E5: lo >= 57 && hi <= 76 });
  check(songRes.checks, `${id}.singer`, vocal?.singer === (plan.singer || "ritsu"), { singer: vocal?.singer });
  check(songRes.checks, `${id}.inst-count`, inst.length >= 4, { inst: inst.map((t) => ({ id: t.id, instrument: t.instrument, program: t.program })) });
  check(songRes.checks, `${id}.drums`, drums.length === 1 && drums[0].pattern === plan.drum_pattern, { pattern: drums[0]?.pattern, want: plan.drum_pattern });
  const wantInst = new Set(plan.instruments.map((i) => String(i.instrument)));
  const gotInst = new Set(inst.map((t) => String(t.instrument ?? t.program)));
  check(songRes.checks, `${id}.instruments-planned`, [...wantInst].every((x) => [...gotInst].some((g) => g === x || g.includes?.(x))), { want: [...wantInst], got: [...gotInst] });

  const silent = new Set(["intro", "interlude", "outro"]);
  const bySec = {};
  for (const n of vocal?.notes ?? []) {
    const sec = sectionOf(n.bar, plan.bar_map) || "?";
    bySec[sec] = (bySec[sec] ?? 0) + 1;
  }
  const vocalInSilent = [...silent].reduce((n, s) => n + (bySec[s] || 0), 0);
  const missingSung = plan.bar_map.filter((x) => !silent.has(x.section) && !bySec[x.section]).map((x) => x.section);
  check(songRes.checks, `${id}.section-vocals`, missingSung.length === 0 && vocalInSilent <= Math.max(4, Math.floor(want.length * 0.05)),
    { bySec, vocalInSilent, missingSung });

  const song = new SongSession(doc, parseMML);
  const facts = inst.map((t) => song.mmlFacts(t));
  songRes.facts.mml = facts;
  check(songRes.checks, `${id}.mml-length`,
    facts.every((f) => !f.problems?.length && f.overBars === 0 && f.underBars === 0),
    { facts: facts.map((f) => ({ track: f.track, notes: f.notes, lengthBars: f.lengthBars, overBars: f.overBars, underBars: f.underBars, problems: f.problems })) });

  if (songRes.checks.some((c) => !c.ok)) allOk = false;
  const jsonPath = resolve(OUT, `${id}.song.json`);
  writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + "\n");
  console.log("wrote", jsonPath);
}

writeFileSync(resolve(OUT, "validation.json"), JSON.stringify(results, null, 2) + "\n");
const failed = results.songs.flatMap((s) => s.checks.filter((c) => !c.ok).map((c) => c.name));
console.log(failed.length ? `FAILED ${failed.join(", ")}` : "ALL PASS");
process.exit(allOk ? 0 : 1);
