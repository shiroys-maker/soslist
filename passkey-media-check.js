const ORIGIN='https://soslist.niraissc.jp',API='https://access.soslist.niraissc.jp',P='sos-list-4d150',RUN='soslist_bridge_accept_20261102_v1',IDS=[RUN,'dailyBrief_1899-12-30'];
const MARKER='soslist.media.check.pending.v1',LOCK='soslist.bridge.check.operation.v1';
const fail=()=>{throw Error('CHECK_NOT_CONFIRMED');};
export function validateUser(user,expected,result){const c=result?.claims;if(!user||!expected||expected.role!=='admin'||user.uid!==expected.uid||!c||c.aud!==P||c.iss!=='https://securetoken.google.com/'+P||c.firebase?.sign_in_provider!=='custom'||c.bridgeSubject!==expected.subjectDigest||c.bridgeSession!==expected.sid||c.bridgeGeneration!==expected.generation||c.bridgeRole!==expected.role)fail();}
export function createAcceptance({api,sdk,document:doc,media,storage,withLock,show=()=>{},clear=()=>{},onChange=()=>{}}){
 let phase='idle',epoch=0,attempted=false,ending,signing,oldToken,owner;
 const checks={connected:false,documents:false,updated:false,pdf:false,audio:false,ranges:false,ended:false,oldDenied:false,refreshDenied:false,mediaDenied:false,signedOut:false};
 const state=()=>({phase,...checks}),emit=p=>{phase=p;onChange(state());},current=e=>{if(e!==epoch||phase!=='running'||storage.getItem(MARKER)!==owner)fail();};
 const mark=()=>{if(!storage.getItem(MARKER))storage.setItem(MARKER,'pending');if(!storage.getItem(MARKER))fail();};
 async function localOut(){if(signing)try{await signing;}catch{}await sdk.signOut();if(sdk.currentUser!==null)fail();checks.signedOut=true;}
 async function finish(prove){
 ++epoch;emit('ending');clear();let markerOK=true;try{mark();}catch{markerOK=false;}
 let server=false;try{const r=await api('end',true);server=r.status===200&&r.body?.ended===true;checks.ended=server;
 if(server&&prove&&oldToken&&sdk.currentUser){
  const denied=async token=>{const a=await doc('GET',IDS[0],token),b=await doc('PATCH',IDS[0],token,{isReceived:true});return a.status===403&&a.body?.error?.status==='PERMISSION_DENIED'&&b.status===403&&b.body?.error?.status==='PERMISSION_DENIED';};
  checks.oldDenied=await denied(oldToken);
  // Refresh is requested before local sign-out; a refresh failure is not proof of Firestore denial.
  let refreshed;try{refreshed=await sdk.currentUser.getIdToken(true);checks.refreshDenied=refreshed!==oldToken&&await denied(refreshed);}finally{refreshed=undefined;}
  const p=await media(IDS[0],'pdf',null,true),a=await media(IDS[1],'summary-audio',null,true);checks.mediaDenied=p.status===403&&a.status===403;
 }
 }catch{}finally{oldToken=undefined;try{await localOut();}catch{}}
 if(server&&checks.signedOut&&markerOK){try{const r=await api('inspect');if(r.status!==401)fail();storage.removeItem(MARKER);if(storage.getItem(MARKER)!==null)fail();emit('done');}catch{emit('pending');}}else emit('pending');return state();
 }
 const client={state,initialize(){try{const probe=MARKER+'.probe';storage.setItem(probe,'1');if(storage.getItem(probe)!=='1')fail();storage.removeItem(probe);emit(storage.getItem(MARKER)?'pending':'idle');}catch{emit('blocked');}return state();},async start(){
 if(phase!=='idle'||attempted)return state();attempted=true;const e=++epoch;emit('running');
 try{await withLock(async()=>{
 if(storage.getItem(MARKER)!==null)fail();owner='pending.'+crypto.randomUUID();storage.setItem(MARKER,owner);current(e);await sdk.signOut();current(e);
 let r=await api('exchange');current(e);if(r.status!==200||typeof r.body?.customToken!=='string'||r.body.customToken.length>16384)fail();const expected={...r.body.identity};signing=sdk.signIn(r.body.customToken);r=undefined;const signed=await signing.finally(()=>signing=undefined);current(e);validateUser(signed?.user,expected,await signed.user.getIdTokenResult());current(e);oldToken=await signed.user.getIdToken();current(e);checks.connected=true;
 for(const id of IDS){const d=await doc('GET',id,oldToken);current(e);if(d.status!==200||d.body?.fields?.acceptanceRunId?.stringValue!==RUN||d.body?.fields?.synthetic?.booleanValue!==true)fail();}checks.documents=true;
 const changed=await doc('PATCH',IDS[0],oldToken,{isReceived:true});current(e);if(changed.status!==200||changed.body?.fields?.isReceived?.booleanValue!==true)fail();checks.updated=true;
 const blobs={};for(const [id,kind,name] of [[IDS[0],'pdf','pdf'],[IDS[1],'summary-audio','audio']]){
 const full=await media(id,kind);current(e);if(full.status!==200||!full.bytes?.length||full.bytes.length>1048576||full.length!==full.bytes.length||!/^"g[0-9]+"$/.test(full.etag)||full.cache!=='private, no-store')fail();
 const partial=await media(id,kind,{range:'bytes=0-15','if-range':full.etag});current(e);if(partial.status!==206||partial.bytes.length!==16||partial.range!==`bytes 0-15/${full.bytes.length}`||!partial.bytes.every((v,i)=>v===full.bytes[i]))fail();
 const bad=await media(id,kind,{range:'bytes=1048576-'});current(e);if(bad.status!==416||bad.bytes.length!==0||bad.range!==`bytes */${full.bytes.length}`)fail();
 const changedRange=await media(id,kind,{range:'bytes=0-15','if-range':'"g0"'});current(e);if(changedRange.status!==200||changedRange.bytes.length!==full.bytes.length)fail();
 blobs[name]=full.bytes;checks[name]=true;
 }checks.ranges=true;show(blobs);emit('active');
 });}catch{if(e===epoch)await client.end(false);else try{await localOut();}catch{}}return state();},
 end(prove=true){if(ending)return ending;if(phase==='done')return Promise.resolve(state());ending=finish(prove).finally(()=>ending=undefined);return ending;},
 leave(){if(['running','active','ending','pending'].includes(phase))void client.end(false);},
 observe(){if(['running','active'].includes(phase)&&storage.getItem(MARKER)!==owner)client.leave();}
 };return Object.freeze(client);
}
async function request(url,options={},max=32768){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),28000);try{const r=await fetch(url,{...options,signal:controller.signal,redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});const reader=r.body?.getReader();let size=0,parts=[];if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail();}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return {r,bytes};}finally{clearTimeout(timer);}}
async function browserSDK(){const [{initializeApp},{initializeAuth,inMemoryPersistence,signInWithCustomToken,signOut}]=await Promise.all([import('https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js'),import('https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js')]);const app=initializeApp({apiKey:'AIzaSyBIkxaIgnjkrOYfx3oyA0BGX5dubL5QhvI',authDomain:P+'.firebaseapp.com',projectId:P,appId:'1:455081821929:web:da87d8dd1f16bbe99e9278'},'soslist-media-check'),auth=initializeAuth(app,{persistence:inMemoryPersistence});return{get currentUser(){return auth.currentUser;},signIn:t=>signInWithCustomToken(auth,t),signOut:()=>signOut(auth)};}
export async function mount(doc=document){
 const status=doc.getElementById('status'),result=doc.getElementById('result'),start=doc.getElementById('start'),end=doc.getElementById('end');
 const labels={connected:'接続',documents:'架空2文書の読取',updated:'架空文書の限定更新',pdf:'架空PDF',audio:'無音音声',ranges:'範囲取得・版確認',ended:'利用終了',oldDenied:'終了前と同じ資格で読取・更新拒否',refreshDenied:'更新した資格で読取・更新拒否',mediaDenied:'終了後の新規資料取得拒否',signedOut:'この試験の端末内ログアウト'};
 const messages={idle:'パスキーログイン後、「2. 架空資料の接続確認」を押してください。',running:'架空データと資料を確認しています。このままお待ちください。',active:'資料確認が済みました。PDF・音声を確認して「3. 利用終了」を押してください。',ending:'利用終了と古い資格の拒否を確認しています。',done:'利用終了しました。下の結果だけをお知らせください。未確認の項目は成功扱いにしません。',pending:'終了を確定できません。「終了を再確認」を押してください。再ログインはしないでください。',blocked:'このブラウザでは試験を開始できません。Safariで開いてください。'};
 const render=s=>{status.textContent=messages[s.phase];start.disabled=s.phase!=='idle';end.disabled=!['active','running','pending'].includes(s.phase);end.textContent=s.phase==='pending'?'終了を再確認':'3. 利用終了・古い資格の拒否確認';doc.getElementById('login').hidden=!['idle','blocked'].includes(s.phase);result.textContent='確認版 MA1\n'+Object.entries(labels).map(([k,v])=>v+'：'+(s[k]?'確認済み':'未確認')).join('\n');};
 if(location.origin!==ORIGIN||!navigator.locks?.request){render({phase:'blocked'});return;}
 let urls=[],client;const clear=()=>{doc.getElementById('audio').pause();doc.getElementById('audio').removeAttribute('src');doc.getElementById('audio').load();doc.getElementById('pdf').removeAttribute('src');doc.getElementById('media').hidden=true;for(const u of urls)URL.revokeObjectURL(u);urls=[];};
 try{const sdk=await browserSDK();client=createAcceptance({sdk,storage:localStorage,withLock:fn=>navigator.locks.request(LOCK,{mode:'exclusive'},fn),onChange:render,clear,
 api:async(op,keepalive=false)=>{if(!['exchange','inspect','end'].includes(op))fail();const {r,bytes}=await request(API+'/api/bridge/'+op,{method:'POST',headers:{'content-type':'application/json'},body:'{}',credentials:'include',keepalive});return{status:r.status,body:JSON.parse(new TextDecoder().decode(bytes))};},
 document:async(method,id,token,patch)=>{if(!IDS.includes(id)||!['GET','PATCH'].includes(method)||typeof token!=='string')fail();const url='https://firestore.googleapis.com/v1/projects/'+P+'/databases/(default)/documents/appointments/'+id+(method==='PATCH'?'?updateMask.fieldPaths=isReceived':'');if(method==='PATCH'&&(id!==IDS[0]||patch?.isReceived!==true||Object.keys(patch).length!==1))fail();const {r,bytes}=await request(url,{method,headers:{authorization:'Bearer '+token,...(method==='PATCH'?{'content-type':'application/json'}:{})},...(method==='PATCH'?{body:JSON.stringify({fields:{isReceived:{booleanValue:true}}})}:{}),credentials:'omit'});return{status:r.status,body:JSON.parse(new TextDecoder().decode(bytes))};},
 media:async(id,kind,headers)=>{if(!IDS.includes(id)||kind!==(id===IDS[0]?'pdf':'summary-audio'))fail();const {r,bytes}=await request(API+'/api/patient/file?id='+id+'&kind='+kind,{method:'GET',headers:headers??{},credentials:'include'},1048576);return{status:r.status,bytes,length:Number(r.headers.get('content-length')),etag:r.headers.get('etag'),range:r.headers.get('content-range'),cache:r.headers.get('cache-control')};},
 show:blobs=>{clear();for(const [id,type] of [['pdf','application/pdf'],['audio','audio/mpeg']]){const url=URL.createObjectURL(new Blob([blobs[id]],{type}));urls.push(url);doc.getElementById(id).src=url;}doc.getElementById('media').hidden=false;}});
 start.addEventListener('click',()=>void client.start());end.addEventListener('click',()=>void client.end());window.addEventListener('pagehide',()=>client.leave());doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='hidden')client.leave();});window.addEventListener('storage',e=>{if(e.key===MARKER||e.key===null)client.observe();});window.addEventListener('pageshow',e=>{if(e.persisted)client.leave();});client.initialize();
 }catch{render({phase:'blocked'});}
}
if(typeof document!=='undefined')void mount();
