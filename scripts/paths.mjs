// 上流の置き場所（SPEC §4）。VOCATAB_DIR（読み取り専用で使う）か、.gitignore した vendor/vocatab。
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function vocatabDir() {
  const cands = [process.env.VOCATAB_DIR, resolve(ROOT, "vendor/vocatab"), "/workspace/dtm-research/vocatab" /* box の既定 */].filter(Boolean);
  for (const c of cands) if (existsSync(resolve(c, "ui/src/engine-web/worker.ts"))) return resolve(c);
  throw new Error(`VocaTab が見つかりません。VOCATAB_DIR を設定するか vendor/vocatab に clone してください（候補: ${cands.join(", ")}）`);
}
