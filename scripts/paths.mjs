// 上流の置き場所（SPEC §4）。VOCATAB_DIR（読み取り専用で使う）か、.gitignore した vendor/vocatab。
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function vocatabDir() {
  const cands = [process.env.VOCATAB_DIR, resolve(ROOT, "vendor/vocatab")].filter(Boolean);
  for (const c of cands) if (existsSync(resolve(c, "ui/src/engine-web/worker.ts"))) return resolve(c);
  throw new Error(`VocaTab が見つかりません。VOCATAB_DIR を設定するか vendor/vocatab に clone してください（候補: ${cands.join(", ") || "(なし)"}）`);
}

/** e2e の受け渡し先。未設定ならリポジトリの out/final。 */
export function finalDir() {
  return resolve(process.env.FINAL_DIR ?? resolve(ROOT, "out/final"));
}
