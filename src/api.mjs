import { assignLyrics, inspectMml, requireSong, validateSong } from './song.mjs';
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' }, num = { type: 'number' };
export const toolDefinitions = [
  ['get_song', '現在の SongDoc を返す', schema()],
  ['new_song', '空の SongDoc を作る（4/4）', schema({ title: str, bpm: num, bars: { type: 'integer' } }, ['bpm', 'bars'])],
  ['set_chords', '和音メモを保存する', schema({ progression: str }, ['progression'])],
  ['set_track_notes', '歌トラックの音符を置き換える', schema({ trackId: str, singer: {type:'string',enum:['ritsu','oniku','natsume']}, notes: { type: 'array', items: schema({bar:num,beat:num,len:str,pitch:str,lyric:str},['bar','beat','len','pitch']) } }, ['trackId', 'notes'])],
  ['set_lyrics', 'かなを1モーラずつ割り当て、過不足を返す', schema({ trackId: str, text: str }, ['trackId', 'text'])],
  ['set_track_mml', '伴奏MMLを検査して保存する', schema({ trackId: str, mml: str, program: {type:'string',enum:['piano','bass','pad']} }, ['trackId', 'mml'])],
  ['set_mix', 'トラック音量と歌声エフェクトを保存する', schema({ trackId: str, volume: num, effects: schema({kerokero:num,vocoder:num,bitcrusher:num,doubling:num}) }, ['trackId'])],
  ['render', 'ブラウザで歌と伴奏を描画する', schema()],
  ['export', '既定MP3、またはWAV/JSONを保存する', schema({ format: {type:'string',enum:['mp3','wav','json']} })],
  ['finish', '構造検査の結果を返す', schema()]
].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));
export class SongApi {
  constructor(song, renderer) { this.song = structuredClone(song); this.renderer = renderer; }
  async call(name, a = {}) {
    if (!toolDefinitions.some(t => t.name === name)) throw new Error(`未知の道具: ${name}`);
    if (name === 'get_song') return structuredClone(this.song);
    if (name === 'new_song') {
      const s = {version:1,title:a.title ?? '新しい曲',bpm:a.bpm,beatsPerBar:4,bars:a.bars,tracks:[{id:'vo',kind:'vocal',singer:'ritsu',notes:[],effects:{},volume:0.7}]};
      this.song = requireSong(s); return this.song;
    }
    if (name === 'render' || name === 'export') {
      requireSong(this.song);
      if (!this.renderer) throw new Error('描画ホストが接続されていません');
      return this.renderer(this.song, name === 'render' ? 'render' : a.format ?? 'mp3');
    }
    if (name === 'finish') return { errors: validateSong(this.song), tracks: this.song.tracks.length };
    const next = structuredClone(this.song);
    if (name === 'set_chords') { next.chords = a.progression; this.song = next; return { chords: a.progression }; }
    let t = next.tracks.find(t => t.id === a.trackId), result;
    if (name === 'set_track_notes') {
      if (t && t.kind !== 'vocal') throw new Error('歌トラックではありません');
      t ??= {id:a.trackId,kind:'vocal',singer:a.singer ?? 'ritsu',effects:{},volume:0.7};
      if (!next.tracks.includes(t)) next.tracks.push(t);
      t.notes = a.notes.map(n => ({...n,lyric:n.lyric ?? 'あ'}));
      result = {noteCount:t.notes.length};
    } else if (name === 'set_track_mml') {
      if (t && t.kind !== 'inst') throw new Error('伴奏トラックではありません');
      t ??= {id:a.trackId,kind:'inst',volume:0.35};
      if (!next.tracks.includes(t)) next.tracks.push(t);
      t.mml = a.mml; t.program = a.program ?? 'piano';
      const {placements, ...facts} = inspectMml(t.mml, next); result = facts;
    } else {
      if (!t) throw new Error(`トラックがありません: ${a.trackId}`);
      if (name === 'set_lyrics') {
        if (t.kind !== 'vocal') throw new Error('歌トラックではありません');
        result = assignLyrics(t.notes, a.text);
        if (result.missing || result.extra.length) return {...result, saved:false};
        t.notes = result.notes;
      } else if (name === 'set_mix') {
        if (a.volume !== undefined) t.volume = a.volume;
        if (a.effects !== undefined) { if (t.kind !== 'vocal') throw new Error('歌トラックのエフェクトのみ対応'); t.effects = a.effects; }
        result = {volume:t.volume,effects:t.effects};
      }
    }
    requireSong(next); this.song = next; return result;
  }
}
