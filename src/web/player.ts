// dtm（AGPL-3.0-or-later, (c) onjmin）を import/wrap のみで使用する。
// 全イベントをオフライン時計で先に予約し、再生と書き出しに同じ PCM を使う。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { playMML, SEQUENCER_START_DELAY } from "@onjmin/dtm";
export const SR = 44100;
export interface Recording {
  mix: [Float32Array, Float32Array];
  acc: Float32Array;
  vox: Float32Array;
  scheduled: { accStart: number; vocalSongZero: number };
}

/** dtm の setInterval シーケンサを同期的に前進させる薄い時計アダプタ。
 * グローバル差し替えはこの同期区間だけ。await 前に必ず復元し、上流ソースは変更しない。
 */
function scheduleDtm(ctx: OfflineAudioContext, destination: AudioNode, mml: string, seconds: number, songZero: number) {
  const original = { setInterval: window.setInterval, clearInterval: window.clearInterval,
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame, random: Math.random };
  const ticks = new Map<number, () => void>();
  let id = -1, now = songZero - SEQUENCER_START_DELAY, seed = 123456789;
  const proxy = new Proxy(ctx, { get(target, prop) {
    if (prop === "currentTime") return now;
    if (prop === "state") return "running";
    const v = Reflect.get(target, prop, target);
    return typeof v === "function" ? v.bind(target) : v;
  }});
  try {
    window.setInterval = ((f: () => void) => { ticks.set(--id, f); return id; }) as typeof window.setInterval;
    window.clearInterval = ((i: number) => { ticks.delete(i); }) as typeof window.clearInterval;
    window.requestAnimationFrame = (() => --id) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = () => {};
    // dtm のドラムノイズ・リバーブにも固定 seed を使い、再書き出しを再現可能にする。
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const playback = playMML(mml, { audioContext: proxy as unknown as AudioContext, destination, pauseWhenHidden: false });
    for (; now <= songZero + seconds; now += 0.02) for (const f of ticks.values()) f();
    // 予約済みノードはレンダー完了まで生かす。終了時に dispose する。
    return playback;
  } finally {
    Object.assign(window, { setInterval: original.setInterval, clearInterval: original.clearInterval,
      requestAnimationFrame: original.requestAnimationFrame, cancelAnimationFrame: original.cancelAnimationFrame });
    Math.random = original.random;
  }
}

export async function renderSong(mml: string, vocal: [Float32Array, Float32Array], lead: number, seconds: number, vocalGain = 1): Promise<Recording> {
  const zero = Math.ceil((lead / SR + 0.2) * SR) / SR;
  const length = Math.ceil((zero + seconds) * SR);
  const ctx = new OfflineAudioContext(4, length, SR);
  const master = ctx.createGain(); master.gain.value = 0.9;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -6; lim.knee.value = 3; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
  master.connect(lim);
  const acc = ctx.createGain(); acc.gain.value = 0.3; acc.connect(master);
  const vox = ctx.createGain(); vox.gain.value = vocalGain; vox.connect(master);
  const merger = ctx.createChannelMerger(4), splitter = ctx.createChannelSplitter(2);
  lim.connect(splitter); splitter.connect(merger, 0, 0); splitter.connect(merger, 1, 1);
  const mono = (bus: AudioNode, channel: number) => {
    const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = "explicit";
    bus.connect(g).connect(merger, 0, channel);
  };
  mono(acc, 2); mono(vox, 3); merger.connect(ctx.destination);
  const buffer = ctx.createBuffer(2, vocal[0].length, SR);
  buffer.copyToChannel(vocal[0], 0); buffer.copyToChannel(vocal[1], 1);
  const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(vox); source.start(zero - lead / SR);
  const dtm = scheduleDtm(ctx, acc, mml, seconds, zero);
  try {
    const rendered = await ctx.startRendering();
    const from = Math.round(zero * SR), len = Math.ceil(seconds * SR);
    const ch = (c: number) => rendered.getChannelData(c).slice(from, from + len);
    return { mix: [ch(0), ch(1)], acc: ch(2), vox: ch(3), scheduled: { accStart: zero, vocalSongZero: zero } };
  } finally { dtm.destroy(); }
}

export class Player {
  ctx = new AudioContext({ sampleRate: SR, latencyHint: "playback" });
  private source: AudioBufferSourceNode | null = null;
  private resolvePlayback: (() => void) | null = null;
  private generation = 0;
  songZero = 0;
  onEnd: () => void = () => {};
  async play(mml: string, vocal: [Float32Array, Float32Array], lead: number, seconds: number, vocalGain = 1, record = false): Promise<Recording | null> {
    this.stop();
    const generation = this.generation;
    if (this.ctx.state !== "running") await this.ctx.resume();
    const rec = await renderSong(mml, vocal, lead, seconds, vocalGain);
    if (generation !== this.generation) throw new Error("再生は停止されました");
    const b = this.ctx.createBuffer(2, rec.mix[0].length, SR);
    b.copyToChannel(rec.mix[0], 0); b.copyToChannel(rec.mix[1], 1);
    const src = this.ctx.createBufferSource(); src.buffer = b; src.connect(this.ctx.destination);
    const ended = new Promise<void>((ok) => { this.resolvePlayback = ok; });
    src.onended = () => { if (this.source === src) { this.source = null; this.resolvePlayback?.(); this.resolvePlayback = null; this.onEnd(); } src.disconnect(); };
    this.source = src; this.songZero = this.ctx.currentTime + 0.03; src.start(this.songZero);
    if (record) { await ended; return rec; }
    return null;
  }
  stop() {
    this.generation++;
    if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
    this.resolvePlayback?.(); this.resolvePlayback = null;
  }
  get isPlaying() { return this.source !== null; }
}
