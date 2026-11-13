// SongDoc is the single source of truth. Shared by browser and stdio MCP.

export const EFFECTS = ['kerokero', 'vocoder', 'bitcrusher', 'doubling'];
export const TPQ = 480;
export function morae(text) {
  const out = [];
  for (const c of text.normalize('NFKC').replace(/[\s、。，,！!？?]/gu, '')) {
    if (!/^[ぁ-ゖー]$/u.test(c)) throw new Error(`かな以外の文字: ${c}`);
    if (/[ゃゅょぁぃぅぇぉゎ]/u.test(c) && out.length && !/[っんー]/u.test(out.at(-1))) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}
export function assignLyrics(notes, text) {
  const units = morae(text);
  return { notes: notes.map((n, i) => ({ ...n, lyric: units[i] ?? '' })),
    missing: Math.max(0, notes.length - units.length), extra: units.slice(notes.length), moraCount: units.length };
}
export function lengthTicks(len) {
  const m = /^(1|2|4|8|16|32|64)(\.{0,3})$/.exec(String(len));
  if (!m) throw new Error(`音価が不正: ${len}`);
  return TPQ * 4 / Number(m[1]) * (2 - 2 ** (-m[2].length));
}
export function midiPitch(pitch) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(String(pitch));
  if (!m) throw new Error(`音名が不正: ${pitch}`);
  const p = (Number(m[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + ({ '#': 1, b: -1 }[m[2]] ?? 0);
  if (p < 0 || p > 127) throw new Error(`MIDI 音域外: ${pitch}`);
  return p;
}
export function toVocaNotes(song, track = song.tracks.find(t => t.kind === 'vocal')) {
  return track.notes.map((n, i) => ({ id: i + 1, onset: Math.round(((n.bar - 1) * song.beatsPerBar + n.beat - 1) * TPQ),
    dur: lengthTicks(n.len), pitch: midiPitch(n.pitch), lyric: n.lyric, attrs: { vMod: 1 } }));
}
// MVP intentionally accepts a documented, deterministic subset of dtm MML.
// Reject unknown tokens instead of letting the upstream permissive parser drop them.
export function inspectMml(mml, song) {
  if (typeof mml !== 'string' || !mml.trim()) throw new Error('MML が空です');
  if (mml.length > 32000) throw new Error('MML は32000文字以内');
  const pattern = /\s+|[olvt]\d+|[<>]|[a-gr](?:[+#-])?\d*\.{0,3}|'[a-g+#\-]+'\d*\.{0,3}/gy;
  let pos = 0, match, octave=4, defaultLen='4', step=0, velocity=100;
  const placements=[];
  while (pos < mml.length) {
    pattern.lastIndex = pos; match = pattern.exec(mml);
    if (!match) throw new Error(`MML の未対応構文: 文字位置 ${pos}: ${mml.slice(pos, pos + 12)}`);
    const token=match[0], c=token[0], value=Number(token.slice(1));
    if (c === 't' && value !== song.bpm) throw new Error(`MML テンポは SongDoc bpm=${song.bpm} と一致させてください: 文字位置 ${pos}`);
    if(c==='o'){if(value<0||value>8)throw new Error(`MML octave は0〜8: 文字位置 ${pos}`);octave=value;}
    else if(c==='l'){lengthTicks(token.slice(1));defaultLen=token.slice(1);}
    else if(c==='v'){if(value<0||value>127)throw new Error(`MML velocity は0〜127: 文字位置 ${pos}`);velocity=value;}
    else if(c==='>')octave++;else if(c==='<')octave--;
    else if(/[a-gr']/.test(c)){
      const parts=c==="'" ? /^'([^']+)'(.*)$/.exec(token) : /^([a-gr][+#-]?)(.*)$/.exec(token);
      const suffix=parts[2], len=/^\./.test(suffix)?defaultLen+suffix:suffix||defaultLen;
      const durationSteps=lengthTicks(len)/10;
      if(c!=='r') for(const p of parts[1].match(/[a-g][+#-]?/g)??[]){
        const pitch=midiPitch(p[0].toUpperCase()+(p[1]==='-'?'b':p[1]==='+'?'#':p[1]??'')+octave);
        placements.push({trackIndex:0,startStep:step,durationSteps,pitchUnits:pitch*31,velocity});
      }
      step+=durationSteps;
    }
    pos = pattern.lastIndex;
  }
  if (!placements.length) throw new Error('MML に音符がありません');
  const endStep = step;
  if (endStep > song.bars * 192) throw new Error(`MML が曲の末尾を超えています: ${endStep}/192 小節`);
  return { placements, noteCount: placements.length, endStep, remainingSteps: song.bars * 192 - endStep };
}
export function toDtmMml(song) {
  return song.tracks.filter(t => t.kind === 'inst').map((t, i) => `@${i} t${song.bpm} ${t.mml};`).join('\n');
}
export function validateSong(song) {
  const errors = [];
  const check = (path, fn) => { try { fn(); } catch (e) { errors.push(`${path}: ${e.message}`); } };
  if (!song || typeof song !== 'object') return ['SongDoc object が必要です'];
  if (song.version !== 1) errors.push('version は1');
  if (typeof song.title !== 'string' || song.title.length > 200) errors.push('title は200文字以内');
  if (!Number.isFinite(song.bpm) || song.bpm < 40 || song.bpm > 240) errors.push('bpm は40〜240');
  if (song.beatsPerBar !== 4) errors.push('最小版は beatsPerBar=4');
  if (!Number.isInteger(song.bars) || song.bars < 1 || song.bars > 32) errors.push('bars は1〜32');
  if (!Array.isArray(song.tracks) || song.tracks.length > 8) return [...errors, 'tracks は8個以内の配列'];
  if (song.tracks.filter(t => t.kind === 'vocal').length !== 1) errors.push('歌トラックは1つ');
  const ids = new Set();
  for (const t of song.tracks) check(`track ${t.id}`, () => {
    if (typeof t.id !== 'string' || !/^[\w-]{1,40}$/.test(t.id) || ids.has(t.id)) throw new Error('id は重複しない英数字');
    ids.add(t.id);
    if (t.volume !== undefined && (!Number.isFinite(t.volume) || t.volume < 0 || t.volume > 1)) throw new Error('volume は0〜1');
    if (t.kind === 'vocal') {
      if (!['ritsu', 'oniku', 'natsume'].includes(t.singer)) throw new Error('singer は ritsu/oniku/natsume');
      if (!Array.isArray(t.notes) || t.notes.length > 512) throw new Error('notes は512個以内');
      let end = 0;
      t.notes.forEach((n, i) => {
        if (!Number.isInteger(n.bar) || n.bar < 1 || n.bar > song.bars || !Number.isFinite(n.beat) || n.beat < 1 || n.beat >= 5) throw new Error(`note[${i}] bar/beat が範囲外`);
        const start = ((n.bar - 1) * 4 + n.beat - 1) * TPQ, dur = lengthTicks(n.len);
        if (start < end) throw new Error(`note[${i}] 重なり/並び順が不正`);
        if (start + dur > song.bars * 4 * TPQ) throw new Error(`note[${i}] 曲末を超過`);
        end = start + dur;
        const p = midiPitch(n.pitch);
        if (p < 48 || p > 84) throw new Error(`note[${i}] 歌声の対応音域 C3〜C6 外`);
        if (typeof n.lyric !== 'string' || morae(n.lyric).length !== 1) throw new Error(`note[${i}] lyric は1モーラ`);
      });
      for (const [name, v] of Object.entries(t.effects ?? {})) if (!EFFECTS.includes(name) || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`effect ${name} は0〜1`);
    } else if (t.kind === 'inst') {
      if (!['piano', 'bass', 'pad'].includes(t.program)) throw new Error('program は piano/bass/pad');
      inspectMml(t.mml, song);
    } else throw new Error('kind は vocal/inst');
  });
  return errors;
}
export function requireSong(song) {
  const errors = validateSong(song);
  if (errors.length) throw new Error(errors.join('\n'));
  return song;
}
export function parseReply(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  let value;
  try { value = JSON.parse(fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); }
  catch (e) { throw new Error(`JSON の構文エラー: ${e.message}`); }
  return requireSong(value.song ?? value);
}
export function makePrompt(lyrics, image, example, toolDefinitions) {
  return `以下の歌詞で曲を作ってください。歌詞: ${lyrics}\nイメージ: ${image}\n` +
    `SongDoc version=1 の JSON をコードフェンス1つで返してください。4/4、4〜8小節、bpm=40〜240。\n` +
    `歌はbar/beatが1始まり、lenは1,2,4,8,16,32,64と付点(.を最大3つ)。音域C3〜C6、1モーラ=1音符、拗音は1、っ/ん/ーも各1。\n` +
    `伴奏はkind=instで2パート以上、program=piano/bass/pad。mmlはdtmのo/l/v/t、cdefgab/r、半音+#-、<>、和音'ceg'と音価。トラック宣言やマクロは入れない。\n` +
    `歌のeffectsはkerokero/vocoder/bitcrusher/doubling、各0〜1、volumeは各0〜1。音符は時刻順で重ねない。\n` +
    `共通API定義: ${JSON.stringify(toolDefinitions)}\n見本（歌詞に合わせて作り直す）:\n${JSON.stringify(example, null, 2)}`;
}
