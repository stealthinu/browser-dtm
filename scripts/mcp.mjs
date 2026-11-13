import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {SongApi,toolDefinitions} from '../src/api.mjs';
import {openBrowser} from './browser-host.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
let headless;
const example=JSON.parse(await readFile('fixtures/song.json','utf8'));
const api=new SongApi(example,async(song,format)=>{
  if(format==='json'){await mkdir('out',{recursive:true});await writeFile('out/mcp-song.json',JSON.stringify(song,null,2)+'\n');return{file:'out/mcp-song.json'};}
  headless??=await openBrowser(5201);
  return headless.page.evaluate(async({song,format})=>{
    const r=await window.dtmHost.render(song);
    if(format==='render')return{duration:r.duration,timing:r.timing};
    return window.dtmHost.saveAudio(r.mix,'mcp-song',format);
  },{song,format});
});
const server=new Server({name:'browser-dtm-codex',version:'0.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:toolDefinitions}));
server.setRequestHandler(CallToolRequestSchema,async({params})=>{
  try{return{content:[{type:'text',text:JSON.stringify(await api.call(params.name,params.arguments??{}))}]};}
  catch(e){return{isError:true,content:[{type:'text',text:e.message}]};}
});
let closing=false;
async function close(){if(closing)return;closing=true;if(headless)await headless.close();await server.close();}
const transport=new StdioServerTransport();
await server.connect(transport);
process.stdin.on('end',()=>close().finally(()=>process.exit()));
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>close().finally(()=>process.exit()));
