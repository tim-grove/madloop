'use strict';
/* Madloop — drop a clip, pick how it loops, trim, export.

   Everything runs on this computer. The clip is read where it sits on disk (nothing is copied
   into memory whole, nothing is uploaded) and the export is written out frame by frame.

   How the parts fit:
   · THE LOOP MATHS (Madblur's mediaClipTimes, build 441+): for any moment of the timeline, which
     moment of the clip shows, and for the dissolving methods which second moment blends in.
   · PREVIEW: two hidden <video> elements play the clip and a WebGL canvas blends them, steered
     the way Madblur's Media layer is (builds 443–444). Fast, never frame-exact, never exported.
   · EXPORT: Mediabunny reads the file and WebCodecs decodes the exact frames each output frame
     needs; the same shader blends them on the GPU; the encoder (or the PNG writer) takes the
     result straight away. Nothing holds the whole clip or the whole output.
   `$` comes from pong.js, which loads first. */

// The build number, ascending, as Madblur does it. Raise it on every build, together with the three
// ?v= tags in index.html (CLAUDE.md, "Releasing"), and add the build to CHANGELOG.md.
const BUILD = 3, BUILD_DATE = '2026-10-16';
// The About screen's links. An empty one shows greyed out until it is filled in.
const LINKS = {
  github:    '',                            // TODO (Tim): the Madloop repo, once created
  timX:      'https://x.com/_timgrove',
  timIG:     'https://www.instagram.com/tim_grove/',
  madblur:   'https://madblur.com',
  madblurX:  'https://x.com/madblur1',
  madblurIG: 'https://www.instagram.com/madblur1/',
};
const MB = window.Mediabunny;
const el = (tag,props,kids)=>{ const e=document.createElement(tag); Object.assign(e,props||{});
  (kids||[]).forEach(k=>e.appendChild(typeof k==='string'?document.createTextNode(k):k)); return e; };
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

/* ═════════════════════════════ STATE ═════════════════════════════
   The names follow Madblur's Media layer so the loop maths reads the same in both. */
const doc = { loopSeconds:30, fps:30 };
const P = { secIn:0, secOut:0, secAuto:1, loops:0, nlSpeed:100, nlFit:0, loopMode:3, ease:0, holdAt:0,
            pat:2, patDir:0, patShape:1, patCount:1, patRev:0, patSeed:1, patScale:100, patDetail:50, patSoft:35, xf:18 };
let clip = null;            // the imported clip: { blob, name, size, w, h, dur, t0, srcFps, codec, label, rotation }
let tNow = 0, playing = false;   // the playhead waits for Play (Tim)
let _exporting = false, _exportCancel = false;
function exportCancel(){ _exportCancel = true; }   // pong.js calls this from its Cancel button

/* ═════════════════════════════ THE LOOP MATHS ═════════════════════════════
   From Madblur (madblur_458, mediaSection / mediaClipTimes / mediaLoopInfo), unchanged apart from
   reading the clip and the timeline from Madloop's state. tL = how far through the timeline, 0..1.
   · SECTION: the part of the clip in use, [a, a+D]. secAuto = the whole clip, or for a clip too
     long to play once at true speed, the first stretch that can. Dragging the strip writes
     secIn / secOut and clears secAuto.
   · No loop (0): plays at nlSpeed, or fitted to nlFit whole plays.
   · Bounce (2): Loops (0 = automatic) and Easing at the turns.
   · Crossfade (3): length = the share of each play spent blending. At 100% two copies, half a
     clip apart, are always dissolving.
   · Hold frame (4): a still, Hold at % into the section. (Not offered in Madloop.)
   · Patterned dissolve (5): Crossfade's timing; the shader switches a region at a time.
   Returns clip seconds tA / tB, the blend weight w, and r = how far through the blend (0..1). */
const MEDIA_SEC_MIN = 0.1;
function mediaLoopK(P){ const m=P.loopMode|0;      // clip seconds used per loop, as a share of the section
  return m===2 ? 2 : (m===3||m===5) ? 1/(1+Math.min(1,Math.max(0.02,(P.xf==null?18:P.xf)/100))) : 1; }
function mediaSection(P, src){
  const dur = src.dur>0 ? src.dur : 1;
  if(P.secAuto>0.5){ const m=P.loopMode|0, cap = m===4 ? dur : (doc.loopSeconds||30)/mediaLoopK(P);
    return { a:0, D:Math.max(Math.min(MEDIA_SEC_MIN,dur), Math.min(dur, cap)), dur }; }
  const a = Math.min(Math.max(0, P.secIn||0), Math.max(0,dur-MEDIA_SEC_MIN));
  const b = (P.secOut>0) ? Math.min(dur, P.secOut) : dur;
  return { a, D: Math.max(Math.min(MEDIA_SEC_MIN,dur), b-a), dur };
}
function mediaClipTimes(P, src, tL){
  const sc = mediaSection(P, src), a = sc.a, D = sc.D, T = doc.loopSeconds||30, mode = P.loopMode|0, EPS = 1e-4;
  if(mode===4) return { tA: a+Math.min(D-EPS, Math.max(0,(P.holdAt==null?0:P.holdAt))/100*D), tB:0, w:0, r:0 };
  if(mode===1){ const n=Math.max(1,Math.round(T/D)); return { tA: a+((tL*n)%1)*D, tB:0, w:0, r:0 }; }
  if(mode===2){ const k=(P.loops>0) ? Math.round(P.loops) : Math.max(1,Math.round(T/(2*D))); const ph=(tL*k)%1;
    let tri = ph<0.5 ? 2*ph : 2-2*ph;
    if(P.ease>0){ const e=Math.min(1,P.ease/100); tri = tri + (tri*tri*(3-2*tri) - tri)*e; }   // slow into each turn
    return { tA: a+Math.min(D-EPS, tri*D), tB:0, w:0, r:0 }; }
  if(mode===3 || mode===5){
    const f = Math.min(1, Math.max(0.02, (P.xf==null?18:P.xf)/100)), X = f*D/(1+f);
    const Per = D - X, n = (P.loops>0) ? Math.round(P.loops) : Math.max(1, Math.round(T/Per)), u = ((tL*n)%1)*Per;
    // shown range is clip [X, D); in the last X of each period the tail blends into the head
    if(u >= Per-X){ const r=Math.min(1,Math.max(0,(u-(Per-X))/X)), w=r*r*(3-2*r);   // smoothstep dissolve
      return { tA: a+Math.min(D-EPS,u+X), tB: a+u-Per+X, w, r }; }
    return { tA: a+u+X, tB:0, w:0, r:0 };
  }
  if(P.nlFit>0){ const n=Math.round(P.nlFit); return { tA: a+Math.min(D-EPS,((tL*n)%1)*D), tB:0, w:0, r:0 }; }   // No loop, fitted to whole plays
  const sp = (P.nlSpeed>0 ? P.nlSpeed : 100)/100;
  return { tA: a+(((tL*T*sp)%D)+D)%D, tB:0, w:0, r:0 };   // No loop at a free speed
}
// What the panel shows: the section, the loop count and the speed the clip ends up playing at.
function mediaLoopInfo(){
  const src=clip, T=doc.loopSeconds||30, sc=mediaSection(P,src), D=sc.D, m=P.loopMode|0, o={ a:sc.a, D, dur:sc.dur, mode:m, n:null, auto:null, speed:null, free:false };
  if(m===4) return o;
  if(m===0){ o.free=true; if(P.nlFit>0){ o.n=Math.round(P.nlFit); o.speed=o.n*D/T; } else { o.speed=(P.nlSpeed>0?P.nlSpeed:100)/100; o.n=T*o.speed/D; } }
  else if(m===1){ o.free=true; o.n=Math.max(1,Math.round(T/D)); o.speed=o.n*D/T; }
  else { const k=mediaLoopK(P); o.auto=Math.max(1,Math.round(T/(k*D))); o.n=(P.loops>0)?Math.round(P.loops):o.auto; o.speed=o.n*k*D/T; }
  return o;
}
// Patterned dissolve: the largest value the shape measure reaches in one cell, so the last
// corner switches exactly as the dissolve ends.
function mediaPatNorm(shape, count, A){
  const cw=A/Math.max(1,count), rows=Math.max(1,Math.floor(1/cw+0.5)), ch=1/rows, x=cw/2, y=ch/2;
  if(shape===0) return 1; if(shape===1) return Math.hypot(x,y); if(shape===2) return Math.max(x,y); if(shape===3) return x+y;
  if(shape===5) return Math.max(Math.max(x,y), Math.min(x,y)/0.3);
  const al=Math.PI/5, f=(dx,dy)=>{ const th=Math.atan2(dx,dy), ph=Math.abs((((th%(2*al))+2*al)%(2*al))-al);
    return Math.hypot(dx,dy)*(Math.sin(al-ph)+0.42*Math.sin(ph))/(0.42*Math.sin(al)); };
  let mx=0; for(let i=0;i<=64;i++){ const u=i/64*2-1; mx=Math.max(mx,f(u*x,y),f(u*x,-y),f(x,u*y),f(-x,u*y)); }
  return mx;
}
function frameCount(){ return Math.max(1, Math.round(doc.loopSeconds*doc.fps)); }

/* ═════════════════════════════ THE BLEND (WebGL2) ═════════════════════════════
   One shader, used by the preview and by every export: the clip's frame, and in a dissolve a
   second frame mixed over it, either evenly (Crossfade) or a region at a time (Patterned
   dissolve, Madblur's mbPatLate unchanged). The dissolve is mixed in linear light, as Madblur
   composites, then written back out as sRGB. */
const VERT = `#version 300 es
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uImg;
uniform sampler2D uImg2;
uniform float uXf;         // dissolve weight, 0 outside the crossfade window
uniform int uPat;          // 0 plain crossfade - 1 Sweep - 2 Centre out - 3 Clouds
uniform float uPatR;       // how far through the dissolve, 0..1
uniform float uPatSoft;    // softness of the pattern's edge
uniform vec4 uPatA;        // sweep: direction. shapes: shape, count, inwards, normaliser
uniform vec4 uPatB;        // clouds: seed, scale, detail
uniform float uAspect;
vec3 s2l(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
// Patterned dissolve: how late this spot of the frame switches to the new copy, 0 first, 1 last.
float mbPatHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)) + uPatB.x*17.13)*43758.5453); }
float mbPatNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mbPatHash(i),mbPatHash(i+vec2(1.0,0.0)),f.x), mix(mbPatHash(i+vec2(0.0,1.0)),mbPatHash(i+vec2(1.0,1.0)),f.x), f.y); }
float mbPatLate(vec2 uv){
  if(uPat==1){ int dr=int(uPatA.x+0.5); return clamp(dr==0 ? uv.x : (dr==1 ? 1.0-uv.x : (dr==2 ? 1.0-uv.y : uv.y)), 0.0, 1.0); }
  vec2 p = vec2(uv.x*uAspect, uv.y);
  if(uPat==2){
    float cw = uAspect/max(1.0,uPatA.y), rows = max(1.0, floor(1.0/cw+0.5)), ch = 1.0/rows;
    vec2 d = mod(p, vec2(cw,ch)) - 0.5*vec2(cw,ch);
    vec2 a = abs(d); int sh = int(uPatA.x+0.5); float m;
    if(sh==0) m = max(a.x/(0.5*cw), a.y/(0.5*ch));
    else if(sh==1) m = length(d);
    else if(sh==2) m = max(a.x,a.y);
    else if(sh==3) m = a.x+a.y;
    else if(sh==4){ float al=0.62831853; float ph=abs(mod(atan(d.x,d.y),2.0*al)-al);
      m = length(d)*(sin(al-ph)+0.42*sin(ph))/(0.42*sin(al)); }
    else m = max(max(a.x,a.y), min(a.x,a.y)/0.3);
    float late = clamp(m/max(uPatA.w,0.00001), 0.0, 1.0);
    return uPatA.z>0.5 ? 1.0-late : late;
  }
  float fr = 2.4/max(0.05,uPatB.y), g = uPatB.z*0.8, sum=0.0, amp=1.0, tot=0.0;
  for(int k=0;k<5;k++){ sum += amp*mbPatNoise(p*fr + float(k)*vec2(19.7,7.3)); tot += amp; amp *= g; fr *= 2.0; }
  return clamp((sum/tot - 0.5)/(2.0*mix(0.34,0.2,uPatB.z)) + 0.5, 0.0, 1.0);
}
void main(){
  vec4 t = texture(uImg, vUv);
  if(uXf>0.0){                                         // crossfade loop: tail dissolves into head
    float wx = uXf;
    if(uPat>0){ float sf=clamp(uPatSoft,0.03,1.0); float e=clamp((uPatR*(1.0+sf)-mbPatLate(vUv))/sf,0.0,1.0); wx=e*e*(3.0-2.0*e); }   // ...a region at a time
    t.rgb = l2s(mix(s2l(t.rgb), s2l(texture(uImg2, vUv).rgb), wx));
  }
  o = vec4(t.rgb, 1.0);
}`;
function makeRenderer(canvas, keep){
  const gl = canvas.getContext('webgl2', { alpha:false, antialias:false, premultipliedAlpha:false, preserveDrawingBuffer:!!keep });
  if(!gl) throw new Error('this browser has no WebGL2');
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog=gl.createProgram(); gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));
  gl.linkProgram(prog); if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U={}; const u=n=>(n in U) ? U[n] : (U[n]=gl.getUniformLocation(prog,n));
  const vao=gl.createVertexArray(); let flat=null;
  const newTex=()=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
    for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D,k,v);
    return t; };
  return {
    gl, canvas, newTex,
    // A <video>, a canvas or a VideoFrame. With flatW / flatH the picture is first drawn into a 2D
    // canvas of that size: for HDR clips, the GPU upload maps the colours differently from the
    // browser's own player (lighter, greyer), while a 2D canvas maps them exactly as it does.
    // noFlip: the picture is already upside down for the GPU (the Bounce buffer's frames).
    upload(tex, src, flatW, flatH, noFlip){
      if(flatW){ if(!flat || flat.width!==flatW || flat.height!==flatH){ flat=new OffscreenCanvas(flatW, flatH); flat.ctx=flat.getContext('2d'); }
        flat.ctx.drawImage(src, 0, 0, flatW, flatH); src=flat; }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !noFlip);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    },
    draw(texA, texB, xf, xr){
      const W=canvas.width, H=canvas.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,W,H);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA); gl.uniform1i(u('uImg'),0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, (xf>0 && texB) ? texB : texA); gl.uniform1i(u('uImg2'),1);
      gl.uniform1f(u('uXf'), xf>0 && texB ? xf : 0);
      gl.uniform1f(u('uAspect'), W/H);
      const pat = (xf>0 && (P.loopMode|0)===5) ? (P.pat|0)+1 : 0;
      gl.uniform1i(u('uPat'), pat);
      gl.uniform1f(u('uPatR'), xr||0);
      gl.uniform1f(u('uPatSoft'), Math.min(1,Math.max(0.03,(P.patSoft==null?35:P.patSoft)/100)));
      if(pat===1) gl.uniform4f(u('uPatA'), P.patDir|0, 0, 0, 1);
      else if(pat===2){ const cnt=Math.max(1,Math.round(P.patCount||1));
        gl.uniform4f(u('uPatA'), P.patShape|0, cnt, (P.patRev|0)?1:0, mediaPatNorm(P.patShape|0, cnt, W/H)); }
      else gl.uniform4f(u('uPatA'), 0, 0, 0, 1);
      gl.uniform4f(u('uPatB'), P.patSeed||1, Math.max(0.2,(P.patScale==null?100:P.patScale)/100), Math.min(1,Math.max(0,(P.patDetail==null?50:P.patDetail)/100)), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLES,0,3);
    },
    destroy(){ try{ const x=gl.getExtension('WEBGL_lose_context'); if(x) x.loseContext(); }catch(e){} }
  };
}

/* ═════════════════════════════ PREVIEW ═════════════════════════════
   Madblur's clip engine for the Media layer (builds 443–444), for one clip:
   · two hidden <video> elements, A on screen and B the dissolve partner;
   · while the timeline PLAYS, each video plays at the speed the loop needs and is steered, not
     jumped: a small drift nudges its playback rate, only a real discontinuity is a jump;
   · paused (scrubbing, stepping), Hold frame and the backward half of Bounce are shown by jumps,
     because a video element can't play backwards;
   · at a cut or a join the two copies change places instead of jumping (no flash at the join). */
const view = { cv:null, R:null, texA:null, texB:null };
const A = {};   // the playing copies: el / elB, upT / upTB, seeking / seekingB, jumpMs, url
let _mediaLive = false, _dirty = true;
function invalidate(){ _dirty = true; }

function animReset(){
  for(const v of [A.el, A.elB]) if(v){ try{ v.pause(); v.removeAttribute('src'); v.load(); }catch(e){} }
  for(const k of Object.keys(A)) delete A[k];
}
function animStart(url){
  animReset();
  A.url = url; A.ready = false;
  const v = el('video',{muted:true, playsInline:true, preload:'auto'});
  v.addEventListener('loadeddata', ()=>{ A.el = v; upload('A', v); A.upT = v.currentTime; A.ready = true; invalidate(); }, {once:true});
  v.addEventListener('error', ()=>{ animStuck(v); }, {once:true});
  v.src = url;
}
function animStuck(v){
  if(A.stuck) return; A.stuck = true; A.seeking = false; A.seekingB = false;
  const er = v && v.error; console.warn('[Madloop] the preview stopped decoding'+(er && er.message ? ': '+er.message : ''));
  toast('The preview stopped playing this clip. Exports read the file separately and may still work.');
}
function animSwap(){
  let t;
  t=view.texA; view.texA=view.texB; view.texB=t;   t=A.el; A.el=A.elB; A.elB=t;
  t=A.upT; A.upT=A.upTB; A.upTB=t;                 t=A.seeking; A.seeking=A.seekingB; A.seekingB=t;
  A.swapN=(A.swapN|0)+1;
}
function animPair(ct){                              // should the two copies change places?
  const w=ct.w||0; if(!A.el || !A.elB || A.upTB==null) return;
  const hA=A.upT||0, hB=A.upTB;
  const keep=(1-w)*Math.abs(hA-ct.tA) + w*Math.abs(hB-ct.tB), swap=(1-w)*Math.abs(hB-ct.tA) + w*Math.abs(hA-ct.tB);
  if(swap < 0.5*keep - 0.03) animSwap();              // only for a clear gain, so two near-equal copies never trade back and forth
}
function upload(slot, v){ const hdr=clip && clip.hdr; view.R.upload(slot==='B' ? view.texB : view.texA, v, hdr ? view.cv.width : 0, hdr ? view.cv.height : 0); }
function animEnsureElB(){
  if(A.elB || A.elBWait || !A.url) return;
  A.elBWait = true;
  const v = el('video',{muted:true, playsInline:true, preload:'auto'});
  v.addEventListener('error', ()=>{ A.elBWait = false; if(A.el===v || A.elB===v) animStuck(v); }, {once:true});
  v.addEventListener('loadeddata', ()=>{ A.elB = v; A.elBWait = false; upload('B', v); A.upTB = v.currentTime; invalidate(); }, {once:true});
  v.src = A.url;
}
function animJump(v, secs){                          // one jump; its picture goes to whichever copy the element is when it lands
  const flag = A.elB===v ? 'seekingB' : 'seeking', t0 = performance.now();
  A[flag] = true;
  const done = ()=>{ const b = A.elB===v; if(!b && A.el!==v) return;
    upload(b ? 'B' : 'A', v);
    A.jumpMs = 0.6*(A.jumpMs||120) + 0.4*Math.min(1500, performance.now()-t0);
    A[b ? 'upTB' : 'upT'] = v.currentTime; A[b ? 'seekingB' : 'seeking'] = false; v._mbNew = false; invalidate(); };
  v.addEventListener('seeked', done, {once:true});
  try{ v.currentTime = secs; }catch(e){ A[flag] = false; }
}
function animNudge(secs, slot){
  const v = slot==='B' ? A.elB : A.el; if(!v) return;
  const up = slot==='B' ? 'upTB' : 'upT', flag = slot==='B' ? 'seekingB' : 'seeking';
  if(A[flag] || Math.abs((A[up]||0) - secs) <= 0.02) return;
  animJump(v, secs);
}
let _animWatchT = 0;
function animWatch(){                               // a clip nobody is drawing any more stops playing
  if(_animWatchT) return;
  _animWatchT = setInterval(()=>{ const now=performance.now(); let any=false;
    for(const v of [A.el, A.elB]){ if(!v || v.paused) continue;
      if(now-(v._mbT||0) > 600){ try{ v.pause(); }catch(e){} } else any=true; }
    if(!any){ clearInterval(_animWatchT); _animWatchT=0; } }, 700);
}
function animFrames(v){                             // note each new picture a playing clip puts up
  if(v._mbRv || !v.requestVideoFrameCallback) return;
  v._mbRv = true;
  const cb = ()=>{ v._mbNew = true;
    if(!v.paused && (A.el===v || A.elB===v)) v.requestVideoFrameCallback(cb); else v._mbRv = false; };
  v.requestVideoFrameCallback(cb);
}
function animDrive(secs, slot, rate){                // rate = clip seconds per second of timeline; 0 = hold still
  const v = slot==='B' ? A.elB : A.el; if(!v) return;
  const up = slot==='B' ? 'upTB' : 'upT', flag = slot==='B' ? 'seekingB' : 'seeking';
  v._mbT = performance.now();
  if(!(_mediaLive && playing && rate>=0.07 && rate<=8)){  // exact frames by jumps
    if(!v.paused){ try{ v.pause(); }catch(e){} }
    animNudge(secs, slot); return; }
  if(A[flag]) return;                                // a jump is on its way; the clip carries on playing when it lands
  const err = v.currentTime - secs;                  // + = the clip is ahead of the timeline
  if(Math.abs(err) > Math.max(0.3, 0.3*rate) || v.ended){
    const lead = rate*Math.min(1, (A.jumpMs||120)/1000), end = Math.max(0, (clip.dur||secs+lead)-0.05);
    animJump(v, Math.min(end, secs+lead)); return; }
  if(v.paused){ v.playbackRate = rate; const pr = v.play(); if(pr && pr.catch) pr.catch(()=>{}); animWatch(); }
  else { const want = rate*(1 - Math.max(-0.25, Math.min(0.25, err*0.8)));
    if(Math.abs(v.playbackRate-want) > 0.02*rate) v.playbackRate = want; }
  animFrames(v);
  if((v._mbNew || !v.requestVideoFrameCallback) && v.readyState>=2){ v._mbNew = false;
    upload(slot, v); A[up] = v.currentTime; }
}
/* Madloop (Tim: "bounce mode slows down massively when running backwards"). A video element can't
   play backwards, so the backward half of Bounce used to be one jump per frame, and every jump
   decodes forward from the keyframe before it: on a 4K phone clip, a few pictures a second.
   Now, while Bounce plays, the stretch of the clip just ahead of the playhead going backwards
   (and, while it goes forwards, the stretch under the top turn) is decoded in the background a
   second at a time at preview size and kept as pictures. The backward half plays from these;
   the forward half still plays the video element, which waits, paused, at the start of the
   section for the next turn. The pictures are drawn by Mediabunny into a 2D canvas, so a turned
   phone clip comes out the right way up and HDR colours match the player. */
const RC = { gen:0, frames:[], busy:false, key:'', need:null, input:null, sink:null };
function rcReset(){
  RC.gen++; RC.busy=false; RC.key=''; RC.need=null;
  for(const f of RC.frames) try{ f.bmp.close(); }catch(e){}
  RC.frames=[];
  if(RC.input) try{ RC.input.dispose(); }catch(e){}
  RC.input=null; RC.sink=null;
}
function rcAt(t){                                    // the picture showing at clip time t, as the video would
  const fr=RC.frames, dt=1/(clip.srcFps||30); let lo=0, hi=fr.length-1, best=null;
  while(lo<=hi){ const mid=(lo+hi)>>1; if(fr[mid].t <= t+1e-4){ best=fr[mid]; lo=mid+1; } else hi=mid-1; }
  return best && t-best.t < 1.5*dt ? best : null;
}
function rcWant(t, rate){
  const sc=mediaSection(P,clip), w=Math.max(2,Math.min(1280, view.cv.width)), h=Math.max(2,Math.round(w*clip.h/clip.w));
  const key=clip.url+'|'+sc.a.toFixed(3)+'|'+sc.D.toFixed(3)+'|'+w+'x'+h;
  if(key!==RC.key){ rcReset(); RC.key=key; }
  const back=rate<0.07, L=clamp(Math.abs(rate)*1.2, 1, 3), top=sc.a+sc.D;
  RC.need={ t, a:sc.a, top, w, h, g1: back ? Math.min(t, top) : top, L: back ? L : 1 };
  // keep what's around the playhead and what's under the top turn; let the rest go
  const keep=f=>(f.t>=t-L-0.3 && f.t<=t+0.3) || f.t>=top-1.1;
  if(RC.frames.some(f=>!keep(f))){ RC.frames=RC.frames.filter(f=>{ if(keep(f)) return true; try{ f.bmp.close(); }catch(e){} return false; }); }
  if(!RC.busy) rcPump();
}
async function rcPump(){
  const g=RC.gen; RC.busy=true;
  try{
    if(!RC.sink){ const inp=openInput(clip.blob), tr=await inp.getPrimaryVideoTrack();
      if(g!==RC.gen){ try{ inp.dispose(); }catch(e){} return; }
      RC.input=inp; RC.sink=new MB.VideoSampleSink(tr); }
    const dt=1/(clip.srcFps||30);
    for(;;){
      if(g!==RC.gen) return;
      const n=RC.need, g0=Math.max(n.a, n.g1-n.L);
      let gap=null; for(let x=n.g1; x>=g0-1e-9; x-=dt){ if(!rcAt(x)){ gap=x; break; } }
      if(gap==null) return;                          // covered: the next frame's want() starts it again
      const lo=Math.max(n.a, gap-1), oc=new OffscreenCanvas(n.w, n.h), ctx=oc.getContext('2d');
      for await (const smp of RC.sink.samples(clip.t0+lo, clip.t0+gap+dt)){
        const t=smp.timestamp-clip.t0;
        if(g===RC.gen && !RC.frames.some(f=>Math.abs(f.t-t)<1e-4)){
          ctx.setTransform(1,0,0,-1,0,n.h);          // upside down, as the GPU wants it
          smp.draw(ctx, 0, 0, n.w, n.h);
          const f={ t, bmp:oc.transferToImageBitmap() };
          let i=RC.frames.length; while(i>0 && RC.frames[i-1].t>t) i--;
          RC.frames.splice(i, 0, f);
        }
        smp.close();
        if(g!==RC.gen) break;
      }
    }
  }catch(e){ console.warn('[Madloop] Bounce buffer', e); }
  finally{ if(g===RC.gen) RC.busy=false; }
}
function parkA(a){                                    // the video waits at the start of the section for the turn
  const v=A.el; if(!v) return;
  v._mbT=performance.now();
  if(!v.paused){ try{ v.pause(); }catch(e){} }
  if(!A.seeking && Math.abs(v.currentTime-a)>0.05){ try{ v.currentTime=a; }catch(e){} A.upT=a; }
}
// The preview's picture for timeline position tL: steer the copies, return the blend to draw.
function previewTimes(tL){
  if(!A.ready || A.stuck) return { xf:0, xr:0 };
  const ct = mediaClipTimes(P, clip, tL);
  const m = P.loopMode|0, live = _mediaLive && playing;
  const pair = m===3 || m===5 || (live && (m===0 || m===1));   // while playing, the methods that cut keep a spare copy too
  if(pair){ animEnsureElB(); animPair(ct); }
  const rest = (pair && !(ct.w>0)) ? mediaSection(P, clip).a : null;   // between dissolves the incoming copy waits where the next one starts
  let rate = 0;
  if(live){ const dL = 1/(60*(doc.loopSeconds||30)), w1 = x=>((x%1)+1)%1;
    const f = (mediaClipTimes(P, clip, w1(tL+dL)).tA - ct.tA)*60, b = (ct.tA - mediaClipTimes(P, clip, w1(tL-dL)).tA)*60;
    rate = Math.abs(f)<Math.abs(b) ? f : b; }       // the calmer of the two sides, so a cut does not read as a speed
  if(m===2 && live){                                 // Bounce, playing: the backward half from the buffer
    rcWant(ct.tA, rate);
    const f = rate<0.07 ? rcAt(ct.tA) : null;
    if(f){ view.R.upload(view.texA, f.bmp, 0, 0, true); parkA(mediaSection(P, clip).a); return { xf:0, xr:0 }; }
  } else if(RC.frames.length && m!==2) rcReset();
  animDrive(ct.tA, 'A', rate);
  if(ct.w>0) animDrive(ct.tB, 'B', rate); else if(rest!=null) animDrive(rest, 'B', 0);
  return { xf: (ct.w>0 && A.elB) ? ct.w : 0, xr: ct.r||0 };
}
function present(){
  if(!clip || !view.R) return;
  layoutView();
  _mediaLive = true;
  const b = previewTimes(tNow);
  _mediaLive = false;
  view.R.draw(view.texA, view.texB, b.xf, b.xr);
}

/* The preview canvas: the clip's shape, fitted to the stage (Zoom), drawn at the screen's
   resolution or the clip's, whichever is smaller (Quality scales that down). */
let _zoom = 'fit', _quality = 1;
function layoutView(){
  if(!clip) return;
  const box = $('#view'), cv = view.cv; if(!box) return;
  const bw = box.clientWidth-36, bh = box.clientHeight-36, dpr = window.devicePixelRatio||1;
  let cw, ch;
  if(_zoom==='fit'){ const s=Math.min(bw/clip.w, bh/clip.h); cw=clip.w*s; ch=clip.h*s; }
  else { cw=clip.w*(+_zoom)/dpr; ch=clip.h*(+_zoom)/dpr; }
  cw=Math.max(16,Math.round(cw)); ch=Math.max(16,Math.round(ch));
  if(cv.style.width!==cw+'px'){ cv.style.width=cw+'px'; cv.style.height=ch+'px'; }
  const s = Math.min(1, (cw*dpr)/clip.w) * _quality;
  const pw = Math.max(16, Math.round(clip.w*s)), ph = Math.max(16, Math.round(clip.h*s));
  if(cv.width!==pw || cv.height!==ph){ cv.width=pw; cv.height=ph; }
}

/* ═════════════════════════════ READING CLIPS ═════════════════════════════ */
/* Madblur build 442 (Tim: "video isn't playing back on the canvas"). Some iPhone HEVC clips use
   open keyframes (CRA) and mark the picture after each one as decodable from that keyframe
   alone (RADL) when it in fact leans on the pictures before it. The decoder is handed that
   picture after a jump, fails, and the whole video dies. The fix relabels those pictures as the
   other leading kind (RASL), which is what they really are: one byte each, in the copy handed
   to the decoders, never in the user's file. Played straight through they decode exactly as
   before; after a jump they are skipped, as the format intends.
   Madblur scans the whole file in memory. Madloop reads the sample table, then the sample
   bytes in large slices, so a clip of any size is fine. Returns [position, new byte, …] or null. */
async function hevcLeadFix(file, onProgress){
  try{
    const N=file.size, rd=async(pos,len)=>new Uint8Array(await file.slice(pos,pos+len).arrayBuffer());
    // the top-level boxes, to find moov without reading the media
    let pos=0, moovAt=-1, moovSize=0;
    while(pos+8<=N){
      const h=await rd(pos,16), dv=new DataView(h.buffer); let n=dv.getUint32(0); const t=String.fromCharCode(h[4],h[5],h[6],h[7]);
      if(n===1) n=dv.getUint32(8)*4294967296+dv.getUint32(12); else if(n===0) n=N-pos;
      if(n<8) return null;
      if(t==='moov'){ moovAt=pos; moovSize=n; break; }
      pos+=n;
    }
    if(moovAt<0 || moovSize>256*1048576) return null;
    const u8=await rd(moovAt, moovSize), M=u8.length, dv=new DataView(u8.buffer);
    const u32=p=>dv.getUint32(p), tag=p=>String.fromCharCode(u8[p],u8[p+1],u8[p+2],u8[p+3]);
    const kids=(s,e)=>{ const o=[];
      while(s+8<=e){ let n=u32(s), h=8; const t=tag(s+4);
        if(n===1){ if(s+16>e) break; n=u32(s+8)*4294967296+u32(s+12); h=16; } else if(n===0) n=e-s;
        if(n<h || s+n>e) break;
        o.push([t,s+h,s+n]); s+=n; }
      return o; };
    const one=(k,t)=>k ? kids(k[1],k[2]).find(x=>x[0]===t) : null;
    const moov=[ 'moov', 8, M ];
    const samples=[]; let ls=4;
    for(const tr of kids(moov[1],moov[2])){
      if(tr[0]!=='trak') continue;
      const mdia=one(tr,'mdia'), hd=one(mdia,'hdlr'); if(!hd || tag(hd[1]+8)!=='vide') continue;
      const stbl=one(one(mdia,'minf'),'stbl'); if(!stbl) continue;
      const T={}; for(const k of kids(stbl[1],stbl[2])) T[k[0]]=k;
      const sd=T.stsd, sz=T.stsz, co=T.stco||T.co64, sc=T.stsc; if(!sd || !sz || !co || !sc) continue;
      if(!/^(hvc1|hev1|dvh1|dvhe)$/.test(tag(sd[1]+12))) continue;
      const cfg=kids(sd[1]+8+86, Math.min(sd[2], sd[1]+8+u32(sd[1]+8))).find(x=>x[0]==='hvcC');
      if(cfg && cfg[2]-cfg[1]>22) ls=(u8[cfg[1]+21]&3)+1;   // bytes in each picture-unit length
      const fixed=u32(sz[1]+4), n=u32(sz[1]+8), nc=u32(co[1]+4), wide=co[0]==='co64', ne=u32(sc[1]+4);
      let si=0, e=0, per=0;
      for(let c=0; c<nc && si<n; c++){
        while(e<ne && u32(sc[1]+8+12*e)<=c+1){ per=u32(sc[1]+12+12*e); e++; }
        let o = wide ? u32(co[1]+8+8*c)*4294967296+u32(co[1]+12+8*c) : u32(co[1]+8+4*c);
        for(let k=0; k<per && si<n; k++, si++){ const s=fixed || u32(sz[1]+12+4*si); samples.push(o, s); o+=s; }
      }
      break;   // the first video track is the one we play
    }
    if(!samples.length) return null;
    // walk the pictures in file order, reading 32 MB at a time
    const fixes=[]; let irap=0, wAt=-1, win=null;
    const W=32*1048576;
    for(let i=0;i<samples.length;i+=2){
      const o=samples[i], end=o+samples[i+1]; if(end>N) return null;
      if(!win || o<wAt || end>wAt+win.length){ wAt=o; win=await rd(o, Math.max(W, end-o)); if(onProgress) onProgress(o/N); }
      let q=o;
      while(q+ls<end){ let nl=0; for(let j=0;j<ls;j++) nl=nl*256+win[q-wAt+j];
        const h=q+ls; if(nl<2 || h+nl>end) break;
        const b=win[h-wAt], t=(b>>1)&63;
        if(t>=16 && t<=23) irap=t;                                             // a keyframe: remember which kind
        else if((t===6 || t===7) && irap===21) fixes.push(h, (b&0x81)|((t+2)<<1));
        q=h+nl; }
    }
    return fixes.length ? fixes : null;
  }catch(e){ console.warn('[Madloop] HEVC check skipped', e); return null; }
}
// The bytes every reader is given: the user's file, with the relabelling above where needed.
// Built from slices of the file, so it stays on disk; the user's file is never written.
function patchedBlob(file, fx){
  if(!fx) return file;
  const parts=[]; let last=0;
  for(let i=0;i<fx.length;i+=2){ parts.push(file.slice(last,fx[i]), new Uint8Array([fx[i+1]])); last=fx[i]+1; }
  parts.push(file.slice(last)); return new Blob(parts, {type:file.type||'video/mp4'});
}
function openInput(blob){ return new MB.Input({ source:new MB.BlobSource(blob), formats:MB.ALL_FORMATS }); }

const CODEC_NAMES = { avc:'H.264', hevc:'H.265 / HEVC', vp9:'VP9', av1:'AV1', vp8:'VP8', prores:'ProRes' };
async function importFile(file){
  if(!file) return;
  if(_exporting){ toast('Wait for the export to finish first.'); return; }
  const name = String(file.name||'clip').slice(0,120);
  const box = $('#mfprev');
  box.className='mfprev empty'; box.textContent='Reading '+name+'…';
  let input=null;
  try{
    input = openInput(file);
    const track = await input.getPrimaryVideoTrack().catch(()=>null);
    if(!track) throw new Error('Madloop couldn’t find a video in that file. Try an MP4, MOV or WebM clip.');
    const codec = track.codec;
    if(!(await track.canDecode().catch(()=>false)))
      throw new Error('This browser can’t decode '+(CODEC_NAMES[codec]||'this kind of')+' video'+(codec==='prores'?'. ProRes plays in Safari on a Mac at best; try converting the clip to H.264 or H.265.':'. Try the clip in Chrome, or convert it to H.264.'));
    const t0 = await track.getFirstTimestamp(), tEnd = await track.computeDuration();
    const dur = Math.max(0.05, tEnd - t0);
    const stats = await track.computePacketStats(240).catch(()=>null);
    const srcFps = stats && stats.averagePacketRate>0 ? stats.averagePacketRate : 30;
    const w = await track.getDisplayWidth(), h = await track.getDisplayHeight(), rotation = await track.getRotation();
    const hdr = await track.hasHighDynamicRange().catch(()=>false);
    let blob = file;
    if(codec==='hevc'){
      box.textContent='Checking '+name+'…';
      const fx = await hevcLeadFix(file, f=>{ box.textContent='Checking '+name+'… '+Math.round(f*100)+'%'; });
      blob = patchedBlob(file, fx);
    }
    input.dispose && input.dispose();
    const url = URL.createObjectURL(blob);
    // the preview needs the browser's own player to take it too
    const ok = await new Promise(res=>{ const v=el('video',{muted:true,playsInline:true,preload:'auto'});
      const fin=r=>{ clearTimeout(tm); try{ v.removeAttribute('src'); v.load(); }catch(e){} res(r); };
      const tm=setTimeout(()=>fin(false), 20000);
      v.addEventListener('loadeddata', ()=>fin(true), {once:true}); v.addEventListener('error', ()=>fin(false), {once:true}); v.src=url; });
    if(!ok){ URL.revokeObjectURL(url); throw new Error('This browser can read the file but can’t play it for the preview. Try Chrome, or convert the clip to H.264.'); }

    if(clip && clip.url) URL.revokeObjectURL(clip.url);
    clip = { file, blob, url, name, size:file.size, w, h, dur, t0, srcFps, codec, rotation, hdr };
    doc.fps = niceFps(srcFps);
    Object.assign(P, { secIn:0, secOut:0, secAuto:1, loops:0, nlSpeed:100, nlFit:0 });
    tNow = 0;
    stripMake();
    rcReset(); animStart(url);
    showClip();
    renderLooping(); tlBuildTicks(); exportInfo();
    $('#drop').style.display='none'; document.body.classList.add('hasclip');
    if(hdr) toast('This is an HDR clip. Madloop exports in standard range, so bright colours may look flatter.');
  }catch(e){
    console.error('[Madloop import]', e);
    box.className='mfprev empty'; box.textContent='No clip yet';
    if(clip) showClip();
    toast(e && e.message ? e.message : 'Madloop couldn’t read that file.', 6000);
  }finally{ try{ input && input.dispose && input.dispose(); }catch(e){} }
}
function niceFps(f){   // the clip's own rate, as the export's rate: 23.976 / 29.97 / 59.94 stay exact
  for(const k of [24000/1001, 30000/1001, 60000/1001]) if(Math.abs(f-k)<0.02) return +k.toFixed(3);
  return Math.max(1, Math.min(120, Math.round(f)));
}
function fmtSize(n){ return n>=1073741824 ? (n/1073741824).toFixed(1)+' GB' : (n/1048576).toFixed(n>=104857600?0:1)+' MB'; }
function fmtFps(f){ return (Math.abs(f-Math.round(f))<0.01 ? String(Math.round(f)) : f.toFixed(2))+' fps'; }
function showClip(){
  const box=$('#mfprev'); box.className='mfprev'; box.innerHTML='';
  const v=el('video',{muted:true,playsInline:true,loop:true,autoplay:true,src:clip.url}); v.play && v.play().catch(()=>{});
  box.appendChild(v);
  $('#mfname').textContent=clip.name;
  $('#mfinfo').textContent=clip.w+' × '+clip.h+' px · '+(CODEC_NAMES[clip.codec]||clip.codec)+' · '+fmtFps(clip.srcFps)+' · '+clip.dur.toFixed(1)+' s · '+fmtSize(clip.size);
  $('#importBtn').textContent='Replace clip…';
}

/* The section's filmstrip: a dozen small frames of the clip, made once per file. Trimming draws
   from these and never seeks the video itself, so the handles stay light however big the file. */
const strip = { n:12, cw:128, ch:72, sheet:null, have:0, onchange:null };
async function stripMake(){
  const c0=clip, n=strip.n, cw=strip.cw, ch=Math.max(16, Math.min(256, Math.round(cw/Math.max(0.2, c0.w/c0.h))));
  strip.ch=ch; strip.sheet=el('canvas',{width:n*cw,height:ch}); strip.have=0;
  const c=strip.sheet.getContext('2d'); c.fillStyle='#101010'; c.fillRect(0,0,n*cw,ch);
  let input=null;
  try{
    input=openInput(c0.blob); const track=await input.getPrimaryVideoTrack(); const sink=new MB.VideoSampleSink(track);
    const ts=[]; for(let i=0;i<n;i++) ts.push(c0.t0+(i+0.5)/n*c0.dur);
    let i=0;
    for await (const s of sink.samplesAtTimestamps(ts)){
      if(clip!==c0){ if(s) s.close(); continue; }
      if(s){ try{ s.draw(c, i*cw, 0, cw, ch); }catch(e){} s.close(); }
      strip.have=++i; if(strip.onchange) strip.onchange();
    }
  }catch(e){ console.warn('[Madloop] filmstrip', e); }
  finally{ try{ input && input.dispose && input.dispose(); }catch(e){} }
}

/* ═════════════════════════════ CONTROLS (Madblur's skin) ═════════════════════════════ */
function fitVal(inp, txt){
  const n = Math.max(String(txt!=null ? txt : inp.value).length, 1);
  const px = Math.max(8, Math.min(16, Math.floor(52/(n*0.6)*2)/2));
  inp.style.fontSize = px<16 ? px+'px' : '';
}
/* Pick menu (Madblur build 166): the app's one dropdown, no OS menus. */
let _pickMenu=null;
function closePickMenu(commit, idx){
  if(!_pickMenu) return;
  const m=_pickMenu; _pickMenu=null;
  m.pop.remove();
  document.removeEventListener('pointerdown', m.onDown, true);
  document.removeEventListener('keydown', m.onKey, true);
  document.removeEventListener('scroll', m.onScroll, true);
  if(commit) m.cfg.onPick(idx);
}
function openPickMenu(btn, cfg){
  closePickMenu(false);
  const pop=el('div',{className:'blendpop'});
  cfg.labels.forEach((name,i)=>{
    if(name==null) return;
    const it=el('div',{className:'bopt'+(i===cfg.cur?' cur':''),textContent:name});
    it.onclick=(e)=>{ e.stopPropagation(); closePickMenu(true, i); };
    pop.appendChild(it);
  });
  document.body.appendChild(pop);
  const r=btn.getBoundingClientRect(), vw=window.innerWidth, vh=window.innerHeight;
  pop.style.minWidth=Math.max(120, r.width)+'px';
  const below=vh-8-(r.bottom+2), above=r.top-2-8;
  if(pop.scrollHeight>below && above>below){ pop.style.bottom=(vh-r.top+2)+'px'; pop.style.maxHeight=Math.max(72, above)+'px'; }
  else { pop.style.top=(r.bottom+2)+'px'; pop.style.maxHeight=Math.max(72, below)+'px'; }
  pop.style.left=Math.max(8, Math.min(r.left, vw-8-pop.offsetWidth))+'px';
  const onDown=(e)=>{ if(!e.target.closest('.blendpop') && !btn.contains(e.target)) closePickMenu(false); };
  const onKey=(e)=>{ if(e.key==='Escape'){ e.stopPropagation(); closePickMenu(false); } };
  const onScroll=(e)=>{ if(e.target===pop || pop.contains(e.target)) return; closePickMenu(false); };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
  _pickMenu={pop, cfg, onDown, onKey, onScroll};
}
function pickButton(options, cur, onChange, omit){
  const btn=el('button',{className:'pickbtn',type:'button'});
  const lab=el('span',{textContent:options[cur]||''});
  btn.append(lab, el('span',{className:'chev',textContent:'▾'}));
  btn.onclick=(e)=>{ e.stopPropagation(); if(_pickMenu){ closePickMenu(false); return; }
    openPickMenu(btn,{ labels:options.map((o,i)=>(omit && omit.indexOf(i)>=0 && i!==cur) ? null : o), cur,
      onPick:(i)=>{ cur=i; lab.textContent=options[i]||''; onChange(i); } }); };
  return btn;
}
function selectRow(label, value, options, onChange, omit){
  const r=el('div',{className:'row'});
  r.append(el('label',{textContent:label}), pickButton(options, value|0, onChange, omit));
  return r;
}
// a native <select> driven through the pick menu (the timeline's Zoom / Quality)
function dressSelect(sel){
  const btn=pickButton([...sel.options].map(o=>o.textContent), sel.selectedIndex, i=>{ sel.selectedIndex=i; sel.dispatchEvent(new Event('change')); });
  sel.style.display='none'; sel.after(btn);
}
// the 96×24 value box: − / typed value / +
function stepper(value, onChange, min, max, dp){
  const wrap=el('span',{className:'stepper'});
  const dec=el('button',{type:'button',title:'Nudge down'}), inc=el('button',{type:'button',title:'Nudge up'});
  const fmt=v=>(+v).toFixed(dp||0);
  const inp=el('input',{type:'text', value:fmt(value)});
  const set=v=>{ v=+v; if(!isFinite(v)) v=min; v=+Math.min(max,Math.max(min,v)).toFixed(dp||0); inp.value=fmt(v); fitVal(inp); onChange(v); };
  fitVal(inp);
  dec.onclick=(ev)=>set((+inp.value||0)-(ev&&ev.shiftKey?10:1));
  inc.onclick=(ev)=>set((+inp.value||0)+(ev&&ev.shiftKey?10:1));
  inp.addEventListener('keydown',(ev)=>{ if(ev.key!=='ArrowUp' && ev.key!=='ArrowDown') return;
    ev.preventDefault(); ev.stopPropagation(); set((+inp.value||0)+(ev.key==='ArrowUp'?1:-1)*(ev.shiftKey?10:1)); });
  inp.onchange=()=>set(inp.value);
  wrap.append(inp,dec,inc);
  wrap.setValue=v=>{ if(document.activeElement!==inp){ inp.value=fmt(v); fitVal(inp); } };
  return wrap;
}
const RESET_ICON = '<svg viewBox="0 0 15 14" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 6.99947C15.0002 8.83994 14.2836 10.6064 13.0053 11.9166C11.727 13.2268 9.9899 13.9752 8.16995 14H8.07692C6.30883 14.0044 4.60693 13.3202 3.32452 12.0894C3.26945 12.0368 3.22518 11.9736 3.19423 11.9037C3.16329 11.8337 3.14627 11.7582 3.14416 11.6816C3.14206 11.605 3.15489 11.5287 3.18194 11.4571C3.20899 11.3855 3.24972 11.32 3.3018 11.2643C3.35389 11.2086 3.41631 11.1639 3.48551 11.1326C3.55471 11.1013 3.62932 11.0841 3.70509 11.0819C3.78086 11.0798 3.85631 11.0928 3.92712 11.1201C3.99793 11.1475 4.06272 11.1887 4.11779 11.2413C4.94264 12.0279 5.97843 12.5513 7.09574 12.7462C8.21306 12.941 9.36238 12.7985 10.4001 12.3367C11.4379 11.8748 12.318 11.114 12.9306 10.1493C13.5432 9.18459 13.8612 8.05872 13.8447 6.91236C13.8282 5.76599 13.478 4.64996 12.8379 3.70366C12.1978 2.75737 11.2961 2.02278 10.2455 1.59165C9.19492 1.16053 8.04199 1.05198 6.93075 1.27958C5.81951 1.50718 4.79923 2.06083 3.99736 2.87136C3.99146 2.8778 3.9852 2.88389 3.97861 2.88959L2.06178 4.66597H4.03846C4.19147 4.66597 4.33821 4.72743 4.44641 4.83684C4.5546 4.94624 4.61538 5.09462 4.61538 5.24934C4.61538 5.40407 4.5546 5.55245 4.44641 5.66185C4.33821 5.77126 4.19147 5.83272 4.03846 5.83272H0.576923C0.423914 5.83272 0.277171 5.77126 0.168977 5.66185C0.0607828 5.55245 0 5.40407 0 5.24934V1.74909C0 1.59437 0.0607828 1.44599 0.168977 1.33658C0.277171 1.22718 0.423914 1.16572 0.576923 1.16572C0.729933 1.16572 0.876675 1.22718 0.984869 1.33658C1.09306 1.44599 1.15385 1.59437 1.15385 1.74909V3.92217L3.19111 2.04078C4.16032 1.06453 5.39385 0.400522 6.73596 0.13258C8.07807 -0.135362 9.4686 0.00477348 10.732 0.535296C11.9954 1.06582 13.0751 1.96294 13.8347 3.11342C14.5943 4.2639 14.9998 5.61615 15 6.99947Z" fill="currentColor"/></svg>';
/* A slider block (Madblur's Inspector V2 parameter block, without the LFO): a plate with the
   name, the slider, then reset and the value box. */
function sliderBlock(box, label, key, min, max, step, def, dp){
  const fmt=v=>(+v).toFixed(dp);
  const block=el('div',{className:'pblock'}), top=el('div',{className:'ptop'});
  top.append(el('div',{className:'plabel',textContent:label,title:label}));
  const bot=el('div',{className:'pbot'}), wrap=el('div',{className:'slidwrap'});
  const rng=el('input',{type:'range'}); rng.min=min; rng.max=max; rng.step=step; rng.value=P[key];
  wrap.append(el('div',{className:'lfotrack'}), rng); bot.append(wrap);
  const ctl=el('div',{className:'pctl'});
  const reset=el('button',{className:'presetbtn',title:'Reset to default'}); reset.innerHTML=RESET_ICON;
  const pstep=el('span',{className:'stepper'}), decB=el('button',{type:'button',title:'Nudge down'}),
        valB=el('input',{className:'pval',type:'text',value:fmt(P[key])}), incB=el('button',{type:'button',title:'Nudge up'});
  pstep.append(valB, decB, incB); ctl.append(reset, pstep); fitVal(valB);
  block.append(top, bot, ctl); box.appendChild(block);
  const setVal=v=>{ v=+Math.min(max,Math.max(min,v)).toFixed(dp); P[key]=v; rng.value=v; if(document.activeElement!==valB){ valB.value=fmt(v); fitVal(valB); } changed(); };
  rng.oninput=()=>setVal(+rng.value);
  reset.onclick=()=>setVal(def);
  const nudge=(dir,ev)=>setVal(P[key]+dir*((ev&&ev.shiftKey)?step*10:step));
  decB.onclick=(ev)=>nudge(-1,ev); incB.onclick=(ev)=>nudge(1,ev);
  valB.addEventListener('keydown',(ev)=>{ if(ev.key!=='ArrowUp' && ev.key!=='ArrowDown') return;
    ev.preventDefault(); ev.stopPropagation(); nudge(ev.key==='ArrowUp'?1:-1, ev); valB.value=fmt(P[key]); fitVal(valB); });
  valB.onchange=()=>setVal(+valB.value);
}
let _toastT=0;
function toast(msg, ms){ const t=$('#mbToast'); t.textContent=msg; t.classList.add('on'); clearTimeout(_toastT); _toastT=setTimeout(()=>t.classList.remove('on'), ms||4000); }

/* ═════════════════════════════ 2. LOOPING ═════════════════════════════ */
// Madblur's Media parameters for looping, in its order. kind float = a slider block.
const METHODS = ['No loop','Speed fit','Bounce','Crossfade','Hold frame','Patterned dissolve'];
const PARAMS = [
  {key:'ease',     label:'Easing',      kind:'float',  min:0, max:100, step:1, def:0, show:m=>m===2},   // slow into each turn
  {key:'pat',      label:'Pattern',     kind:'select', options:['Sweep','Centre out','Clouds'], show:m=>m===5, rerender:true},
  {key:'patDir',   label:'Direction',   kind:'select', options:['Right','Left','Down','Up'], show:m=>m===5 && (P.pat|0)===0},
  {key:'patShape', label:'Shape',       kind:'select', options:['Frame','Circle','Square','Diamond','Star','Cross'], show:m=>m===5 && (P.pat|0)===1},
  {key:'patCount', label:'Shape count', kind:'float',  min:1, max:12, step:1, def:1, show:m=>m===5 && (P.pat|0)===1},
  {key:'patRev',   label:'Travel',      kind:'select', options:['Outwards','Inwards'], show:m=>m===5 && (P.pat|0)===1},
  {key:'patSeed',  label:'Seed',        kind:'float',  min:1, max:99, step:1, def:1, show:m=>m===5 && (P.pat|0)===2},
  {key:'patScale', label:'Scale',       kind:'float',  min:20, max:400, step:1, def:100, show:m=>m===5 && (P.pat|0)===2},
  {key:'patDetail',label:'Detail',      kind:'float',  min:0, max:100, step:1, def:50, show:m=>m===5 && (P.pat|0)===2},
  {key:'patSoft',  label:'Softness',    kind:'float',  min:3, max:100, step:1, def:35, show:m=>m===5},
  {key:'xf',       label:'Crossfade length', kind:'float', min:2, max:100, step:1, def:18, show:m=>m===3 || m===5},   // share of each play spent blending; 100 = always blending
];
let _secPlace = null, _secRedraw = null;   // the Section block's readouts / its whole redraw (filmstrip too), while it is on screen
function changed(){ invalidate(); if(_secPlace) _secPlace(); exportInfo(); }

function renderLooping(){
  // the timeline settings
  const ls=$('#loopSecSlot'), fs=$('#fpsSlot');
  ls.innerHTML=''; fs.innerHTML='';
  ls.appendChild(stepper(doc.loopSeconds, v=>{ doc.loopSeconds=v; tlBuildTicks(); changed(); }, 1, 600, 0));
  const fpsIn=el('input',{type:'text',className:'numin',value:String(doc.fps)});
  fpsIn.onchange=()=>{ const v=+fpsIn.value; if(isFinite(v) && v>=1 && v<=120){ doc.fps=+v.toFixed(3); tlBuildTicks(); changed(); } fpsIn.value=String(doc.fps); };
  fs.appendChild(fpsIn);
  // the section, its speed and loops
  const sb=$('#secBox'); sb.innerHTML=''; _secPlace=null; _secRedraw=null;
  if(clip) mediaSectionUI(sb); else sb.appendChild(el('div',{className:'hint',textContent:'Import a clip first.'}));
  // the method and its own controls
  const mb=$('#methodBox'); mb.innerHTML='';
  const m=P.loopMode|0;
  mb.appendChild(selectRow('Method', m, METHODS, i=>{ P.loopMode=i; changed(); renderLooping(); }, [1,4]));   // Speed fit and Hold frame are retired (Tim, 2026-10-16)
  for(const p of PARAMS){
    if(!p.show(m)) continue;
    if(p.kind==='select') mb.appendChild(selectRow(p.label, P[p.key], p.options, i=>{ P[p.key]=i; changed(); if(p.rerender) renderLooping(); }));
    else sliderBlock(mb, p.label, p.key, p.min, p.max, p.step, p.def, p.dp||0);
  }
}

/* Madblur build 441 — the Section block (Tim, from the loop lab): "make the behaviour like
   editing a video on modern iOS, put the loop control below it and above the control put a read
   out for the speed". Section length × loops ÷ speed = the timeline. Only the user's own drag
   changes the section. Trim it and Loops takes the whole number nearest true speed; drag Loops
   and Speed follows; drag Speed and it steps between the speeds whole loops allow (on No loop
   nothing has to be whole, so Speed is free and Loops follows). */
function mediaSectionUI(box){
  const s=clip, dur=s.dur, MINL=Math.min(Math.max(MEDIA_SEC_MIN,0.25), dur/2), T=()=>doc.loopSeconds||30;
  const cv=el('canvas',{className:'strip'}), shL=el('div',{className:'shade'}), shR=el('div',{className:'shade'});
  const hIn=el('div',{className:'hd in',title:'Start of the section'}), hOut=el('div',{className:'hd out',title:'End of the section'});
  hIn.appendChild(el('i')); hOut.appendChild(el('i'));
  const frame=el('div',{className:'frame',title:'Drag to slide the section along the clip. Double-click to go back to the automatic section.'}); frame.append(hIn,hOut);
  const tipCv=el('canvas'), tipT=el('span'), tip=el('div',{className:'tip'}); tip.append(tipCv,tipT);
  const sec=el('div',{className:'msec'}); sec.append(cv,shL,shR,frame,tip);
  const read=el('div',{className:'msread'});
  const row=el('div',{className:'row'}); row.append(sec, read);
  box.appendChild(row);
  const spRng=el('input',{type:'range',title:'Double-click for the speed nearest 100%'}), spVal=el('span',{className:'msval'});
  spRng.min=10; spRng.max=400; spRng.step=1;
  const spRow=el('div',{className:'row msrow'}); spRow.append(el('label',{textContent:'Speed'}), spRng, spVal);
  const lpRng=el('input',{type:'range',title:'Double-click for the automatic count'}), lpVal=el('span',{className:'msval'});
  lpRng.min=1; lpRng.max=32; lpRng.step=1;
  const lpRow=el('div',{className:'row msrow'}); lpRow.append(el('label',{textContent:'Loops'}), lpRng, lpVal);
  box.append(spRow, lpRow);

  const drawStrip=()=>{
    const w=cv.clientWidth; if(!w || !strip.sheet) return;
    const dpr=Math.min(2,window.devicePixelRatio||1), W=Math.round(w*dpr), H=Math.round(44*dpr);
    if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; }
    const c=cv.getContext('2d'); c.fillStyle='#101010'; c.fillRect(0,0,W,H);
    const asp=strip.cw/strip.ch, cells=Math.max(3,Math.min(strip.n,Math.round(W/(H*asp)))), cellW=W/cells;
    for(let j=0;j<cells;j++){ const i=Math.min(strip.n-1,Math.floor((j+0.5)/cells*strip.n)); if(i>=strip.have) continue;
      const sw=Math.min(strip.cw, strip.ch*(cellW/H)), sh=Math.min(strip.ch, strip.cw/(cellW/H));   // cover the cell, cropped to its shape
      c.drawImage(strip.sheet, i*strip.cw+(strip.cw-sw)/2, (strip.ch-sh)/2, sw, sh, j*cellW, 0, cellW, H);
      c.fillStyle='rgba(0,0,0,.5)'; c.fillRect(Math.round(j*cellW),0,dpr,H); }
  };
  strip.onchange=()=>{ if(cv.isConnected) drawStrip(); };
  const fmt=v=>v.toFixed(v<10?2:1);
  const place=()=>{
    if(!cv.isConnected) return;
    const sc=mediaSection(P,s), w=cv.clientWidth||1, a=sc.a/dur*w, b=(sc.a+sc.D)/dur*w, inf=mediaLoopInfo();
    shL.style.cssText='left:0;width:'+a+'px'; shR.style.cssText='left:'+b+'px;width:'+Math.max(0,w-b)+'px';
    frame.style.left=a+'px'; frame.style.width=Math.max(2,b-a)+'px';
    const whole=sc.a<1e-6 && Math.abs(sc.a+sc.D-dur)<1e-6;
    read.textContent=(whole ? 'The whole clip, '+fmt(dur)+' s' : fmt(sc.a)+' – '+fmt(sc.a+sc.D)+' s · '+fmt(sc.D)+' s of '+fmt(dur)+' s')+(P.secAuto>0.5 && !whole ? ' · automatic' : '');
    const show=inf.n!=null; spRow.style.display=lpRow.style.display=show?'':'none';
    if(!show) return;
    const pct=Math.round(inf.speed*100), off=Math.abs(inf.speed-1);
    spVal.innerHTML='<b class="'+(off<0.005?'true':(inf.speed<0.67||inf.speed>1.5)?'far':'')+'">'+pct+'%</b>';
    spVal.title= off<0.005 ? 'The clip plays at its true speed' : inf.speed<1 ? 'The clip is slowed to fit' : 'The clip is sped up to fit';
    if(document.activeElement!==spRng) spRng.value=Math.max(10,Math.min(400,pct));
    const wholeN=Math.abs(inf.n-Math.round(inf.n))<1e-6;
    lpVal.textContent= inf.free ? (wholeN ? String(Math.round(inf.n)) : inf.n.toFixed(2)+' · not whole') : (inf.n+(P.loops>0?'':' · auto'));
    lpRng.max=Math.max(32, Math.round(inf.n)); if(document.activeElement!==lpRng) lpRng.value=Math.max(1,Math.round(inf.n));
  };
  _secPlace=place; _secRedraw=()=>{ if(cv.isConnected){ drawStrip(); place(); } };
  requestAnimationFrame(()=>{ if(cv.isConnected){ drawStrip(); place(); } });
  if(typeof ResizeObserver==='function') new ResizeObserver(()=>{ if(cv.isConnected){ drawStrip(); place(); } }).observe(sec);

  // dragging: an end trims, the middle slides
  const showTip=(t)=>{ if(!strip.sheet) return; const i=Math.max(0,Math.min(strip.n-1,Math.floor(t/dur*strip.n)));
    if(tipCv.width!==strip.cw||tipCv.height!==strip.ch){ tipCv.width=strip.cw; tipCv.height=strip.ch; }
    tipCv.getContext('2d').drawImage(strip.sheet, i*strip.cw, 0, strip.cw, strip.ch, 0, 0, strip.cw, strip.ch);
    tipT.textContent=fmt(t)+' s'; tip.style.left=(t/dur*(cv.clientWidth||1))+'px'; tip.style.display='block'; };
  [[hIn,'in'],[hOut,'out'],[frame,'slide']].forEach(([h,kind])=>{
    let on=null;
    h.addEventListener('pointerdown',e=>{ if(kind==='slide' && e.target!==frame) return;
      const sc=mediaSection(P,s); on={ x:e.clientX, a:sc.a, b:sc.a+sc.D }; try{ h.setPointerCapture(e.pointerId); }catch(x){} e.preventDefault(); e.stopPropagation(); frame.classList.add('drag'); });
    h.addEventListener('pointermove',e=>{ if(!on) return;
      const dt=(e.clientX-on.x)/(cv.clientWidth||1)*dur; let a=on.a, b=on.b;
      if(kind==='in') a=Math.min(Math.max(0,on.a+dt), on.b-MINL);
      else if(kind==='out') b=Math.max(Math.min(dur,on.b+dt), on.a+MINL);
      else { const len=on.b-on.a; a=Math.min(Math.max(0,on.a+dt), dur-len); b=a+len; }
      P.secAuto=0; P.secIn=+a.toFixed(3); P.secOut= b>=dur-1e-4 ? 0 : +b.toFixed(3);
      changed(); showTip(kind==='out'?b:a); });
    const up=()=>{ if(!on) return; on=null; tip.style.display='none'; frame.classList.remove('drag'); changed(); };
    h.addEventListener('pointerup',up); h.addEventListener('pointercancel',up);
  });
  frame.addEventListener('dblclick',()=>{ P.secAuto=1; P.secIn=0; P.secOut=0; changed(); });

  // Speed and Loops
  const leaveSpeedFit=()=>{ if((P.loopMode|0)===1){ P.loopMode=0; return true; } return false; };
  spRng.oninput=()=>{
    const inf=mediaLoopInfo(), D=inf.D, want=(+spRng.value)/100;
    if(inf.free){ leaveSpeedFit();
      const sp=Math.min(4, Math.max(D/T(), want)), nNear=Math.max(1,Math.round(sp*T()/D)), spFit=nNear*D/T();
      if(Math.abs(sp-1)<0.03){ P.nlFit=0; P.nlSpeed=100; }                       // true speed
      else if(Math.abs(sp-spFit)<0.025){ P.nlFit=nNear; }                        // a speed that fits whole plays
      else { P.nlFit=0; P.nlSpeed=+(sp*100).toFixed(2); }
    } else { const k=mediaLoopK(P), n=Math.min(64,Math.max(1,Math.round(want*T()/(k*D)))); P.loops= n===inf.auto ? 0 : n; }
    changed(); };
  lpRng.oninput=()=>{ const inf=mediaLoopInfo(), v=Math.max(1,Math.round(+lpRng.value));
    if(inf.free){ leaveSpeedFit(); P.nlFit=v; } else P.loops= v===inf.auto ? 0 : v;
    changed(); };
  const reset=()=>{ const inf=mediaLoopInfo(); if(inf.free){ leaveSpeedFit(); P.nlFit=0; P.nlSpeed=100; } else P.loops=0; changed(); };
  spRng.ondblclick=reset; lpRng.ondblclick=reset;
}

/* ═════════════════════════════ THE TIMELINE (Madblur build 163 / 422) ═════════════════════════════ */
function tlFrame(){ const N=frameCount(); return (((Math.round(tNow*N)%N)+N)%N); }
function tlSetPlaying(p){ playing=p; $('#timeline').classList.toggle('playing', !!p); _lastNow=performance.now(); invalidate(); }
function tlStep(dir){ const N=frameCount(); tNow=((((Math.round(tNow*N)+dir)%N)+N)%N)/N; tlSetPlaying(false); }
function tlUpdate(){
  const read=$('#tlRead'); const N=frameCount(), pct=(tNow*100);
  $('#tlHead').style.left=pct+'%'; $('#tlFill').style.width=pct+'%';
  const f=tlFrame(), fps=Math.max(1,Math.round(doc.fps||30)), secs=tNow*doc.loopSeconds;
  const p2=n=>String(n).padStart(2,'0');
  read.querySelector('.fr').textContent='FRAME '+String(f).padStart(4,'0');
  read.querySelector('.tc').textContent=p2(Math.floor(secs/60))+':'+p2(Math.floor(secs%60))+':'+p2(f%fps);
}
function tlBuildTicks(){
  const box=$('#tlTicks'); box.innerHTML='';
  // a ruler: seconds numbered at a spacing that stays readable on any loop length and rail width
  const loop=Math.max(0.01, +doc.loopSeconds||1), fps=Math.max(1, Math.round(doc.fps||30));
  const w=box.clientWidth||1, pps=w/loop, gap=String(Math.round(loop)).length>2 ? 34 : 24;
  let major=1; for(const m of [1,2,5,10,15,30,60,120,300,600]){ major=m; if(m*pps>=gap) break; }
  let minor=0;
  if(major===1 && pps/fps>=5) minor=1/fps; else if(major===1 && pps>=24) minor=0.5;
  else if(major>1 && pps>=6) minor=1; else if(major>=10 && pps*5>=6) minor=5;
  const add=(cls,sec,txt)=>{ const d=el('div',{className:cls}); d.style.left=(Math.min(1, sec/loop)*100)+'%';
    if(txt!=null) d.textContent=txt; box.appendChild(d); };
  if(minor) for(let i=1; i*minor<loop-1e-6; i++){ const sec=i*minor; if(Math.abs(sec/major-Math.round(sec/major))>1e-6) add('tick min', sec); }
  for(let sec=0; sec<loop-1e-6; sec+=major){ add('tick', sec); if(sec===0 || (loop-sec)*pps>=gap) add('tlab', sec, String(sec)); }
  add('tick', loop); add('tlab', loop, String(+loop.toFixed(2)));
}
function initTimeline(){
  const track=$('#tlTrack');
  const scrubTo=(clientX)=>{ const r=track.getBoundingClientRect();
    const f=Math.min(1,Math.max(0,(clientX-r.left)/Math.max(1,r.width))), N=frameCount(); tNow=(Math.round(f*N)%N)/N; invalidate(); };
  let scrubbing=false;
  track.addEventListener('mousedown',(e)=>{ scrubbing=true; tlSetPlaying(false); scrubTo(e.clientX); e.preventDefault(); });
  window.addEventListener('mousemove',(e)=>{ if(scrubbing) scrubTo(e.clientX); });
  window.addEventListener('mouseup',()=>{ scrubbing=false; });
  $('#tlPlay').onclick=()=>tlSetPlaying(!playing);
  $('#tlStepB').onclick=()=>tlStep(-1);
  $('#tlStepF').onclick=()=>tlStep(1);
  if(typeof ResizeObserver==='function'){ let _tw=-1; new ResizeObserver(()=>{ const w=track.clientWidth; if(w!==_tw){ _tw=w; tlBuildTicks(); } }).observe(track); }
  window.addEventListener('keydown',(e)=>{
    const t=e.target;
    if(t && (t.tagName==='TEXTAREA' || t.isContentEditable || (t.tagName==='INPUT' && !/^(range|checkbox|radio|button|color)$/.test(t.type)))) return;
    if(t && (t.tagName==='INPUT'||t.tagName==='SELECT')) return;
    if(PONG.on || !$('#about').hidden) return;
    if(e.code==='Space'){ e.preventDefault(); tlSetPlaying(!playing); }
    else if(e.key==='ArrowLeft'){ e.preventDefault(); tlStep(-1); }
    else if(e.key==='ArrowRight'){ e.preventDefault(); tlStep(1); }
    else if(e.key==='Home'){ e.preventDefault(); tNow=0; tlSetPlaying(false); }
  });
  tlBuildTicks(); tlUpdate();
  $('#timeline').classList.toggle('playing', !!playing);
}

/* ═════════════════════════════ THE LOOP: one clock for everything ═════════════════════════════ */
let _lastNow = performance.now();
function tick(now){
  requestAnimationFrame(tick);
  if(playing && !_exporting){ tNow = (tNow + (now-_lastNow)/1000/(doc.loopSeconds||30)) % 1; _dirty = true; }
  _lastNow = now;
  if(_dirty && !_exporting && clip){ _dirty = false; present(); }
  tlUpdate();
}

/* ═════════════════════════════ 3. EXPORT ═════════════════════════════
   Frame-exact. Mediabunny reads the clip and WebCodecs decodes the exact frames each output
   frame needs, one stream for the clip on screen (A) and one for the copy dissolving in (B).
   Each stream's clip times are known up front, so they're served in the cheapest order:
   · a stretch where clip time runs forward is decoded straight through, one frame at a time;
   · a stretch where it runs backward (the second half of Bounce) is cut into short windows,
     each decoded forward from its keyframe into a small pool of textures and then handed out
     in reverse.
   Memory stays at a few frames, whatever the clip or the export length. */
async function* serveFrames(R, track, times, pool){
  // times: clip seconds per output frame (null = this stream isn't needed then).
  const sink = new MB.VideoSampleSink(track);
  // A phone's portrait clip is stored sideways with a "turn this" tag. The GPU upload ignores
  // the tag, so a turned frame is drawn the right way up first (Mediabunny's draw honours it).
  // HDR frames take the same route, for the colour reason in makeRenderer's upload.
  let flat=null;
  const up = (tex, s)=>{
    if(s.rotation || s.flip || clip.hdr){
      if(!flat){ flat=new OffscreenCanvas(s.displayWidth, s.displayHeight); flat.ctx=flat.getContext('2d'); }
      s.draw(flat.ctx, 0, 0, flat.width, flat.height); R.upload(tex, flat); return; }
    const vf=s.toVideoFrame(); try{ R.upload(tex, vf); } finally { vf.close(); } };
  let i=0; const n=times.length;
  while(i<n){
    if(times[i]==null){ yield null; i++; continue; }
    // one monotonic stretch: forward (non-decreasing) or backward (decreasing)
    let j=i+1; const back = j<n && times[j]!=null && times[j]<times[i]-1e-9;
    if(back){ while(j<n && times[j]!=null && times[j]<times[j-1]-1e-9) j++; }
    else { while(j<n && times[j]!=null && times[j]>=times[j-1]-1e-9) j++; }
    if(!back){
      // forward: ask for each distinct time once, hand the same texture out for repeats
      const uniq=[]; for(let k=i;k<j;k++) if(!uniq.length || times[k]>uniq[uniq.length-1]+1e-9) uniq.push(times[k]);
      const it = sink.samplesAtTimestamps(uniq)[Symbol.asyncIterator]();
      let have=-1, last=null;
      for(let k=i;k<j;k++){
        if(last==null || times[k]>last+1e-9){ const r=await it.next(); have++; last=times[k];
          if(r.value){ up(pool[0], r.value); r.value.close(); } }
        yield pool[0];
      }
      try{ await it.return(); }catch(e){}
    } else {
      const K = pool.length;
      for(let w=i; w<j; w+=K){
        const e2=Math.min(j, w+K), asc=[]; for(let k=e2-1;k>=w;k--) asc.push(times[k]);   // this window, earliest first
        let slot=0;
        for await (const s of sink.samplesAtTimestamps(asc)){ if(s){ up(pool[e2-1-w-slot], s); s.close(); } slot++; }
        for(let k=w;k<e2;k++) yield pool[k-w];
      }
    }
    i=j;
  }
}
function exportSize(){ return { W: clip.w - (clip.w&1), H: clip.h - (clip.h&1) }; }   // the encoders need even sizes
function exportTimes(N){
  const a=[], b=[], ws=[], rs=[], E=1e-4;   // E: aim just inside each frame, so rounding never lands on the frame before
  for(let i=0;i<N;i++){ const ct=mediaClipTimes(P, clip, i/N);
    a.push(clip.t0+ct.tA+E); b.push(ct.w>0 ? clip.t0+ct.tB+E : null); ws.push(ct.w); rs.push(ct.r||0); }
  return { a, b, ws, rs };
}
let _encOk = { avc:false, hevc:false };
async function detectEncoders(){
  try{ _encOk.avc = await MB.canEncodeVideo('avc', {width:1920, height:1080}); }catch(e){}
  try{ _encOk.hevc = await MB.canEncodeVideo('hevc', {width:1920, height:1080}); }catch(e){}
  const v4=$('#exportVidBtn'), v5=$('#exportH265Btn');
  if(!_encOk.hevc) v5.style.display='none';
  if(!_encOk.avc){ v4.dataset.never='1'; v4.disabled=true; v4.title='Video export needs a browser with WebCodecs: Chrome, Edge, Safari 17+ or Firefox 130+'; }
  if(!window.showDirectoryPicker) $('#exportDirBtn').style.display='none';
  exportInfo();
}
function expLock(on){ document.querySelectorAll('.xbtn').forEach(b=>{ b.disabled = on || !clip || b.dataset.never==='1'; }); }
function exportInfo(){
  const n=$('#expN'); if(n) n.textContent=frameCount();
  const info=$('#exportInfo'); expLock(_exporting);
  if(!clip){ info.textContent='Import a clip first.'; return; }
  const {W,H}=exportSize(), N=frameCount();
  const mb=Math.round(W*H*doc.fps*0.12*doc.loopSeconds/8/1048576);   // roughly what QUALITY_HIGH comes to
  info.innerHTML='<b>'+doc.loopSeconds+' s</b> · '+N+' frames · '+W+' × '+H+' · '+fmtFps(doc.fps)+' · no sound. As H.264, about '+mb+' MB. '
    +(window.showSaveFilePicker ? 'You choose where it goes and it is written as it renders.' : 'This browser builds the file in memory first, so a very long 4K export may not fit; Chrome and Edge write straight to disk.');
}
function baseName(){ return (clip.name.replace(/\.[^.]+$/,'')||'clip').replace(/[^\w\- ]+/g,'').slice(0,60)+'_loop'; }
async function runExport(kind){
  if(!clip || _exporting) return;
  const N=frameCount(), fps=doc.fps, {W,H}=exportSize();
  const isVid = kind==='h264' || kind==='h265';
  const name = baseName()+'_'+W+'x'+H+(isVid ? (kind==='h265'?'_h265':'')+'.mp4' : '_'+N+'f');
  // where it goes: picked first, so a cancelled picker costs nothing
  let fileHandle=null, writable=null, dir=null;
  _exporting=true; _exportCancel=false;
  try{
    if(isVid && window.showSaveFilePicker){
      try{ fileHandle=await showSaveFilePicker({ suggestedName:name, types:[{ description:'MP4 video', accept:{'video/mp4':['.mp4']} }] }); }
      catch(e){ _exporting=false; return; }
      writable=await fileHandle.createWritable();
    }
    if(kind==='pngdir'){
      try{ const root=await showDirectoryPicker({mode:'readwrite'}); let sub=name, k=2;
        for(;;){ try{ await root.getDirectoryHandle(sub); sub=name+' '+(k++); }catch(e){ break; } }
        dir={ root, sub, h:await root.getDirectoryHandle(sub,{create:true}) }; }
      catch(e){ _exporting=false; return; }
    }
  }catch(e){ _exporting=false; toast('Couldn’t open that location: '+e.message); return; }

  const prog=$('#exportProgress'), cancel=$('#exportCancel');
  expLock(true); cancel.style.display=''; prog.style.display='block'; prog.textContent='Starting…';
  const wasPlaying=playing; playing=false; rcReset();
  for(const v of [A.el, A.elB]) if(v){ try{ v.pause(); }catch(e){} }
  try{ pongShow(isVid ? (kind==='h265'?'H.265 MP4':'H.264 MP4') : 'PNG SEQUENCE'); }catch(e){ console.warn('[Madloop pong]', e); }
  const cv=el('canvas',{width:W,height:H}); let R=null, input=null, output=null, done=false, note='';
  const files=[]; let zipBytes=0;
  try{
    R=makeRenderer(cv, true);
    input=openInput(clip.blob);
    const track=await input.getPrimaryVideoTrack();
    const ts=exportTimes(N);
    const K=Math.max(2, Math.min(24, Math.floor(512*1048576/(W*H*4))));   // backward windows: about half a gigabyte of frames at most
    const poolA=Array.from({length:K}, ()=>R.newTex()), poolB=Array.from({length:K}, ()=>R.newTex());
    const sA=serveFrames(R, track, ts.a, poolA), sB=serveFrames(R, track, ts.b, poolB);
    let source=null, target=null;
    if(isVid){
      target = writable ? new MB.StreamTarget(writable, {chunked:true}) : new MB.BufferTarget();
      output = new MB.Output({ format:new MB.Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }), target });
      source = new MB.CanvasSource(cv, { codec: kind==='h265'?'hevc':'avc', bitrate: MB.QUALITY_HIGH, keyFrameInterval: 2 });
      output.addVideoTrack(source, { frameRate: fps });
      await output.start();
    }
    const t0=performance.now();
    for(let i=0;i<N;i++){
      if(_exportCancel){ note='Cancelled.'; break; }
      const ra=await sA.next(), rb=await sB.next();
      R.draw(ra.value, rb.value, ts.ws[i], ts.rs[i]);
      if(isVid) await source.add(i/fps, 1/fps);
      else {
        const blob=await new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error('the browser’s PNG encoder returned nothing (likely out of memory)')),'image/png'));
        const fname=baseName()+'_'+String(i).padStart(String(N-1).length,'0')+'.png';
        if(dir){ const fh=await dir.h.getFileHandle(fname,{create:true}), w=await fh.createWritable(); await w.write(blob); await w.close(); }
        else { const data=new Uint8Array(await blob.arrayBuffer()); files.push({name:fname, data}); zipBytes+=data.length;
          if(i===4 && zipBytes/5*N > 1.6*1073741824) throw new Error('this sequence would be about '+fmtSize(zipBytes/5*N)+' as a .zip, more than a browser can hold. Use Chrome or Edge to write the frames straight into a folder, or export an MP4.'); }
      }
      if((i%3)===0 || i===N-1){
        const el_=(performance.now()-t0)/1000, left=el_/(i+1)*(N-i-1);
        prog.textContent='Rendering frame '+(i+1)+' / '+N+' · about '+Math.ceil(left)+' s left';
        pongProgress(i+1, N, W+'×'+H+(isVid?'':' PNG'));
      }
    }
    try{ await sA.return(); }catch(e){}  try{ await sB.return(); }catch(e){}
    if(_exportCancel){
      if(output) try{ await output.cancel(); }catch(e){}
      if(writable) try{ await writable.abort(); }catch(e){}
      if(fileHandle && fileHandle.remove) try{ await fileHandle.remove(); }catch(e){}
      prog.textContent='Cancelled.'+(dir ? ' The frames already written are in '+dir.root.name+'/'+dir.sub+'.' : '');
    } else if(isVid){
      prog.textContent='Finishing the file…';
      await output.finalize();
      if(writable){ prog.textContent='Done: '+fileHandle.name+' ('+N+' frames).'; done=true; }
      else { const blob=new Blob([target.buffer],{type:'video/mp4'});
        prog.textContent='Done: '+N+' frames, '+fmtSize(blob.size)+'.';
        await pongDeliver(blob, name); done=true; }
    } else if(dir){ prog.textContent='Done: '+N+' frames in '+dir.root.name+'/'+dir.sub+'.'; done=true; }
    else { prog.textContent='Packaging '+N+' frames…'; await new Promise(r=>setTimeout(r,0));
      const blob=makeZip(files); files.length=0;
      prog.textContent='Done: '+N+' frames, '+fmtSize(blob.size)+'.';
      await pongDeliver(blob, name+'.zip'); done=true; }
  }catch(e){
    console.error('[Madloop export]', e);
    prog.textContent='Export failed: '+(e && e.message ? e.message : e);
    if(output) try{ await output.cancel(); }catch(x){}
    if(writable) try{ await writable.abort(); }catch(x){}
  }finally{
    pongHide();
    try{ input && input.dispose && input.dispose(); }catch(e){}
    if(R) R.destroy();
    _exporting=false; expLock(false); cancel.style.display='none';
    playing=wasPlaying; $('#timeline').classList.toggle('playing', !!playing); _lastNow=performance.now(); invalidate();
  }
  return done;
}
// Minimal STORE (uncompressed) ZIP (Madblur's makeZip). PNGs are already compressed.
const _crcTable = (()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=_crcTable[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function makeZip(files){
  const enc=new TextEncoder(); const parts=[]; const central=[]; let offset=0;
  const u16=n=>[n&255,(n>>8)&255], u32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255];
  const T=0, D=0x21;   // fixed dos time/date → byte-stable zips
  for(const f of files){
    const name=enc.encode(f.name), data=f.data, crc=crc32(data);
    const lf=[].concat([0x50,0x4b,0x03,0x04], u16(20),u16(0),u16(0), u16(T),u16(D),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
    parts.push(new Uint8Array(lf), name, data);
    central.push({name,crc,size:data.length,offset}); offset += lf.length+name.length+data.length;
  }
  const cd=[]; let cdSize=0;
  for(const c of central){
    const rec=[].concat([0x50,0x4b,0x01,0x02], u16(20),u16(20),u16(0),u16(0), u16(T),u16(D),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0),u16(0),u16(0),u16(0), u32(0), u32(c.offset));
    const b=new Uint8Array(rec.length+c.name.length); b.set(rec,0); b.set(c.name,rec.length); cd.push(b); cdSize+=b.length;
  }
  const eocd=new Uint8Array([].concat([0x50,0x4b,0x05,0x06], u16(0),u16(0),
    u16(central.length),u16(central.length), u32(cdSize), u32(offset), u16(0)));
  return new Blob([...parts, ...cd, eocd], {type:'application/zip'});
}

/* ═════════════════════════════ BOOT ═════════════════════════════ */
function boot(){
  // tabs
  document.querySelectorAll('.tabs button[data-tab]').forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll('.tabs button[data-tab]').forEach(x=>x.classList.toggle('on',x===b));
      document.querySelectorAll('[data-panel]').forEach(p=>p.classList.toggle('on', p.dataset.panel===b.dataset.tab));
      if(b.dataset.tab==='loop' && _secRedraw) requestAnimationFrame(()=>_secRedraw());
    };
  });
  // About: a box over the whole window
  // About is pressed while the box is open; the tab that was pressed comes back up when it closes
  const about=$('#about'), aboutOpen=on=>{
    if(on===!about.hidden) return;
    const tabs=[...document.querySelectorAll('.tabs button[data-tab]')];
    if(on){ about._was=tabs.find(t=>t.classList.contains('on')); tabs.forEach(t=>t.classList.remove('on')); }
    else if(about._was) about._was.classList.add('on');
    $('#aboutBtn').classList.toggle('on', on);
    about.hidden=!on; if(on) about.querySelector('.abox').focus(); };
  $('#aboutVer').textContent='Madloop Build '+String(BUILD).padStart(4,'0');
  document.querySelectorAll('#about a[data-link]').forEach(a=>{ const u=LINKS[a.dataset.link];
    if(u){ a.href=u; a.target='_blank'; a.rel='noopener'; } else { a.removeAttribute('href'); a.classList.add('todo'); a.title='Link coming soon'; } });
  $('#aboutBtn').onclick=()=>aboutOpen(about.hidden);   // About again closes it
  about.addEventListener('click', e=>{ if(!e.target.closest('a[href]')) aboutOpen(false); });   // any click but a link closes it (Tim)
  window.addEventListener('keydown', e=>{ if(e.key==='Escape' && !about.hidden){ e.preventDefault(); aboutOpen(false); } }, true);
  // the preview canvas lives in a scrolling view above the docked timeline
  const stage=$('#stage'), cv=$('#gl'), viewBox=el('div',{id:'view'});
  stage.insertBefore(viewBox, cv); viewBox.appendChild(cv);
  view.cv=cv;
  try{ view.R=makeRenderer(cv, false); view.texA=view.R.newTex(); view.texB=view.R.newTex(); }
  catch(e){ toast('Madloop needs WebGL2, which this browser doesn’t have.', 10000); console.error(e); }
  if(typeof ResizeObserver==='function') new ResizeObserver(()=>invalidate()).observe(viewBox);
  // import
  const fileIn=$('#fileIn');
  const pick=()=>{ if(!_exporting) fileIn.click(); };
  $('#importBtn').onclick=pick; $('#drop').onclick=pick;
  fileIn.onchange=()=>{ const f=fileIn.files && fileIn.files[0]; fileIn.value=''; if(f) importFile(f); };
  let dragN=0;
  window.addEventListener('dragenter',e=>{ if(e.dataTransfer && [...e.dataTransfer.types].includes('Files')){ dragN++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave',()=>{ if(--dragN<=0){ dragN=0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover',e=>{ e.preventDefault(); });
  window.addEventListener('drop',e=>{ e.preventDefault(); dragN=0; document.body.classList.remove('dragging');
    const f=e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) importFile(f); });
  // export
  $('#exportVidBtn').onclick=()=>runExport('h264');
  $('#exportH265Btn').onclick=()=>runExport('h265');
  $('#exportDirBtn').onclick=()=>runExport('pngdir');
  $('#exportBtn').onclick=()=>runExport('pngzip');
  $('#exportCancel').onclick=exportCancel;
  // timeline cells
  for(const id of ['vpZoom','vpQuality']) dressSelect($('#'+id));
  $('#vpZoom').onchange=()=>{ _zoom=$('#vpZoom').value; viewBox.classList.toggle('zoomed', _zoom!=='fit'); invalidate(); };
  $('#vpQuality').onchange=()=>{ _quality=+$('#vpQuality').value; invalidate(); };
  initTimeline();
  renderLooping();
  // phones and small screens get a word first
  const small = Math.min(screen.width, screen.height) < 600 || window.matchMedia('(pointer:coarse) and (max-width:900px)').matches;
  if(small) document.body.classList.add('phone');
  $('#phoneGo').onclick=()=>document.body.classList.remove('phone');
  if(!window.VideoDecoder || !window.VideoEncoder) toast('This browser can’t decode and encode video itself (WebCodecs). Try a recent Chrome, Edge, Safari or Firefox.', 10000);
  if(!MB) toast('Madloop’s video library didn’t load.', 10000);
  detectEncoders();
  requestAnimationFrame(tick);
}
boot();
