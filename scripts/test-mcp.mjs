import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,stat,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const fixture=JSON.parse(await readFile('fixtures/song.json','utf8'));
const transport=new StdioClientTransport({command:process.execPath,args:['scripts/mcp.mjs'],stderr:'pipe'});
const client=new Client({name:'acceptance-test',version:'1.0.0'});
try{
  await client.connect(transport);
  const {tools}=await client.listTools();assert.ok(tools.some(t=>t.name==='export'));
  const steps=[];
  async function call(name,args={}){const r=await client.callTool({name,arguments:args},undefined,{timeout:240000});assert.ok(!r.isError,`${name}: ${r.content?.[0]?.text}`);const result=JSON.parse(r.content[0].text);steps.push({name,result});return result;}
  await call('new_song',{title:'MCP 経由の夕焼け',bpm:120,bars:4});
  await call('set_track_notes',{trackId:'vo',notes:fixture.tracks[0].notes.map(({lyric,...n})=>n)});
  const lyrics=await call('set_lyrics',{trackId:'vo',text:'ゆうやけ そらに とけていく'});assert.equal(lyrics.missing,0);assert.deepEqual(lyrics.extra,[]);
  for(const t of fixture.tracks.filter(t=>t.kind==='inst'))await call('set_track_mml',{trackId:t.id,mml:t.mml,program:t.program});
  const output=await call('export');assert.match(output.file,/\.mp3$/);assert.ok((await stat(output.file)).size>1000);
  await writeFile('out/mcp-result.json',JSON.stringify({toolNames:tools.map(t=>t.name),steps},null,2)+'\n');
  console.log(`A6 MCP tools/list → new_song → notes → lyrics → 2 MML tracks → export: PASS (${output.file})`);
}finally{await client.close();await transport.close();}
