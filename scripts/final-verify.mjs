// 最終検証は順番に実行。失敗の自動再試行はしない。
import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync, mkdirSync } from "node:fs";
const commands=[
 ["ci",["ci"]], ["build",["run","build"]], ["unit",["test"]],
 ["e2e",["run","e2e"]], ["fx",["run","e2e:fx"]], ["llm",["run","e2e:llm"]],
 ["soundfont",["run","e2e:soundfont"]], ["pianoroll",["run","e2e:pianoroll"]],
 ["gallery",["run","e2e:gallery"]], ["real",["run","e2e:real"]], ["mcp",["run","mcp:smoke"]]
];
mkdirSync("docs/evidence",{recursive:true});
const results=[];
for(const [name,args] of commands) {
 const start=new Date().toISOString(), t0=Date.now();
 const log=`docs/evidence/main-v1-m3-${name}.log`;
 const stream=createWriteStream(log);
 console.log(`START ${name} ${start}`);
 const child=spawn("npm",args,{stdio:["ignore","pipe","pipe"]});
 child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
 const code=await new Promise(resolve=>{child.on("error",e=>{stream.write(String(e));resolve(-1)});child.on("close",resolve)});
 await new Promise(resolve=>stream.end(resolve));
 results.push({name,command:`npm ${args.join(" ")}`,code,start,seconds:(Date.now()-t0)/1000,log});
 writeFileSync("out/final-verification.json",JSON.stringify(results,null,2));
 console.log(`${code===0?"PASS":"FAIL"} ${name} ${(Date.now()-t0)/1000}s`);
 if(code!==0) break;
}
process.exit(results.length===commands.length&&results.every(r=>r.code===0)?0:1);
