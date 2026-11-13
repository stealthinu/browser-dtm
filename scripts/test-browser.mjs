import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {openBrowser} from './browser-host.mjs';
await mkdir('out',{recursive:true});await mkdir('docs/evidence',{recursive:true});
const {page,errors,close}=await openBrowser(5200);
try{
  const fixture=await readFile('fixtures/llm-reply.txt','utf8');
  await page.click('#prompt-button');
  assert.ok((await page.$eval('#prompt',e=>e.value)).includes('ゆうやけ'));
  await page.$eval('#reply',e=>e.value='{broken}');await page.click('#load');
  assert.equal(await page.$eval('#repair',e=>e.hidden),false);
  assert.ok((await page.$eval('#repair',e=>e.value)).includes('JSON'));
  await page.$eval('#reply',(e,text)=>e.value=text,fixture);await page.click('#load');
  assert.equal(await page.$eval('#errors',e=>e.hidden),true);
  await page.screenshot({path:'docs/evidence/piano-roll.png',fullPage:true});
  console.log('Paste workflow and piano roll: PASS. Synthesizing VocaTab on CPU…');
  const baseline=await page.evaluate(async()=>{
    const h=window.dtmHost,r=await h.render(),play=await h.play(r);
    const files={};
    for(const [id,data]of Object.entries({...r.stems,backing:r.backing,mix:r.mix}))files[id]=await h.saveAudio(data,id,'wav');
    files.mp3=await h.saveAudio(r.mix,'baseline','mp3');
    const stats=data=>{let sum=0,peak=0;for(const x of data){sum+=x*x;peak=Math.max(peak,Math.abs(x));}return{rms:Math.sqrt(sum/data.length),peak};};
    return {play,files,timing:r.timing,duration:r.duration,stats:Object.fromEntries(Object.entries(r.stems).map(([k,d])=>[k,stats(d)]))};
  });
  assert.equal(baseline.play.contextState,'running');
  assert.ok(baseline.stats.vocal.rms>0.001);assert.ok(baseline.stats.pf.rms>0.001);assert.ok(baseline.stats.bs.rms>0.001);
  // Let the full rendered song actually pass through the real AudioContext destination.
  await new Promise(resolve=>setTimeout(resolve,Math.ceil((baseline.duration+0.2)*1000)));
  await page.evaluate(()=>window.dtmHost.stop());
  console.log('Full song played through AudioContext destination; exporting effects…');
  const variants=[];
  for(const effect of ['kerokero','vocoder','bitcrusher','doubling']){
    for(const strength of [0,1]){
      const result=await page.evaluate(async({effect,strength})=>{
        const h=window.dtmHost,s=structuredClone(h.api.song),v=s.tracks.find(t=>t.kind==='vocal');
        v.effects={kerokero:0,vocoder:0,bitcrusher:0,doubling:0,[effect]:strength};
        const r=await h.render(s),name=`${effect}-${strength}`;
        await h.saveAudio(r.mix,name,'mp3');await h.saveAudio(r.stems.vocal,`${name}-vocal`,'wav');
        return {effect,strength,format:'mp3'};
      },{effect,strength});
      variants.push(result);console.log(`${effect} strength=${strength}: exported`);
    }
  }
  // Interactive slider → saved SongDoc → rendering state.
  await page.$eval('#doubling',e=>{e.value='0.5';e.dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>window.dtmHost.api.song.tracks[0].effects.doubling===0.5);
  const networkErrors=errors.filter(e=>!e.includes('favicon.ico')&&!e.includes('404 (Not Found)'));
  assert.deepEqual(networkErrors,[]);
  await writeFile('out/browser-result.json',JSON.stringify({baseline,variants,errors:networkErrors},null,2)+'\n');
  console.log('A1/A2/A4 browser workflow: PASS. See out/browser-result.json');
}finally{await close();}
