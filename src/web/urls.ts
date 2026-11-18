// 公開サイト（GitHub Pages の /browser-dtm/ など）でも、ローカルの / でも使える URL 組み立て。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.

export const OFFICIAL_MODEL_BASE = "https://wavtechyukky.github.io/vocatab/";

declare const __MODEL_BASE__: string;

/** 今のページのディレクトリ（末尾スラッシュ付き）。index.html / gallery.html を除く。 */
export function pageDir(): string {
  const u = new URL(location.href);
  let path = u.pathname;
  if (/\/[^/]+\.html$/i.test(path)) path = path.slice(0, path.lastIndexOf("/") + 1);
  else if (!path.endsWith("/")) path = path.slice(0, path.lastIndexOf("/") + 1) || "/";
  return `${u.origin}${path}`;
}

export function appUrl(rel = ""): string {
  return new URL(rel, pageDir()).href;
}

/** 歌声モデルの根（web_index.json がある所）。?model_base= があればそれを優先。 */
export function modelBase(): string {
  const q = new URLSearchParams(location.search).get("model_base");
  if (q) return ensureSlash(q);
  if (typeof __MODEL_BASE__ !== "undefined" && __MODEL_BASE__) return ensureSlash(__MODEL_BASE__);
  return new URL("vocatab/", pageDir()).href;
}

export function isOfficialModelBase(base: string): boolean {
  return ensureSlash(base) === OFFICIAL_MODEL_BASE;
}

function ensureSlash(s: string): string {
  return s.endsWith("/") ? s : `${s}/`;
}
