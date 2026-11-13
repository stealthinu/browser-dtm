// 歌（VocaTab で作った AudioBuffer）と伴奏（dtm の playMML）を同じ AudioContext の時計で鳴らし、鳴った音をそのまま録る。
// dtm（@onjmin/dtm, AGPL-3.0-or-later, (c) onjmin）は改造せずライブラリとして呼ぶ。
// Copyright (c) 2026 browser-dtm authors. AGPL-3.0-or-later.
import { type MmlPlayback, playMML, SEQUENCER_START_DELAY } from "@onjmin/dtm";

export const SR = 44100;

/** 録音: 4 チャンネル（ミックス L・R、伴奏だけ、歌だけ）を、曲の頭のフレームからぴったり録る AudioWorklet。 */
const RECORDER_JS = `
class Rec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.from = -1; this.len = 0; this.got = 0; this.buf = null;
    this.port.onmessage = (e) => {
      this.from = e.data.from; this.len = e.data.len; this.got = 0;
      this.buf = [0, 1, 2, 3].map(() => new Float32Array(e.data.len));
    };
  }
  process(inputs) {
    const inp = inputs[0];
    if (this.buf && this.got < this.len) {
      for (let i = 0; i < 128; i++) {
        const f = currentFrame + i - this.from;
        if (f < 0 || f >= this.len) continue;
        for (let c = 0; c < 4; c++) this.buf[c][f] = inp[c] ? inp[c][i] : 0;
        this.got = Math.max(this.got, f + 1);
      }
      if (this.got >= this.len) {
        this.port.postMessage(this.buf, this.buf.map((b) => b.buffer));
        this.buf = null;
      }
    }
    return true;
  }
}
registerProcessor("rec", Rec);
`;

export interface Recording {
  mix: [Float32Array, Float32Array];
  acc: Float32Array;
  vox: Float32Array;
  /** 予定した開始時刻（AudioContext の時計）: 伴奏（dtm のシーケンサ）と歌（バッファの曲頭） */
  scheduled: { accStart: number; vocalSongZero: number };
}

export class Player {
  ctx: AudioContext;
  private master: GainNode;
  private limiter: DynamicsCompressorNode;
  private accBus: GainNode;
  private voxBus: GainNode;
  private rec: AudioWorkletNode | null = null;
  private playing: { mml: MmlPlayback; src: AudioBufferSourceNode; timer: number } | null = null;
  onEnd: () => void = () => {};
  /** 再生中の曲の頭（AudioContext の時計）。プレイヘッドの表示用 */
  songZero = 0;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: SR, latencyHint: "playback" });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    // 最後に軽いリミッタ（ミックスがクリップしないように）
    const lim = this.ctx.createDynamicsCompressor();
    lim.threshold.value = -6;
    lim.knee.value = 3;
    lim.ratio.value = 12;
    lim.attack.value = 0.003;
    lim.release.value = 0.15;
    this.master.connect(lim).connect(this.ctx.destination);
    this.limiter = lim;
    this.accBus = this.ctx.createGain();
    this.accBus.gain.value = 0.3; // dtm の伴奏はそのままだと歌（VocaTab）より 10 dB ほど大きい
    this.voxBus = this.ctx.createGain();
    this.accBus.connect(this.master);
    this.voxBus.connect(this.master);
  }

  private async recorder(): Promise<AudioWorkletNode> {
    if (this.rec) return this.rec;
    const url = URL.createObjectURL(new Blob([RECORDER_JS], { type: "text/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(this.ctx, "rec", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 4,
                                                        channelCountMode: "explicit", channelInterpretation: "discrete" });
    const merger = this.ctx.createChannelMerger(4);
    const split = this.ctx.createChannelSplitter(2);
    this.limiter.connect(split); // 録るのは実際に出る音（リミッタの後）
    split.connect(merger, 0, 0);
    split.connect(merger, 1, 1);
    const accMono = this.ctx.createGain();
    accMono.channelCount = 1;
    accMono.channelCountMode = "explicit";
    const voxMono = this.ctx.createGain();
    voxMono.channelCount = 1;
    voxMono.channelCountMode = "explicit";
    this.accBus.connect(accMono).connect(merger, 0, 2);
    this.voxBus.connect(voxMono).connect(merger, 0, 3);
    merger.connect(node);
    this.rec = node;
    return node;
  }

  /**
   * 再生する。vocal は曲の頭がサンプル lead の所にある波形（ステレオ）。
   * 揃え方: dtm のシーケンサは「playMML を呼んだ時の ctx.currentTime + SEQUENCER_START_DELAY」を曲の頭にする。
   * その currentTime を Proxy で決まった値（今 + 余白）に固定して呼び、同じ値から歌のバッファの開始時刻を決める。
   * record=true なら曲の頭から seconds 秒を録って返す。
   */
  async play(mml: string, vocal: [Float32Array, Float32Array], lead: number, seconds: number, vocalGain = 0.9,
             record = false): Promise<Recording | null> {
    this.stop();
    if (this.ctx.state !== "running") await this.ctx.resume();
    const recNode = record ? await this.recorder() : null;
    const buf = this.ctx.createBuffer(2, vocal[0].length, SR);
    buf.copyToChannel(vocal[0], 0);
    buf.copyToChannel(vocal[1], 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vocalGain;
    src.connect(g).connect(this.voxBus);

    const leadSec = lead / SR;
    // 曲の頭はサンプルの境目ちょうどに置く（歌のバッファの開始と録音の窓が 1 サンプルもずれないように）
    const songZeroFrame = Math.ceil((this.ctx.currentTime + leadSec + 0.15 + SEQUENCER_START_DELAY) * SR);
    const frozen = songZeroFrame / SR - SEQUENCER_START_DELAY; // 歌の頭の余白より先に曲の頭を置く
    const real = this.ctx;
    const proxy = new Proxy(real, {
      get(target, prop) {
        if (prop === "currentTime") return frozenNow ?? target.currentTime;
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    let frozenNow: number | null = frozen;
    const songZero = songZeroFrame / SR;
    const mmlPlay = playMML(mml, { audioContext: proxy as AudioContext, destination: this.accBus, pauseWhenHidden: false,
                                   onStop: () => undefined });
    frozenNow = null;
    const vocalStartAt = (songZeroFrame - lead) / SR;
    src.start(vocalStartAt);
    this.songZero = songZero;

    let result: Promise<Recording> | null = null;
    if (recNode) {
      const len = Math.ceil(seconds * SR);
      result = new Promise((ok) => {
        recNode.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
          const [l, r, acc, vox] = e.data;
          ok({ mix: [l, r], acc, vox, scheduled: { accStart: songZero, vocalSongZero: vocalStartAt + lead / SR } });
        };
      });
      recNode.port.postMessage({ from: songZeroFrame, len });
    }
    const timer = window.setTimeout(() => {
      this.stop();
      this.onEnd();
    }, (songZero - this.ctx.currentTime + seconds) * 1000 + 100);
    this.playing = { mml: mmlPlay, src, timer };
    return result ? await result : null;
  }

  stop(): void {
    if (!this.playing) return;
    clearTimeout(this.playing.timer);
    try { this.playing.mml.stop(); this.playing.mml.destroy(); } catch { /* 止まっている */ }
    try { this.playing.src.stop(); } catch { /* 止まっている */ }
    this.playing = null;
  }

  get isPlaying(): boolean {
    return this.playing !== null;
  }
}
