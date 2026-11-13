import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {morae,assignLyrics,lengthTicks,midiPitch,toVocaNotes,toDtmMml,validateSong,parseReply,inspectMml} from '../src/song.mjs';
import {SongApi,toolDefinitions} from '../src/api.mjs';
const song=JSON.parse(await readFile(new URL('../fixtures/song.json',import.meta.url),'utf8'));
test('morae: contracted sounds, long vowel, sokuon, nasal, normalized kana',()=>{
  assert.deepEqual(morae('きゃ しゅ ちょ こーひー きって ほん'),['きゃ','しゅ','ちょ','こ','ー','ひ','ー','き','っ','て','ほ','ん']);
  assert.deepEqual(morae('ふぁ てぃ ゔぁ'),['ふぁ','てぃ','ゔぁ']);
  assert.throws(()=>morae('漢字'),/かな以外/);
});
test('lyrics: shortage and surplus are explicit, original notes are unchanged',()=>{
  const notes=[{pitch:'C4'},{pitch:'D4'},{pitch:'E4'}];
  assert.equal(assignLyrics(notes,'きゃっと').missing,0);
  assert.equal(assignLyrics(notes,'きゃ').missing,2);
  assert.deepEqual(assignLyrics(notes,'あいうえお').extra,['え','お']);
  assert.deepEqual(assignLyrics(notes,'きゃっと').notes.map(n=>n.lyric),['きゃ','っ','と']);
  assert.equal(notes[0].lyric,undefined);
});
test('musical conversion: dotted values, TPQ, enharmonics and fractional beats',()=>{
  assert.equal(lengthTicks('4'),480);assert.equal(lengthTicks('8.'),360);assert.equal(lengthTicks('4..'),840);
  assert.equal(midiPitch('G4'),67);assert.equal(midiPitch('Bb3'),58);assert.equal(midiPitch('C#4'),61);
  for(const bad of ['0','3','4....','evil'])assert.throws(()=>lengthTicks(bad));
  const copy=structuredClone(song);copy.tracks[0].notes=[{bar:2,beat:1.5,len:'8.',pitch:'G4',lyric:'きゃ'}];
  assert.deepEqual(toVocaNotes(copy)[0],{id:1,onset:2160,dur:360,pitch:67,lyric:'きゃ',attrs:{vMod:1}});
  assert.match(toDtmMml(song),/@0 t120/);assert.match(toDtmMml(song),/@1 t120/);
});
test('SongDoc: valid fixture, lyrics per note, range, overlap, effects and boundaries',()=>{
  assert.deepEqual(validateSong(song),[]);
  for(const mutate of [s=>s.bpm=0,s=>s.beatsPerBar=3,s=>s.tracks[0].notes[0].lyric='あい',s=>s.tracks[0].notes[0].pitch='C8',s=>s.tracks[0].notes[1].beat=1,s=>s.tracks[0].notes[0].bar=9,s=>s.tracks[0].effects.vocoder=2,s=>s.tracks[0].volume=NaN,s=>s.tracks[2].id='vo']){const s=structuredClone(song);mutate(s);assert.ok(validateSong(s).length);}
});
test('reply accepts explanatory text and fences; malformed data is actionable',()=>{
  assert.equal(parseReply(`説明\n\`\`\`json\n${JSON.stringify(song)}\n\`\`\``).title,song.title);
  assert.equal(parseReply(JSON.stringify({song})).bpm,120);
  assert.throws(()=>parseReply('{broken}'),/JSON/);
});
test('MML strict subset: chords, rests, dotted values, diagnostics and end bounds',()=>{
  const r=inspectMml("o4 l4 'ceg'2 r4 c8.",song);
  assert.equal(r.noteCount,4);assert.equal(r.endStep,180);
  assert.equal(r.placements[0].pitchUnits,60*31);
  assert.equal(inspectMml('c4..',song).endStep,108); // dtm repeats ×1.5, unlike SongDoc length.
  assert.equal(inspectMml('c64.',song).endStep,5); // dtm rounds every step to an integer.
  assert.equal(inspectMml('c',song).endStep,48); // host explicitly sets l4.
  assert.equal(inspectMml('o8 > c',song).placements[0].pitchUnits,108*31);
  for(const bad of ['o4 c4 ???','c0','c3','t90 c4','o99 c4','c1 c1 c1 c1 c1','#audio=https://example.com c4','v999 c4'])assert.throws(()=>inspectMml(bad,song));
});
test('API: same definitions, transactional failures, lyric counts and mix persistence',async()=>{
  const api=new SongApi(song,async(s,format)=>({format,tracks:s.tracks.length}));
  assert.ok(toolDefinitions.some(t=>t.name==='export'));
  const before=JSON.stringify(api.song);await assert.rejects(api.call('set_track_mml',{trackId:'pf',mml:'?'}));assert.equal(JSON.stringify(api.song),before);
  const short=await api.call('set_lyrics',{trackId:'vo',text:'きゃ'});assert.equal(short.saved,false);assert.equal(short.missing,11);assert.equal(JSON.stringify(api.song),before);
  await api.call('set_lyrics',{trackId:'vo',text:'ゆうやけそらにとけていく'});
  await api.call('set_mix',{trackId:'vo',effects:{doubling:0.5}});assert.equal(api.song.tracks[0].effects.doubling,0.5);
  await api.call('set_track_notes',{trackId:'vo',singer:'oniku',notes:song.tracks[0].notes});assert.equal(api.song.tracks[0].singer,'oniku');
  assert.equal((await api.call('export')).format,'mp3');
});
