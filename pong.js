/* Madloop — the render screen. While an export runs, the preview becomes a game of Pong with the
   real progress bar underneath. Ported unchanged from Madblur (builds 222–243): the game runs in a
   Web Worker on its own clock so a busy export can't make it stutter, and when the render is done
   the Cancel button turns into a gold Download button. */
const $ = s=>document.querySelector(s);
function pongCore(){
  var PH=0.20;                                   // BOTH paddles — equal court, equal gear (build 243: Tim
                                                 // killed the handicaps; smaller = accuracy matters)
  var st={ py:.5, ay:.5, tgt:null, pv:0, bx:.5, by:.5, vx:.36, vy:.10, ps:0, as:0,
           volley:0, serveT:0, aiTgt:.5, think:0, fps:0, fA:0, fN:0 };
  function spd(){ return st.volley>=12 ? 1.45 : st.volley>=4 ? 1.22 : 1; }     // 4th/12th-volley steps
  function ang(){ return st.volley>=12 ? .38 : st.volley>=4 ? .32 : .26; }
  function serve(dir, now){ st.bx=.5; st.by=.5; st.volley=0; st.serveT=now+600;
    st.vx=.36*dir; st.vy=(Math.random()<.5?-1:1)*(.07+.09*Math.random()); st.think=0; st.aiTgt=.5; }
  function foldY(y){ var sp=0.96, m=(y-0.02)%(2*sp); if(m<0)m+=2*sp; return 0.02+(m<=sp?m:2*sp-m); }
  function step(dt, now, input){
    st.fA+=dt; st.fN++; if(st.fA>=0.5){ st.fps=Math.min(99,Math.round(st.fN/st.fA)); st.fA=0; st.fN=0; }
    var py0=st.py;
    if(input.py!=null) st.tgt=Math.max(PH/2, Math.min(1-PH/2, input.py));
    if(input.keyDir){ st.tgt=null; st.py=Math.max(PH/2, Math.min(1-PH/2, st.py+input.keyDir*1.1*dt)); }
    if(st.tgt!=null){ var d=st.tgt-st.py, mv=3.5*dt;
      st.py+=Math.abs(d)<=mv ? d : (d>0?mv:-mv); if(Math.abs(d)<=mv) st.tgt=null; }
    st.pv = dt>0 ? (st.pv*0.7 + ((st.py-py0)/dt)*0.3) : st.pv;   // smoothed paddle velocity (english)
    if(now<st.serveT) return;
    st.bx+=st.vx*spd()*dt; st.by+=st.vy*spd()*dt;
    if(st.by<0.02){ st.by=0.02; st.vy=Math.abs(st.vy); }
    if(st.by>0.98){ st.by=0.98; st.vy=-Math.abs(st.vy); }
    var hit=function(pyy){ var off=(st.by-pyy)/(PH/2); return Math.abs(off)<=1.15 ? Math.max(-1,Math.min(1,off)) : null; };
    if(st.bx<0.045 && st.vx<0){ var o1=hit(st.py);
      if(o1!=null){ st.bx=0.045; st.vx=Math.abs(st.vx); st.volley++;
        st.vy=Math.max(-.5,Math.min(.5, ang()*o1 + 0.22*st.pv));   // ENGLISH: a moving paddle steers the ball
        st.think=now+160; }                                        // the AI reads the new trajectory after human-ish reaction time
      else if(st.bx<-0.04){ st.as++; serve(-1, now); } }
    if(st.bx>0.955 && st.vx>0){ var o2=hit(st.ay);
      if(o2!=null){ st.bx=0.955; st.vx=-Math.abs(st.vx); st.volley++; st.vy=ang()*o2; st.think=0; st.aiTgt=.5; }
      else if(st.bx>1.04){ st.ps++; serve(1, now); } }
    // AI (build 243, contemporary design): same paddle, same court, full reach — no gimmicks.
    // Its skill knob is honest AIM ERROR: 160ms after each return it predicts where the ball
    // will cross its plane (wall bounces folded in) and commits to that spot plus a random
    // error that grows with ball speed. A quiet rubber band scales the error with the score
    // (worse when ahead, sharper when behind) so games stay close without visible cheating.
    if(st.vx>0){
      if(st.think===0) st.think=now+160;         // serve toward the AI — no hit seeded the read
      if(st.think>0 && now>=st.think){
        var tt=(0.955-st.bx)/(st.vx*spd());
        var pred=foldY(st.by+st.vy*spd()*tt);
        var stage=st.volley>=12?2:st.volley>=4?1:0;
        var sig=0.10+0.06*stage;
        var lead=st.as-st.ps;
        if(lead>=2) sig*=1.5; else if(lead<=-2) sig*=0.7;
        st.aiTgt=Math.max(PH/2, Math.min(1-PH/2, pred+(Math.random()*2-1)*sig));
        st.think=-1;                             // committed until the next return
      }
    }
    var vAI=(st.vx>0 ? 0.9 : 0.45)*dt, dy=st.aiTgt-st.ay;
    st.ay+=Math.max(-vAI, Math.min(vAI, dy));
    st.ay=Math.max(PH/2, Math.min(1-PH/2, st.ay));
  }
  // 7-segment block digits: segments a,b,c,d,e,f,g -> bitmask, drawn as rects
  var SEG=[0x77,0x24,0x5D,0x6D,0x2E,0x6B,0x7B,0x25,0x7F,0x6F];
  function digit(cx,x,y,w,h,t,n){
    var m=SEG[n%10];
    if(m&1)  cx.fillRect(x,y,w,t);                       // a top
    if(m&2)  cx.fillRect(x,y,t,h/2);                     // f top-left
    if(m&4)  cx.fillRect(x+w-t,y,t,h/2);                 // b top-right
    if(m&8)  cx.fillRect(x,y+h/2-t/2,w,t);               // g middle
    if(m&16) cx.fillRect(x,y+h/2,t,h/2);                 // e bottom-left
    if(m&32) cx.fillRect(x+w-t,y+h/2,t,h/2);             // c bottom-right
    if(m&64) cx.fillRect(x,y+h-t,w,t);                   // d bottom
  }
  function score(cx,val,cxx,y){ var sSt=String(val), dw=14, dh=24, sp=6;
    var x0=cxx-(sSt.length*dw+(sSt.length-1)*sp)/2;
    for(var i=0;i<sSt.length;i++) digit(cx, x0+i*(dw+sp), y, dw, dh, 4, +sSt[i]); }
  function draw(cx,W,H,now){
    cx.fillStyle='#181717'; cx.fillRect(0,0,W,H);
    cx.fillStyle='#3F3C3C';
    for(var y=6;y<H;y+=22) cx.fillRect(W/2-1, y, 2, 12);
    cx.fillStyle='#D8D8D8';
    score(cx, st.ps, W*0.40, 12); score(cx, st.as, W*0.60, 12);
    cx.fillRect(10, st.py*H-PH*H/2, 8, PH*H);
    cx.fillRect(W-18, st.ay*H-PH*H/2, 8, PH*H);
    if(now>=st.serveT || (Math.floor(now/150)%2)===0){
      cx.fillStyle='#E4CD5C'; cx.fillRect(st.bx*W-4, st.by*H-4, 8, 8);
    }
    // tiny dim fps meter, bottom-left — an honest diagnostic of what the game really achieves
    if(st.fps>0){ cx.fillStyle='#4A4640'; var fSt=String(st.fps);
      for(var k=0;k<fSt.length;k++) digit(cx, 10+k*10, H-20, 7, 12, 2, +fSt[k]); }
  }
  return { st:st, serve:serve, step:step, draw:draw };
}
const PONG = { on:false, raf:0, worker:null, workerUrl:null, core:null, cv:null,
               input:{ py:null, keyDir:0 }, last:0 };
function pongFreshCanvas(){
  // transferControlToOffscreen is one-way for a canvas element, so every session starts
  // with a brand-new <canvas> node (works for the fallback path too — cheap and simple).
  const old=$('#pongCv'); if(!old) return null;
  const cv=document.createElement('canvas');
  cv.id='pongCv'; cv.width=old.width; cv.height=old.height;
  old.replaceWith(cv); PONG.cv=cv; return cv;
}
function pongShow(label){
  const el=$('#pong'); if(!el) return;
  pongHide();                                        // clean slate (worker/raf/button state)
  PONG.on=true; PONG.input.py=null; PONG.input.keyDir=0;
  $('#pongLab').textContent=(label||'RENDERING')+'…'; $('#pongInfo').textContent=''; $('#pongFill').style.width='0%';
  const cb=$('#pongCancel');
  if(cb){ cb.textContent='CANCEL RENDER'; cb.classList.remove('dl'); cb.onclick=()=>{ if(typeof exportCancel==='function') exportCancel(); }; }
  el.classList.add('on');
  const cv=pongFreshCanvas(); if(!cv) return;
  let off=null;
  if(typeof OffscreenCanvas!=='undefined' && cv.transferControlToOffscreen && typeof Worker!=='undefined'){
    try{ off=cv.transferControlToOffscreen(); }catch(e){ off=null; }
  }
  if(off){
   try{
    // Worker source: the shared core + its own rAF loop + input mailbox. String-assembled
    // (no template literal), core injected via toString() — one physics source for both paths.
    const src='const core=('+pongCore.toString()+')();\n'+
      'let cv=null,ctx=null,last=0;const input={py:null,keyDir:0};\n'+
      'onmessage=(e)=>{const d=e.data;\n'+
      ' if(d.t==="cv"){cv=d.cv;ctx=cv.getContext("2d");last=performance.now();core.serve(Math.random()<.5?-1:1,last+300);requestAnimationFrame(tick);}\n'+
      ' else if(d.t==="py"){input.py=d.v;}\n'+
      ' else if(d.t==="key"){input.keyDir=d.v;}};\n'+
      'function tick(now){requestAnimationFrame(tick);\n'+
      ' let dt=Math.min((now-last)/1000,.05);last=now;\n'+
      ' core.step(dt,now,input);input.py=null;\n'+
      ' core.draw(ctx,cv.width,cv.height,now);}\n';
    PONG.workerUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
    PONG.worker=new Worker(PONG.workerUrl);
    PONG.worker.onerror=(e)=>{ console.warn('[Madloop pong] worker error — game falls back to the main thread', e);
      try{ PONG.worker.terminate(); }catch(_e){} PONG.worker=null;
      if(PONG.on){ pongFreshCanvas(); pongFallbackStart(); } };
    PONG.worker.postMessage({t:'cv', cv:off}, [off]);
   }catch(e){
    console.warn('[Madloop pong] worker setup failed — game falls back to the main thread', e);
    if(PONG.worker){ try{ PONG.worker.terminate(); }catch(_e){} PONG.worker=null; }
    if(PONG.workerUrl){ URL.revokeObjectURL(PONG.workerUrl); PONG.workerUrl=null; }
    off=null;   // canvas already transferred: rebuild a fresh one for the fallback
    pongFreshCanvas();
   }
  }
  if(!PONG.worker) pongFallbackStart();
}
function pongFallbackStart(){   // same core on the main-thread rAF (pre-240 behaviour, new rules)
  PONG.core=pongCore();
  PONG.last=performance.now();
  PONG.core.serve(Math.random()<.5?-1:1, PONG.last+300);
  cancelAnimationFrame(PONG.raf); PONG.raf=requestAnimationFrame(pongTick);
}
function pongHide(){
  PONG.on=false; cancelAnimationFrame(PONG.raf); PONG.core=null;
  if(PONG.worker){ try{ PONG.worker.terminate(); }catch(e){} PONG.worker=null; }
  if(PONG.workerUrl){ URL.revokeObjectURL(PONG.workerUrl); PONG.workerUrl=null; }
  const el=$('#pong'); if(el) el.classList.remove('on');
}
function pongProgress(i, N, info){
  if(!PONG.on) return;
  $('#pongFill').style.width=((i/N)*100).toFixed(1)+'%';
  $('#pongLab').textContent='FRAME '+String(i).padStart(String(N).length,'0')+' / '+N;
  if(info!=null) $('#pongInfo').textContent=info;
}
function pongTick(now){                                  // fallback path only
  if(!PONG.on || !PONG.core) return;
  PONG.raf=requestAnimationFrame(pongTick);
  let dt=Math.min((now-PONG.last)/1000, .05); PONG.last=now;
  PONG.core.step(dt, now, PONG.input); PONG.input.py=null;
  const cv=PONG.cv||$('#pongCv'); if(!cv) return;
  PONG.core.draw(cv.getContext('2d'), cv.width, cv.height, now);
}
// RENDER COMPLETE → the game keeps running and the cancel button becomes a gold DOWNLOAD
// button; resolves once the file has been handed to the browser. Hidden tab (or no overlay)
// = auto-download exactly as before, so unattended/background exports never hang.
function pongDeliver(blob, filename, doneLabel){
  const save=()=>{ const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 15000); };
  if(!PONG.on || document.hidden || !$('#pongCancel')){ save(); return Promise.resolve(); }
  return new Promise((resolve)=>{
    $('#pongFill').style.width='100%';
    $('#pongLab').textContent=doneLabel||'RENDER COMPLETE';
    $('#pongInfo').textContent=(blob.size/1048576).toFixed(1)+' MB — keep playing, download when ready';
    const cb=$('#pongCancel');
    cb.textContent='DOWNLOAD '+filename;
    cb.classList.add('dl');
    const fin=(doSave)=>{ if(doSave) save();
      resolve(); };
    cb.onclick=()=>fin(true);
  });
}
// input: mouse anywhere on the overlay steers the paddle; ↑/↓ swallowed while the game is up
(function pongInput(){
  const sendPy=(v)=>{ if(PONG.worker) PONG.worker.postMessage({t:'py', v}); else PONG.input.py=v; };
  const sendKey=(v)=>{ PONG.input.keyDir=v; if(PONG.worker) PONG.worker.postMessage({t:'key', v}); };
  document.addEventListener('pointermove',(e)=>{
    if(!PONG.on) return;
    const cv=PONG.cv||$('#pongCv'); if(!cv) return;
    const r=cv.getBoundingClientRect(); if(!r.height) return;
    sendPy((e.clientY-r.top)/r.height);
  });
  document.addEventListener('keydown',(e)=>{
    if(!PONG.on) return;
    if(e.key==='ArrowUp'){ sendKey(-1); e.preventDefault(); e.stopPropagation(); }
    else if(e.key==='ArrowDown'){ sendKey(1); e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('keyup',(e)=>{
    if(!PONG.on) return;
    if(e.key==='ArrowUp' && PONG.input.keyDir<0) sendKey(0);
    if(e.key==='ArrowDown' && PONG.input.keyDir>0) sendKey(0);
  }, true);
})();
