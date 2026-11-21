import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import '@fontsource/tajawal/800.css';
import './styles.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
// Native recorder (android/app/src/main/java/com/eb3atly/recorder/AudioRecorderPlugin.java)
const AudioRecorder = registerPlugin('AudioRecorder');
import { loadMeta, saveMeta, putBlob, getBlob, deleteBlob, pruneBlobs } from './storage.js';
import { crc32, zipStore, zipRead } from './zip.js';

const isNative = Capacitor.isNativePlatform();
const $ = s => document.querySelector(s);
const ICON = {
  play:'<path d="M8 5v14l11-7z"/>', pause:'<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  edit:'<path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/>',
  folder:'<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/>',
  dl:'<path d="M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z"/>',
  del:'<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/>'
};
const ico = k => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
const PAIRS = [['#8B5CFF','#2DA8FF'],['#39FF88','#2DA8FF'],['#2DA8FF','#8B5CFF'],['#39FF88','#8B5CFF']];

/* ---------- state (persisted: metadata in localStorage, audio blobs in IndexedDB) ---------- */
const nid=()=>'i'+Math.random().toString(36).slice(2,9)+Date.now().toString(36);
let ready=false; // nothing is written to storage until the saved state has been loaded
function persist(){
  if(!ready) return;
  saveMeta({
    folders:state.folders,
    recs:state.recs.map(({blob,url,date,...m})=>({...m,date:date.toISOString()})),
    quality:state.quality, denoise:state.denoise, lastFolder:state.lastFolder,
    lastBackup:state.lastBackup?state.lastBackup.toISOString():null
  });
}
async function hydrate(){
  const meta=loadMeta();
  if(meta){
    if(Array.isArray(meta.folders)&&meta.folders.length) state.folders=meta.folders;
    state.quality=meta.quality||state.quality;
    state.denoise=meta.denoise??state.denoise;
    state.lastFolder=meta.lastFolder||null;
    state.lastBackup=meta.lastBackup?new Date(meta.lastBackup):null;
    const recs=[];
    for(const r of meta.recs||[]){
      const blob=await getBlob(r.id).catch(()=>null);
      if(!blob) continue; // metadata without audio: skip it instead of showing a broken item
      recs.push({...r,blob,url:URL.createObjectURL(blob),date:new Date(r.date)});
    }
    state.recs=recs;
    await pruneBlobs(new Set(recs.map(r=>r.id))).catch(()=>{});
  }
  if(!state.folders.length) state.folders=[{id:nid(),name:'عام'}];
  ready=true;
}
const state={folders:[{id:'f1',name:'عام'},{id:'f2',name:'شغل'},{id:'f3',name:'أفكار'}],recs:[],cur:null,screen:'home',q:'',playing:null,lastFolder:null,quality:'m4a-high',denoise:true,lastBackup:null};

/* ---------- helpers ---------- */
const fmt=s=>{s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const fmtT=s=>{s=Math.floor(s);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
const dateStr=d=>d.toLocaleDateString('ar-EG',{day:'numeric',month:'short'})+' · '+d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
let toastT; function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2400)}
const folderName=id=>(state.folders.find(f=>f.id===id)||{}).name||'بدون فولدر';
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const count=id=>state.recs.filter(r=>r.folderId===id).length;
const countTxt=n=>n===0?'فاضي':n===1?'تسجيل واحد':n===2?'تسجيلان':n+' تسجيلات';

/* ---------- navigation ---------- */
const SCREENS=['home','recpage','files','fview','settings'];
function show(n){state.screen=n;SCREENS.forEach(s=>$('#'+s).classList.toggle('hidden',s!==n));render()}
function render(){
  persist();
  $('#homeSub').textContent=state.recs.length?`${state.recs.length} تسجيل في ${state.folders.length} فولدرات`:'سجّل وخزّن وقسّم تسجيلاتك';
  $('#filesSub').textContent=`${state.folders.length} فولدرات · ${state.recs.length} تسجيل`;
  if(state.screen==='files') renderFolders();
  if(state.screen==='settings') renderSettings();
  if(state.screen==='fview') renderList();
}
function renderFolders(){
  const el=$('#folList'); el.innerHTML='';
  state.folders.forEach((f,i)=>{
    const [c1,c2]=PAIRS[i%PAIRS.length], n=count(f.id);
    const b=document.createElement('button'); b.className='fbtn'; b.style.setProperty('--c1',c1); b.style.setProperty('--c2',c2);
    b.innerHTML=`<span class="fi">${ico('folder')}</span><span class="ft"><div class="fn"></div><div class="fc">${countTxt(n)}</div></span><span class="fb">${n}</span>`;
    b.querySelector('.fn').textContent=f.name; b.onclick=()=>openFolder(f.id); el.appendChild(b);
  });
  const a=document.createElement('button'); a.className='fbtn add'; a.textContent='+ فولدر جديد'; a.onclick=newFolder; el.appendChild(a);
}
function openFolder(id){state.cur=id;state.q='';$('#q').value='';show('fview')}
function renderList(){
  const el=$('#list'); el.innerHTML='';
  $('#fvTitle').textContent=folderName(state.cur);
  const items=state.recs.filter(r=>r.folderId===state.cur&&r.name.includes(state.q)).sort((a,b)=>b.date-a.date);
  if(!items.length){el.innerHTML=`<div class="empty"><strong>مفيش تسجيلات هنا</strong>سجّل من الشاشة الرئيسية واختار الفولدر ده وقت الحفظ.</div>`;return}
  items.forEach(r=>{
    const d=document.createElement('div'); d.className='rec'+(state.playing===r.id?' playing':'');
    d.innerHTML=`<button class="play" aria-label="تشغيل">${ico('play')}</button><div class="meta"><div class="name"></div><div class="sub"><span>${fmt(r.dur)}</span><span>${dateStr(r.date)}</span>${(r.markers&&r.markers.length)?`<span style="color:var(--b)">⚑ ${r.markers.length}</span>`:''}</div></div><button class="more" aria-label="خيارات">⋮</button>`;
    d.querySelector('.name').textContent=r.name;
    d.querySelector('.play').onclick=()=>openPlayer(r.id);
    d.querySelector('.meta').onclick=()=>openPlayer(r.id);
    d.querySelector('.more').onclick=()=>recOptions(r.id);
    el.appendChild(d);
  });
}
$('#tRec').onclick=()=>show('recpage');
$('#tFiles').onclick=()=>show('files');
$('#fBack').onclick=()=>show('home');
$('#vBack').onclick=()=>show('files');
$('#rBack').onclick=()=>{ if(busy){toast('أنهِ التسجيل أو الغيه الأول');return} show('home') };
$('#fvMore').onclick=()=>folderOptions();
$('#q').oninput=e=>{state.q=e.target.value.trim();renderList()};

/* ---------- modal ---------- */
let modalLock=false, saving=false;
function openModal(html){$('#modal').innerHTML=html;$('#scrim').classList.add('open')}
function closeModal(){modalLock=false;$('#scrim').classList.remove('open')}
$('#scrim').addEventListener('click',e=>{if(e.target.id==='scrim'&&!modalLock)closeModal()});
function askText(title,val,ok){
  openModal(`<h3>${title}</h3><input type="text" id="mi"><div class="m-actions"><button id="mc">إلغاء</button><button class="pri" id="mo">حفظ</button></div>`);
  const i=$('#mi'); i.value=val||''; i.focus(); i.select();
  const go=()=>{const v=i.value.trim(); if(!v)return; closeModal(); ok(v)};
  $('#mo').onclick=go; $('#mc').onclick=closeModal; i.onkeydown=e=>{if(e.key==='Enter')go()};
}
function newFolder(){askText('فولدر جديد','',v=>{state.folders.push({id:nid(),name:v});render()})}
function folderOptions(){
  const f=state.folders.find(x=>x.id===state.cur); if(!f)return;
  openModal(`<h3></h3><button class="opt" id="o1">${ico('edit')}إعادة تسمية الفولدر</button><button class="opt danger" id="o2">${ico('del')}حذف الفولدر</button>`);
  $('#modal h3').textContent=f.name;
  $('#o1').onclick=()=>{closeModal();askText('اسم الفولدر',f.name,v=>{f.name=v;render()})};
  $('#o2').onclick=()=>{
    if(state.folders.length<2){closeModal();toast('لازم يفضل فولدر واحد على الأقل');return}
    const n=count(f.id), base=state.folders.find(x=>x.id!==f.id);
    const msg=!n?'الفولدر فاضي.':base?`فيه ${n} تسجيل، هيتنقلوا لفولدر «${base.name}».`:`فيه ${n} تسجيل وهيتحذفوا معاه.`;
    openModal(`<h3></h3><p style="color:var(--muted);line-height:1.8">${msg}</p><div class="m-actions"><button id="mc">إلغاء</button><button class="danger" id="mo">حذف الفولدر</button></div>`);
    $('#modal h3').textContent='حذف «'+f.name+'»؟';
    $('#mc').onclick=closeModal;
    $('#mo').onclick=()=>{
      state.recs=state.recs.filter(r=>{ if(r.folderId!==f.id)return true; if(base){r.folderId=base.id;return true} URL.revokeObjectURL(r.url); deleteBlob(r.id).catch(()=>{}); return false });
      state.folders=state.folders.filter(x=>x.id!==f.id); closeModal(); show('files');
    };
  };
}
function recOptions(id){
  const r=state.recs.find(x=>x.id===id);
  openModal(`<h3></h3><button class="opt" id="o1">${ico('edit')}إعادة تسمية</button><button class="opt" id="o2">${ico('folder')}نقل إلى فولدر</button><button class="opt" id="o3">${ico('dl')}حفظ / مشاركة الملف</button><button class="opt danger" id="o4">${ico('del')}حذف التسجيل</button>`);
  $('#modal h3').textContent=r.name;
  $('#o1').onclick=()=>{closeModal();askText('اسم التسجيل',r.name,v=>{r.name=v;render();if(state.playing===id)$('#pTitle').textContent=v})};
  $('#o2').onclick=()=>moveRec(id);
  $('#o3').onclick=()=>{closeModal();const a=document.createElement('a');a.href=r.url;a.download=r.name+(r.ext||'.webm');a.click()};
  $('#o4').onclick=()=>{
    openModal(`<h3>حذف التسجيل؟</h3><p style="color:var(--muted)">مش هتقدر ترجّعه بعد كده.</p><div class="m-actions"><button id="mc">إلغاء</button><button class="danger" id="mo">حذف</button></div>`);
    $('#mc').onclick=closeModal;
    $('#mo').onclick=()=>{if(state.playing===id)closePlayer();URL.revokeObjectURL(r.url);deleteBlob(id).catch(()=>{});state.recs=state.recs.filter(x=>x.id!==id);closeModal();render();toast('اتحذف')};
  };
}
function moveRec(id){
  const r=state.recs.find(x=>x.id===id);
  openModal(`<h3>نقل إلى</h3><div id="fl"></div><button class="opt" id="nf" style="color:var(--b)">+ فولدر جديد</button>`);
  state.folders.forEach(f=>{const b=document.createElement('button');b.className='opt';b.innerHTML=ico('folder')+'<span></span>'+(r.folderId===f.id?'<span style="margin-right:auto;color:var(--g)">✓</span>':'');
    b.querySelector('span').textContent=f.name;b.onclick=()=>{r.folderId=f.id;closeModal();render();toast('اتنقل إلى «'+f.name+'»')};$('#fl').appendChild(b)});
  $('#nf').onclick=()=>{closeModal();askText('فولدر جديد','',v=>{const f={id:nid(),name:v};state.folders.push(f);r.folderId=f.id;render();toast('اتنقل إلى «'+v+'»')})};
}

/* ---------- save block (after recording) ---------- */
function openSave(blob,dur,ext,marks){
  let name='تسجيل '+(state.recs.length+1);
  let fid=state.folders.find(f=>f.id===state.lastFolder)?state.lastFolder:(state.folders[0]||{}).id;
  let adding=!state.folders.length;
  modalLock=true;
  const draw=()=>{
    openModal(`<h3>حفظ التسجيل · ${fmt(dur)}</h3>
      <label class="lbl" for="sn">هسمّي التسجيل إيه؟</label><input type="text" id="sn" maxlength="60">
      <label class="lbl">أخزنه في أنهي فولدر؟</label><div class="chips" id="sc"></div>
      <div class="nf-row ${adding?'':'hidden'}" id="nfw"><input type="text" id="nfi" placeholder="اسم الفولدر الجديد" maxlength="40"><button id="nfa">إضافة</button></div>
      <div class="m-actions"><button id="sd">تجاهل التسجيل</button><button class="pri" id="ss">حفظ</button></div>`);
    $('#sn').value=name; $('#sn').oninput=e=>name=e.target.value;
    const sc=$('#sc');
    state.folders.forEach(f=>{const c=document.createElement('button');c.className='chip'+(f.id===fid?' on':'');c.textContent=f.name;
      c.onclick=()=>{fid=f.id;sc.querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));c.classList.add('on')};sc.appendChild(c)});
    const add=document.createElement('button');add.className='chip add';add.textContent='+ فولدر جديد';add.onclick=()=>{adding=!adding;$('#nfw').classList.toggle('hidden',!adding);if(adding)$('#nfi').focus()};sc.appendChild(add);
    $('#nfa').onclick=()=>{const v=$('#nfi').value.trim();if(!v)return;const f={id:nid(),name:v};state.folders.push(f);fid=f.id;adding=false;draw()};
    $('#sd').onclick=()=>{URL.revokeObjectURL(blob);closeModal();toast('اتجاهل التسجيل');show('home')};
    $('#ss').onclick=async()=>{
      if(!fid){toast('اختار فولدر الأول');return}
      if(saving)return; saving=true;
      const n=(name||'').trim()||('تسجيل '+(state.recs.length+1)), id=nid();
      try{await putBlob(id,blob)}
      catch(e){saving=false;toast('ما قدرناش نحفظ التسجيل. تأكد إن فيه مساحة فاضية');return}
      state.recs.push({id,name:n,folderId:fid,blob,url:URL.createObjectURL(blob),dur,date:new Date(),ext,markers:(marks||[])});
      state.lastFolder=fid; saving=false; closeModal(); show('home'); toast('اتحفظ «'+n+'» في «'+folderName(fid)+'»');
    };
  };
  draw();
}

/* ---------- recording (browser: MediaRecorder · Android: capacitor-voice-recorder) ---------- */
let mr=null,chunks=[],stream=null,actx=null,analyser=null,rafR=null,t0=0,acc=0,paused=false,tickI=null,cancelled=false,busy=false,stopping=false;
const wave=$('#wave'), wctx=wave.getContext('2d');
function fitCanvas(c){const r=c.getBoundingClientRect();c.width=r.width*devicePixelRatio;c.height=r.height*devicePixelRatio}
function idleWave(){fitCanvas(wave);const w=wave.width,h=wave.height;wctx.clearRect(0,0,w,h);wctx.fillStyle=css('--line');for(let x=0;x<w;x+=9*devicePixelRatio)wctx.fillRect(x,h/2-1,4*devicePixelRatio,2*devicePixelRatio)}
function setRecUI(on){
  $('#rpBody').classList.toggle('recording',on); $('#rpRow').classList.toggle('hidden',!on);
  $('#rpState').textContent=on?'بيسجّل…':'اضغط على المايك عشان تبدأ';
  if(!on){$('#timer').textContent='00:00';$('#micGlow').style.setProperty('--lvl',0);$('#pauseIco').innerHTML=ICON.pause;idleWave()}
}
function nativeErr(e){
  const c=(e&&e.code)||'';
  if(c==='MISSING_PERMISSION') return 'لازم تسمح للتطبيق باستخدام المايك';
  if(c==='MICROPHONE_BEING_USED') return 'المايك مستخدم من تطبيق تاني';
  if(c==='ALREADY_RECORDING') return 'فيه تسجيل شغال بالفعل';
  if(c==='NOT_SUPPORTED_OS_VERSION') return 'الإيقاف المؤقت مش مدعوم على نسخة الأندرويد دي';
  if(c==='EMPTY_RECORDING') return 'وقفت التسجيل بدري قوي، مفيش صوت يتحفظ';
  return 'حصلت مشكلة في التسجيل'+(e&&e.message?': '+e.message:'');
}
async function ensureMicPermission(){
  if(!isNative) return true; // the browser asks for the mic itself in getUserMedia
  try{
    let p=await AudioRecorder.checkPermissions();
    if(p.microphone==='granted') return true;
    p=await AudioRecorder.requestPermissions();
    return p.microphone==='granted';
  }catch(e){return false}
}
function beginUI(){
  busy=true; stopping=false; cancelled=false; acc=0; t0=Date.now(); paused=false; recMarks=[]; renderRecMarks(); setRecUI(true);
  tickI=setInterval(()=>{$('#timer').textContent=fmtT(acc+(paused?0:(Date.now()-t0))/1000)},200);
  loopWave();
}
function endUI(){
  clearInterval(tickI); tickI=null;
  if(rafR){cancelAnimationFrame(rafR); rafR=null}
  busy=false; stopping=false; paused=false; setRecUI(false);
}
function afterRecord(blob,dur,ext){
  const mk=recMarks.slice(); recMarks=[]; renderRecMarks(); openSave(blob,dur,ext,mk);
}
async function startRec(){
  if(busy) return;
  if(!(await ensureMicPermission())){toast('لازم تسمح باستخدام المايك عشان تقدر تسجّل');return}
  if(isNative) return startNative();
  return startWeb();
}
async function startWeb(){
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:state.denoise,echoCancellation:state.denoise,autoGainControl:state.denoise,channelCount:1,sampleRate:48000}})}
  catch(e){toast('لازم تسمح باستخدام المايك من إعدادات المتصفح');return}
  try{
    actx=new (window.AudioContext||window.webkitAudioContext)();
    const src=actx.createMediaStreamSource(stream); analyser=actx.createAnalyser(); analyser.fftSize=256; src.connect(analyser);
    chunks=[]; mr=new MediaRecorder(stream,recOpts());
    mr.ondataavailable=e=>e.data.size&&chunks.push(e.data);
    mr.onstop=onWebStopped;
    mr.start(250);
  }catch(e){
    stream.getTracks().forEach(t=>t.stop()); stream=null; if(actx) actx.close(); actx=null; analyser=null; mr=null;
    toast('المتصفح مش قادر يبدأ التسجيل'); return;
  }
  beginUI();
}
async function startNative(){
  try{await AudioRecorder.start()}
  catch(e){toast(nativeErr(e));return}
  beginUI();
}
function loopWave(){
  const buf=analyser?new Uint8Array(analyser.frequencyBinCount):null,bars=56,hist=[];
  (function f(){
    rafR=requestAnimationFrame(f); if(paused)return;
    let m;
    if(analyser){analyser.getByteTimeDomainData(buf); m=0; for(const v of buf)m=Math.max(m,Math.abs(v-128)); m/=128}
    else m=0.12+Math.random()*0.2; // native: no live level feed from the plugin, show a gentle animation
    $('#micGlow').style.setProperty('--lvl',Math.min(1,m*1.6)); hist.push(m); if(hist.length>bars)hist.shift();
    fitCanvas(wave); const w=wave.width,h=wave.height,bw=w/bars; wctx.clearRect(0,0,w,h);
    const g=wctx.createLinearGradient(0,0,w,0); g.addColorStop(0,css('--p')); g.addColorStop(.5,css('--b')); g.addColorStop(1,css('--g')); wctx.fillStyle=g;
    wctx.shadowColor=css('--g'); wctx.shadowBlur=8*devicePixelRatio;
    hist.forEach((v,i)=>{const bh=Math.max(3*devicePixelRatio,v*h*.95);wctx.fillRect(w-(hist.length-i)*bw,(h-bh)/2,bw*.6,bh)});
  })();
}
async function pauseResume(){
  if(!busy||stopping)return;
  try{
    if(!paused){
      if(isNative) await AudioRecorder.pause(); else mr.pause();
      acc+=Date.now()-t0; paused=true; $('#pauseIco').innerHTML=ICON.play; $('#rpState').textContent='متوقف مؤقتاً';
    }else{
      if(isNative) await AudioRecorder.resume(); else mr.resume();
      t0=Date.now(); paused=false; $('#pauseIco').innerHTML=ICON.pause; $('#rpState').textContent='بيسجّل…';
    }
  }catch(e){toast(nativeErr(e))}
}
function stopRec(){
  if(!busy||stopping)return;
  stopping=true;
  if(!paused) acc+=Date.now()-t0;
  paused=true; // freeze the timer while we finish up
  if(isNative){finishNative();return}
  if(mr&&mr.state!=='inactive') mr.stop(); else {endUI()}
}
function onWebStopped(){
  const dur=acc/1000, blob=new Blob(chunks,{type:mr.mimeType||'audio/webm'}), ext=extFor(blob.type);
  if(stream) stream.getTracks().forEach(t=>t.stop());
  if(actx) actx.close();
  stream=null; actx=null; analyser=null; mr=null;
  endUI();
  if(cancelled){recMarks=[];renderRecMarks();toast('اتلغى التسجيل');return}
  afterRecord(blob,dur,ext);
}
async function finishNative(){
  let res;
  try{res=await AudioRecorder.stop()}
  catch(e){endUI();toast(nativeErr(e));return}
  const path=res.value.path;
  if(cancelled){endUI();removeTmp(path);recMarks=[];renderRecMarks();toast('اتلغى التسجيل');return}
  try{
    const blob=await (await fetch(Capacitor.convertFileSrc(path))).blob();
    const dur=res.value.msDuration?res.value.msDuration/1000:acc/1000;
    const ext=extFor(res.value.mimeType||blob.type);
    removeTmp(path);
    endUI();
    afterRecord(blob,dur,ext);
  }catch(e){endUI();toast('ما قدرناش نقرأ ملف التسجيل')}
}
// Best-effort removal of the plugin's temp file (it lives in the app cache folder).
async function removeTmp(path){
  const i=(path||'').indexOf('rec-tmp/');
  if(i<0) return;
  try{await Filesystem.deleteFile({path:path.slice(i),directory:Directory.Cache})}catch(e){}
}
$('#micBtn').onclick=startRec; $('#stopBtn').onclick=stopRec; $('#pauseBtn').onclick=pauseResume;
$('#cancelBtn').onclick=()=>{if(!busy)return;cancelled=true;stopRec()};

/* ---------- player ---------- */
const audio=new Audio(); audio.preservesPitch=true;
const SPEEDS=[0.5,0.75,1,1.25,1.5,2,3];
let cur=null,peaks=[];
const pw=$('#pwave'),pctx=pw.getContext('2d');
function setSpeed(v){v=Math.min(3,Math.max(.25,+v));audio.playbackRate=v;$('#spVal').textContent=(Math.round(v*100)/100)+'x';$('#spSlider').value=v;document.querySelectorAll('#speeds button').forEach(b=>b.classList.toggle('on',+b.dataset.s===v))}
SPEEDS.forEach(s=>{const b=document.createElement('button');b.textContent=s+'x';b.dataset.s=s;b.onclick=()=>setSpeed(s);$('#speeds').appendChild(b)});
$('#spSlider').oninput=e=>setSpeed(e.target.value);
async function computePeaks(blob){
  try{const ac=new (window.AudioContext||window.webkitAudioContext)();const d=await ac.decodeAudioData(await blob.arrayBuffer());ac.close();
    const ch=d.getChannelData(0),N=90,step=Math.floor(ch.length/N),out=[];
    for(let i=0;i<N;i++){let m=0;for(let j=0;j<step;j+=Math.max(1,step>>6))m=Math.max(m,Math.abs(ch[i*step+j]||0));out.push(m)}
    const mx=Math.max(...out)||1;return out.map(v=>v/mx)}
  catch(e){return Array.from({length:90},(_,i)=>.25+.2*Math.abs(Math.sin(i/4)))}
}
function drawPeaks(){
  fitCanvas(pw);const w=pw.width,h=pw.height;pctx.clearRect(0,0,w,h);
  if(!peaks.length)return;const bw=w/peaks.length,p=audio.duration?audio.currentTime/audio.duration:0;pctx.shadowColor=css('--g');
  peaks.forEach((v,i)=>{const bh=Math.max(4*devicePixelRatio,v*h*.85),played=(1-(i+.5)/peaks.length)<=p;
    pctx.fillStyle=played?css('--g'):'#34306a';pctx.shadowBlur=played?8*devicePixelRatio:0;pctx.fillRect(i*bw+bw*.18,(h-bh)/2,bw*.64,bh)});
  const dd=(cur&&cur.dur)||audio.duration||0;
  if(cur&&cur.markers&&dd){pctx.fillStyle=css('--b');pctx.shadowColor=css('--b');pctx.shadowBlur=8*devicePixelRatio;
    cur.markers.forEach(m=>{const x=w*(1-Math.min(1,m.t/dd));pctx.fillRect(x-devicePixelRatio,0,2*devicePixelRatio,h);pctx.beginPath();pctx.arc(x,6*devicePixelRatio,5*devicePixelRatio,0,7);pctx.fill()})}
}
async function openPlayer(id){
  const r=state.recs.find(x=>x.id===id);cur=r;state.playing=id;
  $('#pTitle').textContent=r.name;$('#pSub').textContent=folderName(r.folderId)+' · '+dateStr(r.date);
  $('#sheet').classList.add('open');audio.src=r.url;setSpeed(audio.playbackRate||1);audio.preservesPitch=$('#pitchBtn').classList.contains('on');
  peaks=[];drawPeaks();audio.play().catch(()=>{});renderList();renderMarks();
  peaks=await computePeaks(r.blob);drawPeaks();
}
function closePlayer(){audio.pause();$('#sheet').classList.remove('open');state.playing=null;cur=null;render()}
$('#closeP').onclick=closePlayer; $('#moreP').onclick=()=>cur&&recOptions(cur.id);
$('#pp').onclick=()=>audio.paused?audio.play():audio.pause();
$('#back10').onclick=()=>audio.currentTime=Math.max(0,audio.currentTime-10);
$('#fwd10').onclick=()=>audio.currentTime=Math.min(audio.duration||0,audio.currentTime+10);
audio.onplay=()=>$('#ppIco').innerHTML=ICON.pause; audio.onpause=()=>$('#ppIco').innerHTML=ICON.play;
audio.ontimeupdate=()=>{const d=(cur&&cur.dur)||audio.duration||0;$('#tCur').textContent=fmt(audio.currentTime);$('#tDur').textContent=fmt(d);$('#seek').value=d?Math.min(1000,audio.currentTime/d*1000):0;drawPeaks()};
$('#seek').oninput=e=>{const d=(cur&&cur.dur)||audio.duration||0;audio.currentTime=e.target.value/1000*d};
$('#loopBtn').onclick=e=>{audio.loop=!audio.loop;e.currentTarget.classList.toggle('on',audio.loop)};
$('#pitchBtn').onclick=e=>{const on=!e.currentTarget.classList.contains('on');e.currentTarget.classList.toggle('on',on);audio.preservesPitch=on};
pw.onclick=e=>{const r=pw.getBoundingClientRect(),x=1-(e.clientX-r.left)/r.width,d=(cur&&cur.dur)||audio.duration||0;audio.currentTime=x*d};

/* ---------- markers ---------- */
let recMarks=[];
function recTime(){return (acc+(paused?0:(Date.now()-t0)))/1000}
function renderRecMarks(){
  const el=$('#recMarks'); el.innerHTML='';
  el.classList.toggle('hidden',!recMarks.length);
  recMarks.forEach(m=>{
    const b=document.createElement('button'); b.className='mchip'; b.textContent='⚑ '+fmt(m.t)+' · '+m.name;
    b.onclick=()=>askText('اسم العلامة',m.name,v=>{m.name=v;renderRecMarks()});
    el.appendChild(b);
  });
  el.scrollLeft=-el.scrollWidth;
}
$('#flagBtn').onclick=()=>{
  if(!busy)return;
  const m={id:nid(),t:recTime(),name:'علامة '+(recMarks.length+1)};
  recMarks.push(m); renderRecMarks();
  if(navigator.vibrate)navigator.vibrate(30);
  toast('علامة عند '+fmt(m.t)+' · اضغط عليها لتسميتها');
};
function renderMarks(){
  const el=$('#mkList'); el.innerHTML='';
  if(!cur)return;
  const ms=(cur.markers||[]).slice().sort((a,b)=>a.t-b.t);
  if(!ms.length){el.innerHTML='<div class="mk-empty">مفيش علامات. وقّف على الموضع اللي عايزه واضغط «+ علامة هنا».</div>';return}
  ms.forEach(m=>{
    const row=document.createElement('div'); row.className='mk-row';
    row.innerHTML='<button class="jump"><span class="mk-t"></span><span class="mk-n"></span></button><button class="more" aria-label="خيارات العلامة">⋮</button>';
    row.querySelector('.mk-t').textContent=fmt(m.t); row.querySelector('.mk-n').textContent=m.name;
    row.querySelector('.jump').onclick=()=>{audio.currentTime=m.t;audio.play().catch(()=>{})};
    row.querySelector('.more').onclick=()=>markOptions(m);
    el.appendChild(row);
  });
}
function markOptions(m){
  openModal(`<h3></h3><button class="opt" id="k1">${ico('edit')}إعادة تسمية العلامة</button><button class="opt danger" id="k2">${ico('del')}حذف العلامة</button>`);
  $('#modal h3').textContent=fmt(m.t)+' · '+m.name;
  $('#k1').onclick=()=>{closeModal();askText('اسم العلامة',m.name,v=>{m.name=v;renderMarks()})};
  $('#k2').onclick=()=>{cur.markers=cur.markers.filter(x=>x!==m);closeModal();renderMarks();drawPeaks();toast('اتحذفت العلامة')};
}
$('#addMk').onclick=()=>{
  if(!cur)return;
  cur.markers=cur.markers||[];
  const m={id:nid(),t:audio.currentTime,name:'علامة '+(cur.markers.length+1)};
  cur.markers.push(m); renderMarks(); drawPeaks(); render();
  askText('اسم العلامة عند '+fmt(m.t),m.name,v=>{m.name=v;renderMarks()});
};

/* ---------- recording quality ---------- */
function extFor(t){return /mp4|m4a|aac/.test(t||'')?'.m4a':/wav/.test(t||'')?'.wav':'.webm'}
function recOpts(){
  const o={audioBitsPerSecond:state.quality==='m4a-mid'?128000:256000};
  const types=['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm'];
  const mt=window.MediaRecorder&&MediaRecorder.isTypeSupported?types.find(t=>MediaRecorder.isTypeSupported(t)):null;
  if(mt)o.mimeType=mt; return o;
}

/* ---------- settings screen ---------- */
const QUALS=[
  ['m4a-mid','M4A متوسطة','حوالي 1 ميجا للدقيقة'],
  ['m4a-high','M4A عالية (الافتراضي)','حوالي 2 ميجا للدقيقة، صوت واضح جداً'],
  ['wav','WAV بدون ضغط','حوالي 5.7 ميجا للدقيقة، أعلى وضوح وأكبر حجم']
];
function renderSettings(){
  const q=$('#qOpts'); q.innerHTML='';
  QUALS.forEach(([id,t,s])=>{
    const b=document.createElement('button'); b.className='optrow'+(state.quality===id?' on':'');
    b.innerHTML='<span class="dot"></span><span class="ot"><b></b><small></small></span>';
    b.querySelector('b').textContent=t; b.querySelector('small').textContent=s;
    b.onclick=()=>{state.quality=id;renderSettings()}; q.appendChild(b);
  });
  $('#nsSw').classList.toggle('on',state.denoise);
  $('#qOpts').classList.toggle('hidden',isNative);
  $('#nsRow').classList.toggle('hidden',isNative);
  $('#qDesc').textContent=isNative?'على الموبايل التسجيل بيتعمل بصيغة M4A (AAC) بجودة ثابتة وواضحة.':'الأعلى جودة أوضح وأكبر حجماً. الصيغة بتتحدد حسب المتصفح.';
  $('#shBtn').classList.toggle('hidden',isNative);
  $('#exTxt').textContent=isNative?'مشاركة / حفظ النسخة':'تصدير نسخة (ZIP)';
  const mb=state.recs.reduce((a,r)=>a+(r.blob?r.blob.size:0),0)/1048576;
  $('#stRec').textContent=state.recs.length; $('#stFol').textContent=state.folders.length; $('#stMb').textContent=mb<10?mb.toFixed(1):Math.round(mb);
  const lb=$('#lastBk');
  if(state.lastBackup){lb.textContent='آخر نسخة: '+dateStr(state.lastBackup);lb.className='desc'}
  else if(state.recs.length){lb.textContent='لسه ماعملتش نسخة احتياطية. النسخة هي الأمان الوحيد لو التطبيق اتحذف.';lb.className='desc warn'}
  else{lb.textContent='مفيش تسجيلات لسه.';lb.className='desc'}
}
$('#nsRow').onclick=()=>{state.denoise=!state.denoise;renderSettings()};
$('#gearBtn').onclick=()=>show('settings');
$('#sBack').onclick=()=>show('home');

/* ---------- export / import ---------- */
const bkName=()=>'recorder-backup-'+new Date().toISOString().slice(0,10)+'.zip';
async function buildZip(){
  if(!state.recs.length){toast('مفيش تسجيلات تتصدّر لسه');return null}
  const manifest={app:'recorder',version:1,exportedAt:new Date().toISOString(),folders:state.folders.map(f=>({id:f.id,name:f.name})),recordings:[]};
  const files=[];
  for(const r of state.recs){
    const ext=r.ext||'.webm',fn='audio/'+r.id+ext;
    manifest.recordings.push({id:r.id,name:r.name,folderId:r.folderId,dur:r.dur,date:r.date.toISOString(),file:fn,ext,markers:r.markers||[]});
    files.push([fn,new Uint8Array(await r.blob.arrayBuffer())]);
  }
  files.unshift(['manifest.json',new TextEncoder().encode(JSON.stringify(manifest,null,1))]);
  return new Blob(zipStore(files),{type:'application/zip'});
}
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(String(fr.result).split(',')[1]);
    fr.onerror=()=>reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
// Android: write the backup to the app cache and open the system share sheet
// (lets the user save it to Drive, Files, email, etc.).
async function shareBackup(blob,name){
  const written=await Filesystem.writeFile({path:name,data:await blobToBase64(blob),directory:Directory.Cache,recursive:true});
  await Share.share({title:'نسخة احتياطية - A.R صوتي',dialogTitle:'حفظ النسخة',files:[written.uri]});
}
$('#exBtn').onclick=async()=>{
  const b=await buildZip(); if(!b)return;
  try{
    if(isNative) await shareBackup(b,bkName());
    else{
      const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=bkName(); a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    }
  }catch(e){ if(isNative){toast('ما اتصدّرتش النسخة');return} }
  state.lastBackup=new Date(); render(); toast('اتصدّرت النسخة');
};
$('#shBtn').onclick=async()=>{
  const b=await buildZip(); if(!b)return;
  const f=new File([b],bkName(),{type:'application/zip'});
  if(navigator.canShare&&navigator.canShare({files:[f]})){
    try{await navigator.share({files:[f],title:'نسخة احتياطية - A.R صوتي'});state.lastBackup=new Date();render()}catch(e){}
  }else toast('المشاركة مش مدعومة هنا. استخدم «تصدير» وارفع الملف على درايف');
};
$('#imBtn').onclick=()=>$('#imFile').click();
$('#imFile').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)importZip(f)};
async function importZip(file){
  try{
    const files=zipRead(new Uint8Array(await file.arrayBuffer()));
    if(!files['manifest.json']) throw new Error('manifest');
    const m=JSON.parse(new TextDecoder().decode(files['manifest.json']));
    if(m.app!=='recorder')throw new Error('app');
    const fmap={}; let nf=0,nr=0;
    for(const f of (m.folders||[])){let ex=state.folders.find(x=>x.name===f.name);if(!ex){ex={id:nid(),name:f.name};state.folders.push(ex);nf++}fmap[f.id]=ex.id}
    const fallback=state.folders[0].id; // there is always at least one folder
    for(const r of (m.recordings||[])){
      if(state.recs.some(x=>x.id===r.id)||!files[r.file])continue;
      const mime=r.ext==='.m4a'?'audio/mp4':r.ext==='.wav'?'audio/wav':'audio/webm';
      const blob=new Blob([files[r.file]],{type:mime});
      await putBlob(r.id,blob);
      const d=new Date(r.date); 
      state.recs.push({id:r.id,name:r.name,folderId:fmap[r.folderId]||fallback,blob,url:URL.createObjectURL(blob),dur:r.dur,date:isNaN(d)?new Date():d,ext:r.ext,markers:r.markers||[]});nr++;
    }
    render();
    toast(nr||nf?`اتستورد ${nr} تسجيل و${nf} فولدر جديد`:'كل التسجيلات دي موجودة بالفعل');
  }catch(e){toast('الملف ده مش نسخة من التطبيق')}
}

/* ---------- Android: hardware back button ---------- */
async function setupNative(){
  if(!isNative) return;
  await CapApp.addListener('backButton',()=>{
    if($('#sheet').classList.contains('open')){closePlayer();return}
    if($('#scrim').classList.contains('open')){if(!modalLock)closeModal();return}
    if(busy){toast('أنهِ التسجيل أو الغيه الأول');return}
    const up={recpage:'home',files:'home',fview:'files',settings:'home'}[state.screen];
    if(up) show(up); else CapApp.exitApp();
  });
}

/* ---------- init ---------- */
async function init(){
  // If loading the saved state fails, the app still opens; saving stays disabled so nothing is overwritten.
  try{await hydrate()}catch(e){console.error('Could not load saved recordings',e)}
  await setupNative();
  render(); idleWave();
}
init();
