// dtm の SoundFont（AGPL-3.0-or-later, (c) onjmin）を改変せず import。
// 公開 playMML のフックへ、先読みした実音源を接続する。
import { GM_INSTRUMENT_NAMES, DRUM_PATTERNS, parseMML, getDrumPatternKeys, unitsToMidiDetune, type PlayNoteEvent, type PlayDrumEvent } from "@onjmin/dtm";
import { SoundFont } from "@dtm-soundfont";

export const SF_URL = "https://surikov.github.io/webaudiofontdata/sound/";
const BANK = "FluidR3_GM_sf2_file";
const pending = new Map<string, Promise<SoundFont>>();
const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function programOf(value: string | undefined) {
  if (value === undefined) return 0;
  if (/^\d+$/.test(value) && Number(value) <= 127) return Number(value);
  const p = GM_INSTRUMENT_NAMES.findIndex((n) => keyOf(n) === keyOf(value));
  if (p < 0) throw new Error(`GM楽器名「${value}」が見つかりません`);
  return p;
}

function load(ctx: OfflineAudioContext, file: string, variable: string, drum?: number): Promise<SoundFont> {
  if (!pending.has(variable)) {
    const promise = (async () => {
      // 上流のscript読込にはtimeoutがないため、このラッパーで失敗を確定する。
      if (!(variable in window)) await new Promise<void>((ok, fail) => {
        const script = document.createElement("script");
        const timer = window.setTimeout(() => done(new Error("SoundFont 読み込みが時間切れ")), 15000);
        const done = (error?: Error) => { clearTimeout(timer); script.remove(); error ? fail(error) : ok(); };
        script.onload = () => done(); script.onerror = () => done(new Error(`SoundFont 読み込み失敗: ${file}`));
        script.src = SF_URL + file + ".js"; document.head.append(script);
      });
      return SoundFont.load({ ctx: ctx as unknown as AudioContext, fontName: variable, url: SF_URL + file + ".js",
        isDrum: drum !== undefined, pitchs: drum === undefined ? undefined : [drum] });
    })();
    pending.set(variable, promise);
    promise.catch(() => pending.delete(variable));
  }
  return pending.get(variable)!;
}

export async function prepareSoundfont(ctx: OfflineAudioContext, mml: string) {
  const parsed = parseMML(mml);
  const instruments = new Map<number, SoundFont>(), drums = new Map<number, SoundFont>();
  const files: string[] = [];
  await Promise.all([...new Set(parsed.placements.map((p) => p.trackIndex))].map(async (i) => {
    const program = programOf(parsed.meta?.trackInstruments?.[i]);
    const file = `${String(program).padStart(3, "0")}0_${BANK}`;
    files.push(file); instruments.set(i, await load(ctx, file, `_tone_${file}`));
  }).concat(getDrumPatternKeys(parsed.meta?.drum ?? "none", DRUM_PATTERNS).map(async (pitch) => {
    const file = `128${pitch}_0_${BANK}`;
    files.push(file); drums.set(pitch, await load(ctx, file, `_drum_${pitch}_0_${BANK}`, pitch));
  })));
  return {
    files,
    note: (ctx: AudioContext, destination: AudioNode, e: PlayNoteEvent) => {
      const i = ["melody", "submelody", "bass", "chord"].indexOf(e.trackId);
      const index = i < 0 ? Number(e.trackId.slice(1)) : i;
      const sf = instruments.get(index);
      if (!sf) throw new Error(`楽器トラック ${e.trackId} の音源がありません`);
      const { midi, detuneCents } = unitsToMidiDetune(e.pitchUnits);
      sf.play({ ctx, destination, pitch: midi, detuneCents, volume: e.volume, velocity: e.velocity, when: e.when, duration: e.duration });
    },
    drum: (ctx: AudioContext, destination: AudioNode, e: PlayDrumEvent) => {
      const sf = drums.get(e.pitch);
      if (!sf) throw new Error(`ドラム ${e.pitch} の音源がありません`);
      sf.play({ ctx, destination, pitch: e.pitch, volume: e.velocity, when: e.when, duration: e.duration });
    },
  };
}
export type PreparedSoundfont = Awaited<ReturnType<typeof prepareSoundfont>>;
