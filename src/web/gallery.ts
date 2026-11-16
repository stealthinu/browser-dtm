// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { GALLERY, galleryPrompt, type PromptTarget } from "../core/gallery";
import { importResponse } from "../core/prompt";
import type { SongDoc } from "../core/songdoc";
const cards = document.querySelector<HTMLElement>("#cards")!;
const status = document.querySelector<HTMLElement>("#status")!;
const docs = new Map<string, SongDoc>();
async function getDoc(id: string) {
  if (!GALLERY.some(s => s.id === id)) throw new Error("サンプルがありません");
  if (!docs.has(id)) {
    const response = await fetch(`/fixtures/gallery/${id}.json`);
    if (!response.ok) throw new Error("サンプルを読み込めませんでした");
    const r = importResponse(await response.text());
    if (!r.doc || r.problems.length) throw new Error(r.problems.map(p => p.message).join("、"));
    docs.set(id, r.doc);
  }
  return structuredClone(docs.get(id)!);
}
// 同じ作曲画面を再生ホストにして合成・効果・SoundFont・時計を共用する。
let host: Promise<any> | undefined;
function previewHost(): Promise<any> {
  return host ??= new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "サンプル試聴エンジン";
    frame.src = "/";
    frame.onload = async () => {
      try { const app = (frame.contentWindow as any).app; await app.ready; resolve(app); }
      catch (e) { host = undefined; frame.remove(); reject(e); }
    };
    frame.onerror = () => { host = undefined; frame.remove(); reject(new Error("試聴エンジンを読み込めませんでした")); };
    document.body.append(frame);
  });
}
let generation = 0;
let active: HTMLElement | null = null;
function clearActive() { active?.classList.remove("playing"); active?.querySelector(".play")?.setAttribute("aria-pressed", "false"); active = null; }
async function preview(id: string) {
  const token = ++generation;
  status.textContent = "歌声と楽器を準備中…";
  const app = await previewHost();
  if (token !== generation) return;
  const doc = await getDoc(id);
  if (token !== generation) return;
  clearActive();
  const result = app.loadDoc(doc);
  if (result.problems.length) throw new Error("曲データに問題があります");
  active = document.getElementById(id)!;
  active.classList.add("playing");
  active.querySelector(".play")!.setAttribute("aria-pressed", "true");
  status.textContent = `${doc.title} — 合成・再生中…`;
  try {
    const rec = await app.play(true);
    if (token === generation) status.textContent = `${doc.title} — 試聴しました。アプリで開いて編集できます。`;
    return rec;
  } finally { if (token === generation) clearActive(); }
}
async function copy(id: string, target: PromptTarget) {
  const text = galleryPrompt(await getDoc(id), target);
  try { await navigator.clipboard.writeText(text); }
  catch {
    const field = document.createElement("textarea"); field.value = text; document.body.append(field); field.select();
    const ok = document.execCommand("copy"); field.remove();
    if (!ok) throw new Error("コピーできませんでした。ブラウザのクリップボード権限を確認してください");
  }
  document.querySelector(`#${id} .message`)!.textContent = "コピーしました";
  status.textContent = "コピーしました。LLM の返答を作曲画面へ貼り付けてください。";
  return text;
}
const colors = ["#527069", "#5c5a7a", "#805b4b", "#5c708c", "#675d53", "#6d5485", "#437f77"];
for (const [i, sample] of GALLERY.entries()) {
  const card = document.createElement("article"); card.className = "card"; card.id = sample.id; card.dataset.category = sample.category;
  card.innerHTML = `<div class="art" style="--tint:${colors[i]}"><div class="number">0${i + 1} / ${sample.category}</div>${Array.from({ length: 27 }, (_, n) => `<span style="--h:${18 + ((n * 31 + i * 17) % 69)}px;--d:${n * .037}s"></span>`).join("")}</div><div class="info"><div class="meta">${sample.category} · ${sample.bpm} BPM · 4小節</div><h2>${sample.title}</h2><p class="desc">${sample.description}</p><div class="actions"><button class="play" aria-pressed="false">▶ 試聴</button><a class="open" href="/?sample=${sample.id}">アプリで開く ↗</a></div><div class="copies"><button data-target="claude">Claude 用にコピー</button><button data-target="chatgpt">ChatGPT 用にコピー</button></div><p class="message" role="status"></p></div>`;
  card.querySelector<HTMLButtonElement>(".play")!.onclick = () => { preview(sample.id).catch(e => { status.textContent = `試聴に失敗: ${e.message}`; }); };
  card.querySelectorAll<HTMLButtonElement>("[data-target]").forEach(b => b.onclick = () => { copy(sample.id, b.dataset.target as PromptTarget).catch(e => { status.textContent = e.message; }); });
  cards.append(card);
}
document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(b => b.onclick = () => {
  document.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  for (const card of cards.children as any) card.hidden = b.dataset.filter !== "すべて" && card.dataset.category !== b.dataset.filter;
});
document.querySelector<HTMLButtonElement>("#stop")!.onclick = async () => { generation++; if (host) (await host).loadDoc(await getDoc(GALLERY[0].id)); clearActive(); status.textContent = "試聴を停止しました"; };
(window as any).gallery = { getDoc, preview, prompt: async (id: string, target: PromptTarget) => galleryPrompt(await getDoc(id), target), previewHost };
