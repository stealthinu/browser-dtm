// 受入テスト A6: MCP サーバーを起動し、tools/list → new_song → set_track_notes → set_lyrics → set_track_mml → export を通す。
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "./paths.mjs";

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/server.ts"], cwd: ROOT, stderr: "ignore" }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  console.log(`${r.isError ? "ERROR" : "ok"} ${name}: ${text.slice(0, 300)}`);
  if (r.isError) throw new Error(text);
  return JSON.parse(text);
};
let ok = true;
try {
  const { tools } = await client.listTools();
  console.log(`tools/list: ${tools.map((t) => t.name).join(", ")}`);
  await call("new_song", { bpm: 110, bars: 2, title: "mcp-smoke" });
  await call("set_track_notes", { notes: [
    { bar: 1, beat: 1, len: "4", pitch: "E4" }, { bar: 1, beat: 2, len: "4", pitch: "G4" }, { bar: 1, beat: 3, len: "2", pitch: "A4" },
    { bar: 2, beat: 1, len: "4", pitch: "G4" }, { bar: 2, beat: 2, len: "2.", pitch: "E4" } ] });
  const ly = await call("set_lyrics", { text: "あおいそら" });
  ok &&= ly.missing === 0 && ly.surplus.length === 0;
  const pf = await call("set_track_mml", { trackId: "pf", mml: "o4 l4 'ceg' 'ceg' 'ceg' 'ceg' 'dgb' 'dgb' 'dgb' 'dgb'", program: "acoustic_grand_piano" });
  const ba = await call("set_track_mml", { trackId: "ba", mml: "o2 l2 c c g g", program: "electric_bass_finger" });
  ok &&= pf.overBars === 0 && pf.underBars === 0 && ba.overBars === 0;
  await call("set_drums", { pattern: "8beat" });
  const fx = await call("set_effects", {effects:[{type:"vocaloid",amount:0.5}]});
  ok &&= fx.problems.length === 0 && fx.effects[0].type === "vocaloid";
  const chk = await call("check", {});
  ok &&= chk.problems.length === 0;
  await call("export", { format: "json", name: "mcp-smoke" });
  const ex = await call("export", { format: "mp3", name: "mcp-smoke" });
  const f = resolve(ROOT, "out/mcp-smoke.mp3");
  ok &&= existsSync(f) && statSync(f).size > 10000 && ex.vox.rmsDb > -40 && ex.acc.rmsDb > -40 && ex.playback?.maxRms > 0.001 && ex.mixL.clipped === 0;
  console.log(`mp3: ${existsSync(f) ? statSync(f).size : 0} bytes, vox ${ex.vox?.rmsDb} dB, acc ${ex.acc?.rmsDb} dB, mix ${ex.mixL?.rmsDb} dB`);
} catch (e) {
  ok = false;
  console.error(e);
} finally {
  await client.close();
}
console.log(ok ? "PASS A6.mcp" : "FAIL A6.mcp");
process.exit(ok ? 0 : 1);
