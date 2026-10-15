// Madloop test helpers. Not part of the app and never loaded by index.html. Paste into the page's
// console (or eval it from a test) after Madloop has loaded. See CLAUDE.md, "Testing".
// Clips are fetched from a test-clip server: python3 tools/serve.py 8412 <folder of clips>
window.__CLIPS = window.__CLIPS || 'http://localhost:8412/';
window.__test = {};
// Exports without dialogs: the file is built in memory and kept in __test.blob instead of downloading.
// (__toOPFS() instead routes the save dialog to the browser's private storage, to test the write-to-disk path.)
window.__realSave = window.showSaveFilePicker;
window.showSaveFilePicker = undefined;
window.pongDeliver = async (blob, name)=>{ window.__test.blob = blob; window.__test.name = name; };
window.__toOPFS = async ()=>{ const root=await navigator.storage.getDirectory();
  window.showSaveFilePicker = async (o)=>{ window.__fh = await root.getFileHandle('test-'+o.suggestedName, {create:true}); return window.__fh; }; };
window.__clearOPFS = async ()=>{ const root=await navigator.storage.getDirectory(); const n=[]; for await (const k of root.keys()) n.push(k); for(const k of n) await root.removeEntry(k); return n; };
window.__load = async (n)=>{ const b=await fetch(window.__CLIPS+n).then(r=>r.blob()); await importFile(new File([b],n,{type:b.type||'video/mp4'})); };
window.__d=(a,b)=>{ let s=0; for(let i=0;i<a.length;i+=4) s+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]); return s/(a.length/4*3); };
window.__analyse = async (blob)=>{
  const inp=new Mediabunny.Input({source:new Mediabunny.BlobSource(blob), formats:Mediabunny.ALL_FORMATS});
  const tr=await inp.getPrimaryVideoTrack(); const dur=await tr.computeDuration(); const st=await tr.computePacketStats();
  const sink=new Mediabunny.CanvasSink(tr,{width:96,height:54,fit:'fill'});
  const px=[]; for await (const w of sink.canvases()){ px.push(w.canvas.getContext('2d').getImageData(0,0,96,54).data.slice()); }
  const d=[]; for(let i=1;i<px.length;i++) d.push(__d(px[i-1],px[i]));
  const seam=__d(px[px.length-1],px[0]); const sorted=[...d].sort((a,b)=>a-b);
  return { codec:tr.codec, w:tr.displayWidth, h:tr.displayHeight, rot:tr.rotation, dur:+dur.toFixed(3), frames:px.length, rate:+st.averagePacketRate.toFixed(3), mb:+(blob.size/1048576).toFixed(2),
           seam:+seam.toFixed(2), median:+sorted[sorted.length>>1].toFixed(2), p95:+sorted[Math.floor(sorted.length*.95)].toFixed(2), max:+sorted[sorted.length-1].toFixed(2) };
};
window.__rawPx = async (K)=>{
  const N=frameCount(), {W,H}=exportSize(); const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const R=makeRenderer(cv,true); const inp=openInput(clip.blob); const tr=await inp.getPrimaryVideoTrack(); const ts=exportTimes(N);
  K=K||6; const pa=Array.from({length:K},()=>R.newTex()), pb=Array.from({length:K},()=>R.newTex());
  const sA=serveFrames(R,tr,ts.a,pa), sB=serveFrames(R,tr,ts.b,pb);
  const sm=document.createElement('canvas'); sm.width=96; sm.height=54; const sc=sm.getContext('2d',{willReadFrequently:true});
  const px=[]; const t0=performance.now();
  for(let i=0;i<N;i++){ const a=await sA.next(), b=await sB.next(); R.draw(a.value,b.value,ts.ws[i],ts.rs[i]); sc.drawImage(cv,0,0,96,54); px.push(sc.getImageData(0,0,96,54).data.slice()); }
  R.destroy(); return {px, secs:(performance.now()-t0)/1000, ts};
};
// __analyse(blob): decode an export; seam = last→first frame difference, compare with median/p95 (a
// smooth loop has seam ≈ median). __rawPx(): the same frames before encoding, straight from the renderer.
// a portrait clip stored sideways (rotation 90): the arrow must point UP when shown correctly
window.__makeRot = async ()=>{
  const W=640,H=360,fps=30,N=90; const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const c=cv.getContext('2d');
  const target=new Mediabunny.BufferTarget(), out=new Mediabunny.Output({format:new Mediabunny.Mp4OutputFormat({fastStart:'in-memory'}), target});
  const src=new Mediabunny.CanvasSource(cv,{codec:'avc', bitrate:2e6}); out.addVideoTrack(src,{frameRate:fps, rotation:90}); await out.start();
  for(let i=0;i<N;i++){ c.fillStyle='#234'; c.fillRect(0,0,W,H); c.fillStyle='#e4cd5c';
    c.beginPath(); c.moveTo(60,H/2); c.lineTo(200,H/2-90); c.lineTo(200,H/2+90); c.fill(); c.fillRect(200,H/2-30,300,60);
    await src.add(i/fps,1/fps); }
  await out.finalize(); return new File([target.buffer],'Portrait.mp4',{type:'video/mp4'});
};
window.__tip = d=>{ const w=36; for(let y=0;y<64;y++) for(let x=0;x<w;x++){ const i=(y*w+x)*4; if(d[i]>180&&d[i+1]>160&&d[i+2]<140) return [x,y]; } return null; };
'helpers loaded';
