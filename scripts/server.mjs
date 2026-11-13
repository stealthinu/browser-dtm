import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir,writeFile,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.md':'text/plain; charset=utf-8','.onnx':'application/octet-stream','.bin':'application/octet-stream','.png':'image/png'};
export async function startServer({port=Number(process.env.PORT??5200),vocatabDir=process.env.VOCATAB_DIR??'/workspace/dtm-research/vocatab'}={}) {
  if(!Number.isInteger(port)||port<5200||port>5299)throw new Error('codex port must be 5200–5299');
  const origin=`http://127.0.0.1:${port}`;
  const server=http.createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,origin);
      if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==origin) {res.writeHead(403);res.end('Local origin required');return;}
      if(req.method==='POST'&&u.pathname==='/api/export'){
        const format=u.searchParams.get('format')??'mp3',name=u.searchParams.get('name')??'song';
        if(!['mp3','wav'].includes(format)||!/^[a-zA-Z0-9_-]{1,64}$/.test(name))throw new Error('Invalid export name/format');
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>100*1024*1024)throw new Error('Audio too large');chunks.push(chunk);}
        const wav=Buffer.concat(chunks);
        if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('WAV required');
        await mkdir(path.join(root,'out'),{recursive:true});
        const output=path.join(root,'out',`${name}.${format}`);
        if(format==='wav')await writeFile(output,wav);
        else await new Promise((resolve,reject)=>{
          const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-i','pipe:0','-codec:a','libmp3lame','-b:a','192k',output],{stdio:['pipe','ignore','pipe']});
          let err='';ff.stderr.on('data',d=>err+=d);ff.on('error',reject);ff.on('close',code=>code?reject(new Error(err)):resolve());ff.stdin.on('error',reject);ff.stdin.end(wav);
        });
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({file:`out/${name}.${format}`,url:`/out/${name}.${format}`,bytes:(await readFile(output)).length}));return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const route=decodeURIComponent(u.pathname);let base,rel;
      if(route.startsWith('/vocatab/')){
        base=path.resolve(vocatabDir);rel=route.slice(9);
        if(!/^(web_index\.json|voicebanks\/[\w/-]+\.(?:json|onnx|bin)|vocoders\/[\w/-]+\.(?:json|onnx))$/.test(rel)){res.writeHead(404);res.end();return;}
      }else if(route.startsWith('/ort/')){base=path.join(root,'node_modules/onnxruntime-web/dist');rel=route.slice(5);}
      else{base=root;rel=route==='/'?'index.html':route.slice(1);if(!/^(index\.html|style\.css|dist\/[\w.-]+|fixtures\/[\w.-]+|out\/[\w-]+\.(mp3|wav)|NOTICE\.md)$/.test(rel)){res.writeHead(404);res.end();return;}}
      const file=await realpath(path.resolve(base,rel));
      if(!file.startsWith((await realpath(base))+path.sep)){res.writeHead(403);res.end();return;}
      const data=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch(e){res.writeHead(e.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});res.end(e.message);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:origin,close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {const host=await startServer();console.log(`Browser DTM: ${host.url} (CPU only)`);for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>host.server.close(()=>process.exit()));}
