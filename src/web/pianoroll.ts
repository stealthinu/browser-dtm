import { parseMML } from "@onjmin/dtm";
import { editNotes, NoteHistory, type Snap, type NoteEdit } from "../core/pianoroll";
import { TPQ, toDtmMML, toVocaTabNotes, vocalTrack, type SongDoc, type VocalNote } from "../core/songdoc";
const COLORS = ["#ffb454", "#59c2ff", "#95e6cb", "#d2a6ff"];
export class PianoRoll {
  private selected = -1;
  private history = new NoteHistory();
  private drag: { index: number; x: number; y: number; onset: number; dur: number; midi: number; resize: boolean; moved: boolean } | null = null;
  private draft: VocalNote[] | null = null;
  private lyric: HTMLInputElement | null = null;
  private instCache: { mml: string; notes: ReturnType<typeof parseMML>["placements"] } | null = null;
  constructor(private cv: HTMLCanvasElement, private getDoc: () => SongDoc | null,
    private setNotes: (notes: VocalNote[]) => void, private message: (s: string) => void) {
    cv.tabIndex = 0; cv.setAttribute("aria-label", "歌のピアノロール。クリックで追加、ドラッグで移動、右端で長さ、ダブルクリックでかな編集");
    cv.addEventListener("pointerdown", e => this.down(e));
    cv.addEventListener("pointermove", e => this.move(e));
    cv.addEventListener("pointerup", e => this.up(e));
    cv.addEventListener("pointercancel", () => { this.drag = null; this.draft = null; this.draw(); });
    cv.addEventListener("contextmenu", e => { e.preventDefault(); const hit = this.hit(e); if (hit >= 0) this.apply({ type: "delete", index: hit }); });
    cv.addEventListener("dblclick", e => this.editLyric(e));
    cv.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (this.selected >= 0) this.apply({ type: "delete", index: this.selected }); }
      else if (e.key === "Escape") { this.selected = -1; this.draw(); }
    });
    document.getElementById("undo")!.onclick = () => this.undo();
    document.getElementById("redo")!.onclick = () => this.redo();
    document.getElementById("snap")!.addEventListener("change", () => this.draw());
  }
  reset() { this.history.reset(); this.selected = -1; this.drag = null; this.draft = null; this.lyric?.remove(); this.lyric = null; this.draw(); }
  private get snap(): Snap { return Number((document.getElementById("snap") as HTMLSelectElement).value) as Snap; }
  layout() {
    const d = this.getDoc();
    return { left: 40, top: 4, width: this.cv.width - 44, height: this.cv.height - 26, lo: 48, hi: 84,
      totalTicks: d ? d.bars * d.beatsPerBar * TPQ : 1920, rowHeight: (this.cv.height - 26) / 37 };
  }
  private pos(e: MouseEvent) { const r = this.cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * this.cv.width / r.width, y: (e.clientY - r.top) * this.cv.height / r.height }; }
  private coords(e: MouseEvent) { const {x,y}=this.pos(e), l=this.layout(); return {x,y,tick:(x-l.left)/l.width*l.totalTicks,midi:l.hi-Math.floor((y-l.top)/l.rowHeight)}; }
  private hit(e: MouseEvent) {
    const d=this.getDoc();if(!d)return -1;
    const {x,y}=this.pos(e),l=this.layout();
    return toVocaTabNotes(d,vocalTrack(d)!).filter(n=>n.pitch>=l.lo&&n.pitch<=l.hi).reverse().find(n=>x>=l.left+n.onset/l.totalTicks*l.width && x<=l.left+(n.onset+n.dur)/l.totalTicks*l.width && y>=l.top+(l.hi-n.pitch)*l.rowHeight && y<l.top+(l.hi-n.pitch+1)*l.rowHeight)?.id! - 1;
  }
  private update(notes: VocalNote[], record=true) {
    const d=this.getDoc(); if(!d)return;
    if(record) this.history.push(vocalTrack(d)!.notes);
    this.setNotes(notes); this.draw();
  }
  private apply(edit: NoteEdit) {
    const d=this.getDoc();if(!d)return;
    try { const n=editNotes(d,edit,this.snap); this.update(n); this.selected=edit.type==="add"?n.length-1:edit.type==="delete"?-1:edit.index; this.message("歌の音符を更新しました。再生で歌を合成し直します");this.draw(); }
    catch(e) { this.message(String((e as Error).message)); }
  }
  undo() { const d=this.getDoc();if(!d)return; const n=this.history.undo(vocalTrack(d)!.notes);if(n){this.selected=-1;this.update(n,false);this.message("音符編集を元に戻しました");} }
  redo() { const d=this.getDoc();if(!d)return; const n=this.history.redo(vocalTrack(d)!.notes);if(n){this.selected=-1;this.update(n,false);this.message("音符編集をやり直しました");} }
  private down(e: PointerEvent) {
    if(e.button!==0)return;
    const d=this.getDoc();if(!d)return;
    this.cv.focus(); const p=this.coords(e),l=this.layout();
    if(p.x<l.left||p.x>l.left+l.width||p.y<l.top||p.y>l.top+l.height)return;
    const i=this.hit(e);
    if(!(i>=0)) { if(e.detail<2)this.apply({type:"add",tick:p.tick,midi:p.midi});return; }
    this.selected=i;
    const n=toVocaTabNotes(d,vocalTrack(d)!).find(n=>n.id===i+1)!;
    const end=l.left+(n.onset+n.dur)/l.totalTicks*l.width;
    this.drag={index:i,x:p.x,y:p.y,onset:n.onset,dur:n.dur,midi:n.pitch,resize:end-p.x<12,moved:false};
    this.cv.setPointerCapture(e.pointerId);this.draw();
  }
  private move(e: PointerEvent) {
    const p=this.coords(e),l=this.layout(),drag=this.drag,d=this.getDoc();
    if(!d)return;
    if(!drag){ const i=this.hit(e);const n=i>=0?toVocaTabNotes(d,vocalTrack(d)!).find(n=>n.id===i+1):null; this.cv.style.cursor=n?(l.left+(n.onset+n.dur)/l.totalTicks*l.width-p.x<12?"ew-resize":"grab"):"crosshair";return; }
    if(Math.hypot(p.x-drag.x,p.y-drag.y)<3&&!drag.moved)return;
    drag.moved=true;
    const delta=(p.x-drag.x)/l.width*l.totalTicks;
    try { this.draft=editNotes(d,drag.resize?{type:"resize",index:drag.index,duration:drag.dur+delta}:{type:"move",index:drag.index,tick:drag.onset+delta,midi:drag.midi-Math.round((p.y-drag.y)/l.rowHeight)},this.snap);this.message("指を離すと確定します"); }
    catch(e){this.draft=null;this.message((e as Error).message);}
    this.draw();
  }
  private up(e: PointerEvent) { const drag=this.drag;this.drag=null;if(this.cv.hasPointerCapture(e.pointerId))this.cv.releasePointerCapture(e.pointerId);const notes=this.draft;this.draft=null;if(drag?.moved&&notes){this.update(notes);this.message("歌の音符を更新しました");}this.draw(); }
  private editLyric(e: MouseEvent) {
    const i=this.hit(e),d=this.getDoc();if(!(i>=0)||!d)return;
    this.lyric?.remove();
    const input=document.createElement("input");input.id="noteLyric";input.type="text";input.value=vocalTrack(d)!.notes[i].lyric??"あ";input.setAttribute("aria-label","音符のかな（1モーラ）");
    Object.assign(input.style,{position:"fixed",left:`${Math.min(e.clientX,innerWidth-120)}px`,top:`${e.clientY}px`,width:"110px",zIndex:"10",fontSize:"18px"});
    document.body.append(input);this.lyric=input;input.focus();input.select();let closed=false;
    const finish=(save:boolean)=>{if(closed)return;closed=true;if(save)this.apply({type:"lyric",index:i,lyric:input.value});input.remove();this.lyric=null;this.cv.focus();};
    input.addEventListener("keydown",e=>{if(e.isComposing)return;if(e.key==="Enter"){e.preventDefault();finish(true);}if(e.key==="Escape")finish(false);});input.onblur=()=>finish(true);
  }
  draw(playSec=-1) {
    const g=this.cv.getContext("2d")!,d=this.getDoc(),l=this.layout();g.clearRect(0,0,this.cv.width,this.cv.height);if(!d)return;
    const x=(t:number)=>l.left+t/l.totalTicks*l.width,y=(m:number)=>l.top+(l.hi-m)*l.rowHeight;
    for(let m=l.lo;m<=l.hi;m++){g.fillStyle=[1,3,6,8,10].includes(m%12)?"#15171c":"#23262d";g.fillRect(l.left,y(m),l.width,l.rowHeight);if(m%12===0){g.fillStyle="#aaa";g.font="11px sans-serif";g.fillText(`C${m/12-1}`,3,y(m)+l.rowHeight-2);}}
    const grid=TPQ*4/this.snap;for(let t=0;t<=l.totalTicks;t+=grid){g.strokeStyle=t%(d.beatsPerBar*TPQ)===0?"#777":t%TPQ===0?"#414550":"#2a2d35";g.beginPath();g.moveTo(x(t),l.top);g.lineTo(x(t),l.top+l.height);g.stroke();if(t%(d.beatsPerBar*TPQ)===0&&t<l.totalTicks){g.fillStyle="#aaa";g.font="11px sans-serif";g.fillText(String(t/(d.beatsPerBar*TPQ)+1),x(t)+3,this.cv.height-5);}}
    const mml=toDtmMML(d);if(this.instCache?.mml!==mml){try{this.instCache={mml,notes:parseMML(mml).placements};}catch{this.instCache={mml,notes:[]};}}
    for(const n of this.instCache.notes){const midi=Math.round(n.pitchUnits/31);if(midi<l.lo||midi>l.hi)continue;g.fillStyle=COLORS[(n.trackIndex+1)%4]+"65";g.fillRect(x(n.startStep*10),y(midi)+2,Math.max(2,n.durationSteps*10/l.totalTicks*l.width-1),l.rowHeight-4);}
    const v=vocalTrack(d)!;const vt=toVocaTabNotes(d,this.draft?{...v,notes:this.draft}:v);g.font="bold 12px sans-serif";
    for(const n of vt){const w=Math.max(3,n.dur/l.totalTicks*l.width-1),px=x(n.onset),py=y(n.pitch);g.fillStyle=n.id-1===this.selected?"#ffe3a6":COLORS[0];g.fillRect(px,py,w,l.rowHeight-1);g.fillStyle="#ad732f";g.fillRect(px+w-3,py+2,2,l.rowHeight-5);g.save();g.beginPath();g.rect(px,py,w,l.rowHeight);g.clip();g.fillStyle="#111";g.fillText(n.lyric,px+2,py+l.rowHeight-3);g.restore();}
    if(playSec>=0){g.strokeStyle="#fff";g.beginPath();g.moveTo(x(playSec*d.bpm*TPQ/60),0);g.lineTo(x(playSec*d.bpm*TPQ/60),this.cv.height);g.stroke();}
    const legend=document.getElementById("legend")!;legend.replaceChildren();for(const t of d.tracks){const s=document.createElement("span");s.textContent=t.kind==="vocal"?`■ 歌 ${t.id}（${t.singer??"ritsu"}）`:t.kind==="inst"?`■ ${t.id}（${t.instrument??t.program??"ピアノ"}）`:`ドラム: ${t.pattern}`;legend.append(s);}
    (document.getElementById("undo") as HTMLButtonElement).disabled=!this.history.canUndo;(document.getElementById("redo") as HTMLButtonElement).disabled=!this.history.canRedo;
  }
}
