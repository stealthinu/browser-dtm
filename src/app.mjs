import {parseReply,makePrompt,toVocaNotes,inspectMml,EFFECTS,requireSong} from './song.mjs';
import {SongApi,toolDefinitions} from './api.mjs';
import {renderSong,playRendered,stopPlayback,saveAudio} from './audio.mjs';
const $=id=>document.getElementById(id), status=text=>$('status').textContent=text;
let example,replyExample,api,rendered,busy=false;
const names={kerokero:'ケロケロボイス',vocoder:'ボコーダー',bitcrusher:'ビットクラッシャー',doubling:'ダブリング'};
function drawRoll(song){
  const c=$('roll'),g=c.getContext('2d'),W=c.width,H=c.height,left=50,top=30,min=30,max=83,row=(H-top-24)/(max-min+1),width=W-left-15,total=song.bars*4;
  g.fillStyle='#11151e';g.fillRect(0,0,W,H);g.font='11px system-ui';
  for(let p=min;p<=max;p++){
    const y=top+(max-p)*row;g.fillStyle=[1,3,6,8,10].includes(p%12)?'#151923':'#1b202c';g.fillRect(left,y,width,row-0.4);
    if(p%12===0){g.fillStyle='#7e879c';g.fillText(`C${p/12-1}`,12,y+row+2);}
  }
  for(let b=0;b<=total;b++){const x=left+b/total*width;g.strokeStyle=b%4===0?'#465069':'#292f40';g.beginPath();g.moveTo(x,top);g.lineTo(x,H-24);g.stroke();if(b%4===0&&b<total){g.fillStyle='#a2aabb';g.fillText(`${b/4+1}`,x+5,20);}}
  const rect=(start,dur,pitch,color,lyric)=>{const x=left+start/total*width,y=top+(max-pitch)*row;g.fillStyle=color;g.fillRect(x+1,y+0.3,Math.max(2,dur/total*width-2),Math.max(4,row-0.8));if(lyric){g.font='12px system-ui';g.fillText(lyric,x+3,y-5);}};
  for(const t of song.tracks){
    if(t.kind==='vocal')for(const n of toVocaNotes(song,t))rect(n.onset/480,n.dur/480,n.pitch,'#f3b18d',n.lyric);
    else for(const n of inspectMml(t.mml,song).placements)rect(n.startStep/48,n.durationSteps/48,n.pitchUnits/31,t.program==='bass'?'#6ccbb8':'#9fa2ed');
  }
  g.fillStyle='#69748c';g.font='10px system-ui';g.fillText('4/4 · 1小節 = 4拍',left,H-7);
}
function update(){
  const song=api.song,v=song.tracks.find(t=>t.kind==='vocal');
  $('title').textContent=song.title;$('meta').textContent=`${song.bpm} BPM  /  4/4  /  ${song.bars} 小節  /  ${song.tracks.length} トラック`;
  for(const key of EFFECTS){$(key).value=v.effects?.[key]??0;$(key+'-value').textContent=Number($(key).value).toFixed(2);}
  drawRoll(song);rendered=null;$('download').hidden=true;
}
function load(text){const song=parseReply(text);api.song=structuredClone(song);stopPlayback();update();$('errors').hidden=true;$('repair').hidden=true;status('読み込み完了。再生できます。');return song;}
function prompt(){const text=makePrompt($('lyrics').value,$('image').value,example,toolDefinitions);$('prompt').value=text;return text;}
async function render(song=api.song){
  if(JSON.stringify(song)!==JSON.stringify(api.song)){api.song=structuredClone(requireSong(song));update();}
  rendered??=await renderSong(api.song,status);status('合成完了');return rendered;
}
async function exportSong(format='mp3'){
  if(format==='json'){const blob=new Blob([JSON.stringify(api.song,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='song.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return {format};}
  const r=await render(),result=await saveAudio(r.mix,'song',format);
  $('download').href=result.url;$('download').textContent=`${format.toUpperCase()} を保存`;$('download').hidden=false;$('download').click();status(`${format.toUpperCase()} 書き出し完了`);return result;
}
async function run(fn){if(busy)return;busy=true;const buttons=[...document.querySelectorAll('button,input[type=range]')].filter(b=>b.id!=='stop');buttons.forEach(b=>b.disabled=true);try{return await fn();}catch(e){status('処理に失敗しました');$('errors').textContent=e.message;$('errors').hidden=false;throw e;}finally{busy=false;buttons.forEach(b=>b.disabled=false);}}
function bind(id,fn){$(id).onclick=()=>{run(fn).catch(console.error);};}
for(const key of EFFECTS){const d=document.createElement('div');d.className='effect';d.innerHTML=`<label for="${key}">${names[key]} <span id="${key}-value">0.00</span></label><input id="${key}" type="range" min="0" max="1" step="0.05" value="0">`;$('effects').append(d);$(key).oninput=async()=>{await api.call('set_mix',{trackId:api.song.tracks.find(t=>t.kind==='vocal').id,effects:Object.fromEntries(EFFECTS.map(k=>[k,Number($(k).value)]))});rendered=null;$(key+'-value').textContent=Number($(key).value).toFixed(2);$('download').hidden=true;status('エフェクトを変更しました');};}
example=await (await fetch('/fixtures/song.json')).json();replyExample=await (await fetch('/fixtures/llm-reply.txt')).text();
api=new SongApi(example,async(song,format)=>format==='render'?{duration:(await render(song)).duration}:exportSong(format));
bind('prompt-button',()=>{prompt();$('prompt').closest('details').open=true;status('プロンプトを生成しました');});
bind('copy',async()=>{await navigator.clipboard.writeText($('prompt').value||prompt());status('コピーしました');});
bind('example',()=>{$('reply').value=replyExample;load(replyExample);});
bind('load',()=>{try{load($('reply').value);}catch(e){$('errors').textContent=e.message;$('errors').hidden=false;$('repair').value=`次の返答を修正し、完全な SongDoc JSON を返してください。検査結果:\n${e.message}\n元の返答:\n${$('reply').value}`;$('repair').hidden=false;status('検査エラー。修正依頼を LLM に返してください。');}});
bind('play',async()=>{const r=await render();await playRendered(r);status('再生中');});
$('stop').onclick=()=>{stopPlayback();status('停止しました');};
bind('export',()=>exportSong());bind('wav',()=>exportSong('wav'));bind('json',()=>exportSong('json'));
update();prompt();status('見本を読み込み済み。再生できます。');
// Browser automation and local MCP use exactly the same renderer and SongDoc API.
window.dtmHost={load,render,play:playRendered,stop:stopPlayback,saveAudio,api,exportSong,get rendered(){return rendered;},ready:true};
