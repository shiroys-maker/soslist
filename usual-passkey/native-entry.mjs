// LOCAL injected seam; importing does not initialize any SDK or perform I/O.
import {createBridgeClient,BRIDGE_GUARD_KEY} from './client.mjs';
import {createFixedMediaTransport} from './media.mjs';
import {teardownPatientUI} from './vendor/adapter.mjs';
const MAIN='https://soslist.niraissc.jp',ACCESS='https://access.soslist.niraissc.jp',AUTH='https://auth.soslist.niraissc.jp/?returnTo=usual-web';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const identityOK=value=>exact(value,['uid','subjectDigest','sid','generation','role'])&&typeof value.uid==='string'&&value.uid.length>0&&value.uid.length<=128&&typeof value.subjectDigest==='string'&&/^[a-f0-9]{64}$/.test(value.subjectDigest)&&typeof value.sid==='string'&&/^session-[a-z0-9-]+$/.test(value.sid)&&Number.isSafeInteger(value.generation)&&value.generation>0&&['admin','staff'].includes(value.role);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function createNativeBridgeAPI({location,fetch:fetcher,timeoutMs=15000}={}){
 if(location?.origin!==MAIN||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)fail('BRIDGE_HTTP_DENIED');
 const call=async(operation,{signal}={})=>{
  const controller=new AbortController();let reader,timer,rejectStop;const stopped=new Promise((_,reject)=>{rejectStop=reject;});
  const abort=()=>{controller.abort();rejectStop(Error('BRIDGE_HTTP_DENIED'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  timer=setTimeout(abort,timeoutMs);timer.unref?.();
  const work=async()=>{
   const target=ACCESS+'/api/bridge/'+operation,response=await fetcher(target,{method:'POST',headers:{'content-type':'application/json'},body:'{}',credentials:'include',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   if(response.status!==200||response.redirected===true||response.type==='opaqueredirect'||(response.url&&response.url!==target)||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers?.get('content-type')??'')||!response.body?.getReader)fail('BRIDGE_HTTP_DENIED');
   reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
   for(;;){const next=await reader.read();if(next.done)break;if(!(next.value instanceof Uint8Array)||(bytes+=next.value.byteLength)>65536)fail('BRIDGE_HTTP_DENIED');text+=decoder.decode(next.value,{stream:true});}
   const result=JSON.parse(text+decoder.decode());
   if(operation==='end'){if(!exact(result,['ended'])||result.ended!==true)fail('BRIDGE_HTTP_DENIED');}
   else if(operation==='exchange'){if(!exact(result,['customToken','identity'])||typeof result.customToken!=='string'||!result.customToken||!identityOK(result.identity))fail('BRIDGE_HTTP_DENIED');}
   else if(!exact(result,['authenticated','identity'])||result.authenticated!==true||!identityOK(result.identity))fail('BRIDGE_HTTP_DENIED');
   return result;
  };
  try{return await Promise.race([work(),stopped]);}catch{fail('BRIDGE_HTTP_DENIED');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}try{reader?.releaseLock();}catch{}}
 };
 return Object.freeze({exchange:input=>call('exchange',input),inspect:input=>call('inspect',input),end:()=>call('end')});
}
export async function createNativeEntry({enabled=false,legacyLoader,appLoader,sdk,firestore,storage,serverTimestamp,guardStorage,withLock,api,media,window,document,fetch:fetcher,allowCServerTimeCompatibility=false}={}){
 if(typeof legacyLoader!=='function')fail('NATIVE_CONFIG_DENIED');if(!enabled){await legacyLoader();return {enabled:false};}
 if(sdk?.appName!=='soslist-passkey'||sdk.persistence!=='session'||sdk.initialAuthReady!==true||firestore?.app?.name!=='soslist-passkey'||storage?.app?.name!=='soslist-passkey'||window?.location?.origin!==MAIN||!['/','/index.html'].includes(window.location.pathname)||typeof appLoader!=='function'||!guardStorage||typeof withLock!=='function'||(allowCServerTimeCompatibility&&typeof serverTimestamp!=='function'))fail('NATIVE_CONFIG_DENIED');
 api??=createNativeBridgeAPI({location:window.location,fetch:fetcher});media??=createFixedMediaTransport({origin:ACCESS,fetch:fetcher});
 const observers=new Set(),listeners=new Set(),urls=new Set(),edits=new Map(),mediaVersions=new Map(),mediaUrls=new Map(),mediaControllers=new Map();let lifecycle,client;
 const current=()=>{try{const capture=client.assertActive();return {uid:capture.identity.uid,email:sdk.currentUser?.email??'パスキー',isPasskey:true};}catch{return null;}};
 const stop=()=>{for(const unsubscribe of [...listeners])unsubscribe();};
 client=createBridgeClient({sdk,api,storage:guardStorage,withLock,
  views:{stop,clear(){for(const controller of mediaControllers.values())controller.abort();mediaControllers.clear();for(const item of edits.values())if(item.button)item.button.disabled=false;edits.clear();lifecycle?.reset?.();teardownPatientUI({document,displayedAppointments:lifecycle?.displayedAppointments,pdfViewer:window.sosPdfViewer,stopConnection:()=>window.sosConnection?.stop(),unsubscribe:()=>lifecycle?.unsubscribe?.()});for(const url of urls)URL.revokeObjectURL(url);urls.clear();mediaUrls.clear();mediaVersions.clear();}},
  broadcast(){try{window.localStorage?.setItem('soslist-bridge-event',String(Date.now()));}catch{}},
  onChange(){for(const callback of observers)callback(current());}
 });
 const capture=()=>client.assertActive(),assert=stamp=>{const now=client.assertActive();if(stamp.signal.aborted||stamp.revision!==now.revision)fail('NATIVE_BLOCKED');};
 const snapshot=(value,stamp)=>new Proxy(value,{get(target,key){assert(stamp);const property=Reflect.get(target,key,target);
  if(key==='docs')return property.map(doc=>snapshot(doc,stamp));if(key==='ref')return wrap(property,stamp);
  if(key==='data')return(...args)=>{assert(stamp);return property.apply(target,args);};
  if(key==='forEach')return callback=>{assert(stamp);return target.forEach(doc=>callback(snapshot(doc,stamp)));};return typeof property==='function'?property.bind(target):property;
 }});
 const wrap=(value,born)=>new Proxy(value,{get(target,key){const property=Reflect.get(target,key,target);
  if(['collection','where','orderBy','limit','doc'].includes(key))return(...args)=>{if(born)assert(born);return wrap(property.apply(target,args),key==='doc'?capture():born);};
  if(key==='get')return async(...args)=>{const stamp=born??capture();assert(stamp);const result=await property.apply(target,args);assert(stamp);return snapshot(result,stamp);};
  if(key==='onSnapshot')return(...args)=>{const stamp=born??capture();assert(stamp);const at=args.findIndex(arg=>typeof arg==='function');if(at<0)fail('NATIVE_CONFIG_DENIED');const callback=args[at];let active=true,raw;const unsubscribe=()=>{active=false;raw?.();listeners.delete(unsubscribe);};listeners.add(unsubscribe);args[at]=result=>{if(active){try{assert(stamp);}catch{return;}callback(snapshot(result,stamp));}};try{raw=property.apply(target,args);}catch{unsubscribe();fail('NATIVE_READ_FAILED');}if(!active)raw?.();return unsubscribe;};
  if(key==='update')return async patch=>{const stamp=born??capture();assert(stamp);let data=patch;
   if(exact(patch.processedAt,['$serverTimestamp'])&&patch.processedAt.$serverTimestamp===true){if(!allowCServerTimeCompatibility)fail('NATIVE_SOURCE_UNWIRED');data={...patch,processedAt:serverTimestamp()};}
   const result=await property.call(target,data);assert(stamp);return result;};
  if(['set','delete','batch','runTransaction'].includes(key))return()=>fail('NATIVE_OPERATION_DENIED');return typeof property==='function'?property.bind(target):property;
 }});
 const entry={enabled:true,native:true,target:'root-web',client,capture,assert,db:wrap(firestore),storage:{ref(){fail('PROTECTED_MEDIA_ONLY');}},
  auth:{get currentUser(){return current();},onAuthStateChanged(callback){observers.add(callback);callback(current());return()=>observers.delete(callback);},signOut:()=>entry.end(),signInWithEmailAndPassword(){fail('LEGACY_ONLY');}},
  gate:{get ready(){return current()!==null;},end:()=>entry.end(),resume:()=>client.resume()},bindUI(value){lifecycle=value;},unsupportedEdit(){fail('READONLY_FIELD');},
  async runEdit({key,button,write,onSuccess=()=>{},onFailure=()=>{}}){
   const stamp=capture();if(typeof key!=='string'||typeof write!=='function')fail('NATIVE_CONFIG_DENIED');
   if(edits.has(key))return {busy:true};const item={button};edits.set(key,item);if(button)button.disabled=true;
   try{const result=await write();assert(stamp);onSuccess(result);return {saved:true};}
   catch{try{assert(stamp);}catch{return {stale:true};}onFailure();return {saved:false};}
   finally{if(edits.get(key)===item){edits.delete(key);if(button)button.disabled=false;}}
  },
  async end(){return client.end();},async completeLogin(){return client.login();},
  async beginPasskeyLogin(){const marker=guardStorage.getItem(BRIDGE_GUARD_KEY);if(marker!==null&&!/^v1\.(login|active|end|ended)\.[A-Za-z0-9_-]{16,64}$/.test(marker))fail('END_PENDING');if(marker?.startsWith('v1.end.')||marker?.startsWith('v1.login.'))fail('END_PENDING');if(sdk.currentUser!==null||marker?.startsWith('v1.active.')){if((await client.end()).phase!=='ended')fail('END_PENDING');}window.location.assign(AUTH);},
  async useLegacy(){await ensureLegacy();window.location.assign('/index.html?auth=legacy');},

  files:{
   cancel(kind){
    mediaVersions.set(kind,Symbol('cancelled'));
    mediaControllers.get(kind)?.abort();mediaControllers.delete(kind);
    const previous=mediaUrls.get(kind);if(previous){URL.revokeObjectURL(previous);urls.delete(previous);mediaUrls.delete(kind);}
   },
   async get(id,kind,{signal}={}){
    const stamp=capture();if(!['pdf','summary-audio'].includes(kind))fail('PROTECTED_MEDIA_ONLY');
    entry.files.cancel(kind);
    const version=Symbol(kind),controller=new AbortController();mediaVersions.set(kind,version);mediaControllers.set(kind,controller);
    const abort=()=>controller.abort();
    stamp.signal.addEventListener('abort',abort,{once:true});signal?.addEventListener('abort',abort,{once:true});
    if(stamp.signal.aborted||signal?.aborted)abort();
    try{
     if(controller.signal.aborted)fail('TRANSFER_CANCELLED');
     const response=await(kind==='pdf'?media.pdf(id,{signal:controller.signal}):media.audio(id,{signal:controller.signal}));
     assert(stamp);
     if(mediaVersions.get(kind)!==version)fail('MEDIA_SUPERSEDED');
     if(controller.signal.aborted)fail('TRANSFER_CANCELLED');
     if(!(response?.blob instanceof Blob))fail('INVALID_RESPONSE');
     const url=URL.createObjectURL(response.blob);urls.add(url);mediaUrls.set(kind,url);return url;
    }catch(error){
     if(mediaVersions.get(kind)!==version)fail('MEDIA_SUPERSEDED');
     if(controller.signal.aborted)fail('TRANSFER_CANCELLED');
     assert(stamp);
     if(error?.code==='SESSION_BLOCKED')client.hide();
     const allowed=['SESSION_BLOCKED','NOT_FOUND','INVALID_RESPONSE','VERSION_CHANGED','TOTAL_DEADLINE','REQUEST_DEADLINE','TRANSFER_CANCELLED','TRANSFER_BUSY','TRANSFER_DRAINING','COMMUNICATION_FAILURE','MEDIA_DENIED'];
     fail(allowed.includes(error?.code)?error.code:'COMMUNICATION_FAILURE');
    }finally{
     stamp.signal.removeEventListener('abort',abort);signal?.removeEventListener('abort',abort);
     if(mediaControllers.get(kind)===controller)mediaControllers.delete(kind);
    }
   }
  }

 };
 async function ensureLegacy(){
  const marker=guardStorage.getItem(BRIDGE_GUARD_KEY);
  if(marker!==null&&!/^v1\.(login|active|end|ended)\.[A-Za-z0-9_-]{16,64}$/.test(marker))fail('END_PENDING');
  if(sdk.currentUser===null&&(marker===null||marker.startsWith('v1.ended.')))return;
  if((await client.end()).phase!=='ended')fail('END_PENDING');
 }
 window.sosUsualWeb=entry;
 if(new URLSearchParams(window.location.search??'').get('auth')==='legacy'){await ensureLegacy();await legacyLoader();return {enabled:false};}
 await appLoader(entry);
 if(sdk.currentUser!==null||guardStorage.getItem(BRIDGE_GUARD_KEY)!==null)await client.resume();
 return entry;
}
