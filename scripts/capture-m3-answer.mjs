// 購読CLI statusのresult_textをバイト列として保存。返答の編集はしない。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const jobs=[{id:"20261116-112030-creative-sonnet-1a3b",answer:"gallery-answer-1.txt",prompt:"out/llm/gallery-prompt.txt"},{id:"20261116-112056-exec-sol-2a27",answer:"long-answer-1.txt",prompt:"out/llm/long-prompt.txt"}];
const sha=b=>createHash("sha256").update(b).digest("hex");
const entries=[];
for(const job of jobs) {
 const statusDir=process.env.JEV_STATUS_DIR ?? `${process.env.HOME}/jev-starter/status`;
 const status=JSON.parse(readFileSync(`${statusDir}/${job.id}.json`,"utf8"));
 if(status.state!=="done"||status.exit_code!==0||!status.result_text) {console.log(`${job.id}: ${status.state}`);continue;}
 const file=`fixtures/llm-real/${job.answer}`;
 if(existsSync(file)&&readFileSync(file,"utf8")!==status.result_text) throw new Error("既存の未編集返答と異なります");
 writeFileSync(file,status.result_text);
 entries.push({answer:job.answer,job:job.id,provider:`${status.route.provider}/${status.model}`,prompt_sha256:sha(readFileSync(job.prompt)),answer_sha256:sha(readFileSync(file)),source:"status/<job>.json result_text (未編集)",auth_fallback:false,duration_s:status.duration_s});
 console.log(`${file}: ${status.result_text.length} chars`);
}
writeFileSync("fixtures/llm-real/m3-provenance.json",JSON.stringify(entries,null,2)+"\n");
