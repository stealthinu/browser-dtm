// ブラウザと同じ buildPrompt を使い、購読 LLM に渡す自己完結プロンプトを保存する。
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./paths.mjs";
await build({entryPoints:[resolve(ROOT,"src/core/prompt.ts")],bundle:true,platform:"node",format:"esm",outfile:resolve(ROOT,"out/prompt.mjs")});
const { buildPrompt } = await import("../out/prompt.mjs");
const requests = [
 {lyrics:"さくら かぜに ゆれる",image:"BPM 120、4/4、C major、4小節。明るい春のポップ。ピアノとベース、8beat。歌詞をそのまま使う。"},
 {lyrics:"つきの ひかり しずか",image:"BPM 96、4/4、A minor、4小節。静かな夜のバラード。エレピとベース、4beat。歌に vocaloid amount 0.5。歌詞をそのまま使う。"},
];
mkdirSync(resolve(ROOT,"out/llm"),{recursive:true});
for(const [i,r] of requests.entries()) writeFileSync(resolve(ROOT,`out/llm/prompt-${i+1}.txt`),buildPrompt(r.lyrics,r.image));
writeFileSync(resolve(ROOT,"out/llm/requests.json"),JSON.stringify(requests,null,2));
