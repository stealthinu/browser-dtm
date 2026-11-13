/**
 * 歌（VocaTab AudioBuffer）と伴奏（dtm createDtmStudio.play）を同じ AudioContext 時計で混ぜる。
 * 書き出しは studio の WAV 録音経路 → MP3。
 */
import { createDtmStudio, SEQUENCER_START_DELAY, type DtmStudio, type MmlPlayback } from "@onjmin/dtm";
import { songDocToDtmMml, songDocVocalToVocaTab } from "../songdoc/convert";
import { songDurationSec } from "../songdoc/timing";
import type { SongDoc } from "../songdoc/types";
import { isVocalTrack } from "../songdoc/types";
import { encodeMp3Stereo, encodeWavPCM16, monoToStereo } from "./encode";
import { analyzeBuffer, applyVocalFx, type FxParams } from "../fx/vocal-fx";
import { resolveVocatabUrls, VocalEngine, type VocalRenderResult } from "../vocal/engine";

export interface PlayMetrics {
  vocalRms: number;
  vocalPeak: number;
  vocalOnsetMs: number;
  backingRms: number;
  backingPeak: number;
  backingOnsetMs: number;
  mixRms: number;
  mixPeak: number;
  /** 有音開始の差（歌は leading pau で遅れうる。参考値） */
  audibleOnsetDeltaMs: number;
  /** スケジュール開始の差（両方 SEQUENCER_START_DELAY）。目標 < 30ms */
  offsetMs: number;
  scheduledDelaySec: number;
  vocalStartSec: number;
  durationMs: number;
}

export interface ExportResult {
  wav: ArrayBuffer;
  mp3: Uint8Array;
  metrics: PlayMetrics;
  vocal: VocalRenderResult;
  sampleRate: number;
}

export class DtmSession {
  studio: DtmStudio | null = null;
  vocalEngine: VocalEngine | null = null;
  lastVocal: VocalRenderResult | null = null;
  private playback: MmlPlayback | null = null;
  private vocalSource: AudioBufferSourceNode | null = null;
  status = "idle";

  async init(): Promise<void> {
    if (!this.studio) {
      this.studio = await createDtmStudio({ masterVolume: 90 });
    }
    if (!this.vocalEngine) {
      const urls = resolveVocatabUrls();
      this.vocalEngine = new VocalEngine(urls.baseUrl, urls.workerUrl);
      await this.vocalEngine.init(false);
    }
  }

  async renderVocal(doc: SongDoc, fxOverride?: Partial<FxParams> | null): Promise<VocalRenderResult> {
    await this.init();
    const notes = songDocVocalToVocaTab(doc);
    if (!notes.length) throw new Error("歌ノートが無い");
    const vo = doc.tracks.find(isVocalTrack);
    const fx = fxOverride ?? vo?.effects ?? null;
    const result = await this.vocalEngine!.render(notes, doc.bpm, {
      voicebank: vo?.voicebank,
      singer: vo?.singer ?? 2,
      effects: fx,
    });
    this.lastVocal = result;
    return result;
  }

  stop(): void {
    this.playback?.stop();
    this.playback = null;
    try {
      this.vocalSource?.stop();
    } catch {
      /* already stopped */
    }
    this.vocalSource = null;
  }

  /** 再生のみ（録音なし） */
  async play(doc: SongDoc): Promise<{ mml: string; vocalSeconds: number }> {
    await this.init();
    this.stop();
    const vocal = this.lastVocal ?? (await this.renderVocal(doc));
    const mml = songDocToDtmMml(doc);
    const ctx = this.studio!.audioContext;
    await ctx.resume();

    const buf = ctx.createBuffer(1, vocal.wav.length, vocal.sampleRate);
    buf.copyToChannel(vocal.wav, 0);

    this.playback = this.studio!.play(mml, {
      onResumeAudio: async () => {
        // playMML は直後に currentTime + SEQUENCER_START_DELAY で seq.start する。
        // 同じ式で歌バッファを予約して頭を揃える。
        const startAt = ctx.currentTime + SEQUENCER_START_DELAY;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.9;
        src.connect(g);
        g.connect(this.studio!.masterGain);
        src.start(startAt);
        this.vocalSource = src;
      },
      onStop: () => {
        this.playback = null;
      },
    });

    return { mml, vocalSeconds: vocal.seconds };
  }

  /**
   * 実再生を録って WAV/MP3 を返す。
   * 歌のみ / 伴奏のみも短いパスでメトリクス用に合成する。
   */
  async exportMix(doc: SongDoc, fxOverride?: Partial<FxParams> | null): Promise<ExportResult> {
    await this.init();
    this.stop();
    const vocal = await this.renderVocal(doc, fxOverride);
    const mml = songDocToDtmMml(doc);
    const ctx = this.studio!.audioContext;
    await ctx.resume();

    const durationSec = Math.max(
      songDurationSec(doc.bars, doc.bpm, doc.beatsPerBar) + 1.0,
      vocal.seconds + 0.5,
    );

    // メトリクス用: 歌のみ（オフライン）
    const vocalMetrics = analyzeBuffer(vocal.wav, vocal.sampleRate);

    this.studio!.startWavRecording();

    const buf = ctx.createBuffer(1, vocal.wav.length, vocal.sampleRate);
    buf.copyToChannel(vocal.wav, 0);
    const delay = SEQUENCER_START_DELAY;
    let scheduledVocalAt = 0;
    let scheduledBackingAt = 0;

    this.playback = this.studio!.play(mml, {
      onResumeAudio: async () => {
        scheduledBackingAt = ctx.currentTime + delay;
        scheduledVocalAt = scheduledBackingAt;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = 0.9;
        src.connect(g);
        g.connect(this.studio!.masterGain);
        src.start(scheduledVocalAt);
        this.vocalSource = src;
      },
      onStop: () => {
        /* 曲長待ちを優先。onStop では終わらせない */
      },
    });

    await sleep(durationSec * 1000 + 400);
    this.playback?.stop();
    await sleep(250);

    const wavBlob = await this.studio!.stopWavRecording();
    const wav = await wavBlob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(wav.slice(0));
    const left = decoded.getChannelData(0);
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = 0.5 * (left[i] + (right[i] ?? left[i]));

    const mixMetrics = analyzeBuffer(mono, decoded.sampleRate);

    // 伴奏のみを短く録って onset 比較（同じ遅延）
    const backingOnly = await this.recordBackingOnly(mml, Math.min(durationSec, 4));
    const backingMetrics = analyzeBuffer(backingOnly.data, backingOnly.sampleRate);

    // スケジュール差（同じ onResumeAudio 内で同一時刻を予約）。有音差は leading pau 参考値。
    const audibleOnsetDeltaMs =
      vocalMetrics.onsetMs >= 0 && backingMetrics.onsetMs >= 0
        ? vocalMetrics.onsetMs - backingMetrics.onsetMs
        : NaN;
    const offsetMs = (scheduledVocalAt - scheduledBackingAt) * 1000;

    const mp3 = await encodeMp3Stereo(left, right.length === left.length ? right : left, decoded.sampleRate);

    const metrics: PlayMetrics = {
      vocalRms: vocalMetrics.rms,
      vocalPeak: vocalMetrics.peak,
      vocalOnsetMs: vocalMetrics.onsetMs,
      backingRms: backingMetrics.rms,
      backingPeak: backingMetrics.peak,
      backingOnsetMs: backingMetrics.onsetMs,
      mixRms: mixMetrics.rms,
      mixPeak: mixMetrics.peak,
      audibleOnsetDeltaMs,
      offsetMs,
      scheduledDelaySec: delay,
      vocalStartSec: vocal.startSec,
      durationMs: mixMetrics.durationMs,
    };

    this.stop();
    return { wav, mp3, metrics, vocal, sampleRate: decoded.sampleRate };
  }

  /** エフェクト差分用: 歌だけを WAV bytes に */
  exportVocalWav(vocal: VocalRenderResult, fx?: Partial<FxParams> | null): ArrayBuffer {
    const wav = applyVocalFx(vocal.wav, vocal.sampleRate, fx);
    const [l, r] = monoToStereo(wav);
    return encodeWavPCM16([l, r], vocal.sampleRate);
  }

  private async recordBackingOnly(
    mml: string,
    durationSec: number,
  ): Promise<{ data: Float32Array; sampleRate: number }> {
    await this.init();
    this.stop();
    const ctx = this.studio!.audioContext;
    await ctx.resume();
    this.studio!.startWavRecording();
    this.playback = this.studio!.play(mml);
    await sleep(durationSec * 1000);
    this.playback.stop();
    await sleep(150);
    const blob = await this.studio!.stopWavRecording();
    const ab = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    const left = decoded.getChannelData(0);
    return { data: left.slice(), sampleRate: decoded.sampleRate };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const session = new DtmSession();
