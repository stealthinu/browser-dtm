#!/usr/bin/env node
/**
 * MCP stdio サーバー: SongDoc 道具を tools/list で公開。
 * new_song → set_track_notes → set_lyrics → set_track_mml → export が通る。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createToolRunner, TOOL_DEFS, type ToolName } from "../tools/api.js";
import type { SongDoc } from "../songdoc/types.js";
import { songDocToDtmMml } from "../songdoc/convert.js";

const outDir = path.resolve(process.env.BROWSER_DTM_OUT || "out");

let song: SongDoc | null = null;
const runner = createToolRunner(
  {
    get: () => song,
    set: (d) => {
      song = d;
    },
  },
  {
    exportFile: async (doc, format) => {
      await fs.mkdir(outDir, { recursive: true });
      if (format === "json") {
        const p = path.join(outDir, "mcp-song.json");
        await fs.writeFile(p, JSON.stringify(doc, null, 2));
        return { path: p, bytes: Buffer.byteLength(JSON.stringify(doc)) };
      }
      // 音声はブラウザ経路が本体。ここでは MML + SongDoc を書き、WAV はプレースホルダ説明。
      const mmlPath = path.join(outDir, "mcp-song.mml");
      const mml = songDocToDtmMml(doc);
      await fs.writeFile(mmlPath, mml);
      const jsonPath = path.join(outDir, "mcp-song.json");
      await fs.writeFile(jsonPath, JSON.stringify(doc, null, 2));
      if (format === "mp3" || format === "wav") {
        // ヘッドレス音声は scripts/accept-render.ts（Chrome）に委譲する指示を返す
        const hint = path.join(outDir, "mcp-export-hint.txt");
        await fs.writeFile(
          hint,
          `MCP export(${format}): SongDoc/MML を書き出し済み。音声は npm run accept:render で out/mix.mp3 を生成。\n`,
        );
        return { path: mmlPath, bytes: Buffer.byteLength(mml) };
      }
      return { path: jsonPath };
    },
  },
);

const server = new Server(
  { name: "browser-dtm", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name as ToolName;
  const args = (req.params.arguments || {}) as Record<string, unknown>;
  const result = await runner.run(name, args);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
