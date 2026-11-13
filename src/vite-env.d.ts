/// <reference types="vite/client" />

declare module "*.txt?raw" {
  const content: string;
  export default content;
}

declare module "vocatab-src/engine" {
  export function composeF0(
    ph: unknown,
    track: unknown,
    project: unknown,
  ): { log2: Float32Array; noDev: Float32Array };
  export function phraseParams(
    ph: unknown,
    track: unknown,
    project: unknown,
  ): Record<string, Float32Array>;
}

declare module "vocatab-src/model" {
  export function defaultBase(): Record<string, number>;
  export type Note = {
    id: number;
    onset: number;
    dur: number;
    pitch: number;
    lyric: string;
    attrs: { vMod: number };
  };
  export type Track = Record<string, unknown>;
  export type Project = Record<string, unknown>;
}

declare module "vocatab-src/engine-web/protocol" {
  export type AnalyzeResp = {
    frame_rate: number;
    phrases: Array<{
      key: string;
      note_ids: number[];
      start_frame: number;
      start_sec: number;
      n_frames: number;
      phonemes: unknown[];
      plain: Float32Array;
      vib: Float32Array;
      uv: Float32Array;
      base: Float32Array;
      seed: number;
    }>;
  };
  export type SynthResp = {
    n_frames: number;
    wav: Float32Array;
    mel_in: Float32Array;
  };
}

declare module "lamejs" {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  }
}
