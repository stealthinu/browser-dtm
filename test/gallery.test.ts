import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { GALLERY, galleryPrompt } from "../src/core/gallery";
import { importResponse } from "../src/core/prompt";
import { validateSong } from "../src/core/songdoc";
import { SongSession, TOOL_DEFS } from "../src/core/tools";
for (const sample of GALLERY) test(`gallery ${sample.id}: M1パーサ・検査・両コピー`, () => {
  const text = readFileSync(`fixtures/gallery/${sample.id}.json`, "utf8");
  const r = importResponse(text);
  assert.deepEqual(r.problems, []);
  assert.ok(r.doc);
  assert.deepEqual(validateSong(r.doc), []);
  assert.deepEqual(r.repairs, []);
  for (const target of ["claude", "chatgpt"] as const) {
    const prompt = galleryPrompt(r.doc, target);
    assert.ok(prompt.includes(JSON.stringify(r.doc, null, 1)));
    assert.ok(prompt.includes("## 返答の形式") && prompt.includes("このサンプルを土台に"));
    assert.ok(prompt.includes(target === "claude" ? "Claude へ" : "ChatGPT へ"));
  }
});
test("ギャラリーの全JSONを一覧に登録し、曲3/伴奏2/効果2を含む", () => {
  assert.equal(readdirSync("fixtures/gallery").filter(f => f.endsWith(".json")).length, GALLERY.length);
  for (const [kind, count] of [["曲", 3], ["伴奏", 2], ["エフェクト", 2]] as const)
    assert.ok(GALLERY.filter(s => s.category === kind).length >= count);
  assert.equal(new Set(GALLERY.map(s => s.bpm)).size, GALLERY.length);
});
test("MCP: 貼付JSONとget_song一致、instrument=0と名称、vocaloid・prompt、失敗時は保存維持", () => {
  const text = readFileSync("fixtures/gallery/vocaloid.json", "utf8");
  const session = new SongSession();
  const loaded = session.call("load_song_json", { text }) as any;
  assert.equal(loaded.loaded, true);
  assert.deepEqual(session.call("get_song"), importResponse(text).doc);
  assert.deepEqual(session.call("get_song", { part: "full" }), loaded.doc);
  session.call("set_track_mml", { trackId: "pf", instrument: 0, mml: "o4 c1" });
  session.call("set_track_mml", { trackId: "ba", instrument: "Electric Bass (finger)", mml: "o2 c1" });
  const doc = session.call("get_song") as any;
  assert.equal(doc.tracks[1].instrument, 0);
  assert.equal(doc.tracks[2].instrument, "Electric Bass (finger)");
  assert.equal(doc.tracks[0].effects[0].type, "vocaloid");
  assert.ok((session.call("get_prompt", { image: "サビを高くする" }) as any).prompt.includes(JSON.stringify(doc, null, 1)));
  const failed = session.call("load_song_json", { text: '{"version":1}' }) as any;
  assert.equal(failed.loaded, false);
  assert.ok(failed.fixRequest);
  assert.deepEqual(session.call("get_song"), doc);
  assert.ok(TOOL_DEFS.find(t => t.name === "set_track_mml")!.inputSchema);
});
test("M3 実LLM未編集返答は歌詞一致・全パーサ検査を通る", () => {
  const requests = JSON.parse(readFileSync("fixtures/llm-real/m3-requests.json", "utf8"));
  for (const request of requests) {
    const result = importResponse(readFileSync(`fixtures/llm-real/${request.answer}`, "utf8"), request.lyrics);
    assert.deepEqual(result.problems, [], request.answer);
    assert.ok(result.doc);
    if (request.answer.startsWith("long")) {
      assert.ok(result.doc.bars >= 16);
      assert.ok(result.doc.tracks.filter(t => t.kind === "inst").length >= 3);
    }
  }
});
