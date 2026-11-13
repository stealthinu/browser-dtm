/**
 * A6: MCP サーバーを起動し tools/list と道具列を通す。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
  await fs.mkdir("out", { recursive: true });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/server.ts"],
    cwd: process.cwd(),
    env: { ...process.env, BROWSER_DTM_OUT: path.resolve("out") },
  });
  const client = new Client({ name: "accept-mcp", version: "0.1.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    const need = ["new_song", "set_track_notes", "set_lyrics", "set_track_mml", "export"];
    for (const n of need) {
      if (!names.includes(n)) throw new Error(`tools/list に ${n} が無い: ${names.join(",")}`);
    }

    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("");
      return JSON.parse(text);
    };

    await call("new_song", { bpm: 120, bars: 8, title: "mcp-test", key: "C" });
    await call("set_track_notes", {
      trackId: "vo",
      notes: [
        { bar: 1, beat: 1, len: "4", pitch: "G4", lyric: "" },
        { bar: 1, beat: 2, len: "4", pitch: "A4", lyric: "" },
        { bar: 1, beat: 3, len: "4", pitch: "G4", lyric: "" },
        { bar: 1, beat: 4, len: "4", pitch: "E4", lyric: "" },
      ],
    });
    const lyrics = await call("set_lyrics", { trackId: "vo", text: "ゆうやけ" });
    await call("set_track_mml", {
      trackId: "pf",
      program: "Acoustic Grand Piano",
      mml: "o4 l4 cegc",
    });
    await call("set_track_mml", {
      trackId: "bs",
      program: "Electric Bass (finger)",
      mml: "o2 l2 c g",
    });
    const exp = await call("export", { format: "mp3" });

    const out = {
      ok: true,
      tools: names,
      lyricsOk: lyrics.ok,
      exportPath: exp.data?.path,
      note: "音声本体は accept:render（Chrome）経路。MCP は SongDoc/MML まで保証。",
    };
    await fs.writeFile("out/mcp-accept.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.close();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
