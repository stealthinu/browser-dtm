// 同じ原音の窓で比較。振幅重み STFT 重心と 2–8 kHz 帯域エネルギー。
export function fft(re, im) {
 const n=re.length;
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let size=2;size<=n;size*=2){const angle=-2*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);for(let start=0;start<n;start+=size){let ur=1,ui=0;for(let j=0;j<size/2;j++){const a=start+j,b=a+size/2,tr=ur*re[b]-ui*im[b],ti=ur*im[b]+ui*re[b];re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;const r=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=r;}}}
}
export function spectralMetrics(reference, output, confidence, sr=44100) {
 const n=2048,hop=512,re=new Float64Array(n),im=new Float64Array(n);
 let voicedRef=0,voicedOut=0,voicedSamples=0,unvoicedFrames=0,voicedFrames=0,bandRef=0,bandOut=0,mass=0,moment=0;
 const spec=(x,start)=>{re.fill(0);im.fill(0);for(let j=0;j<n;j++)re[j]=(x[start+j]??0)*(0.5-0.5*Math.cos(2*Math.PI*j/n));fft(re,im);let band=0,m=0,f=0;for(let k=1;k<=n/2;k++){const hz=k*sr/n,mag=Math.hypot(re[k],im[k]);m+=mag;f+=hz*mag;if(hz>=2000&&hz<=8000)band+=mag**2;}return {band,m,f};};
 // 原音の有声確信度>=0.75 の同一サンプル集合。
 for(let i=0;i<Math.min(reference.length,output.length);i++)if(confidence[i]>=0.75){voicedRef+=reference[i]**2;voicedOut+=output[i]**2;voicedSamples++;}
 for(let start=0;start+n<=Math.min(reference.length,output.length);start+=hop){let power=0,c=0;for(let j=0;j<n;j++){power+=reference[start+j]**2;c+=confidence[start+j]??0;}power/=n;c/=n;
 if(power<1e-7)continue;
 if(c<0.25){bandRef+=spec(reference,start).band;bandOut+=spec(output,start).band;unvoicedFrames++;}
 if(c>=0.75){const s=spec(output,start);mass+=s.m;moment+=s.f;voicedFrames++;}
 }
 return {voicedRmsDeltaDb:10*Math.log10(Math.max(voicedOut,1e-30)/Math.max(voicedRef,1e-30)),voicedRmsDb:10*Math.log10(Math.max(voicedOut,1e-30)/Math.max(voicedSamples,1)),voicedSamples,voicedFrames,unvoicedFrames,consonantBandDeltaDb:10*Math.log10(Math.max(bandOut,1e-30)/Math.max(bandRef,1e-30)),centroidHz:moment/Math.max(mass,1e-30)};
}
