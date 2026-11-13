// MCP サーバー（stdio、Node）。ブラウザの画面と同じ道具（src/core/tools.ts）を出す（SPEC §2-3）。
// export の mp3 / wav は headless Chrome でアプリを開き、実際に鳴らして録った音を out/ に書き出す。
// 起動: npx tsx mcp/server.ts   （標準出力は MCP のやり取り専用。ログは標準エラーへ）
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { validateSong } from "../src/core/songdoc";
import { SongSession, TOOL_DEFS } from "../src/core/tools";
// @ts-ignore（.mjs）
import { ROOT } from "../scripts/paths.mjs";

// dtm は読み込み時に Worker を作る（歌声用）。Node では使わないので仮の Worker を置いてから import する
(globalThis as any).Worker ??= class { postMessage() {} terminate() {} addEventListener() {} };
const { parseMML } = await import("@onjmin/dtm");

const session = new SongSession(undefined, parseMML);
const port = Number(process.env.MCP_RENDER_PORT ?? 5101);

async function exportSong(format: string, name: string): Promise<unknown> {
  mkdirSync(resolve(ROOT, "out"), { recursive: true });
  if (format === "json" || format === "mml") {
    const file = `out/${name}.${format === "json" ? "json" : "mml"}`;
    writeFileSync(resolve(ROOT, file), format === "json" ? JSON.stringify(session.doc, null, 1) : session.mml());
    return { saved: file };
  }
  const problems = validateSong(session.doc);
  if (problems.length) return { saved: null, problems };
  // @ts-ignore（.mjs）
  const { openApp } = await import("../scripts/browser.mjs");
  const app = await openApp({ port, log: (s: string) => process.stderr.write(`${s}\n`) });
  try {
    const r = await app.page.evaluate(async (doc: unknown, fmt: string, nm: string) => {
      const a = (window as any).app;
      const lr = a.loadDoc(doc);
      if (lr.problems.length) return { problems: lr.problems };
      return a.exportAudio({ format: fmt, name: nm, toServer: true });
    }, session.doc, format, name);
    return r;
  } finally {
    await app.close();
  }
}

const server = new Server({ name: "browser-dtm", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const result = name === "export"
      ? await exportSong(String((args as any).format ?? "mp3"), String((args as any).name ?? (session.doc.title || "song")).replace(/[^\w\-.ぁ-んァ-ヶ一-龠]/g, "_"))
      : session.call(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
  }
});
await server.connect(new StdioServerTransport());
process.stderr.write("browser-dtm MCP server ready (stdio)\n");
