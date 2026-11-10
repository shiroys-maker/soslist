// Browser bootstrap candidate. Feature defaults off; import performs no initialization or I/O.
import {createNativeEntry,createNativeBridgeAPI} from './native-entry.mjs?v=20261110-passive-resume2';
import {prepareNamedFirebaseAuth} from './sdk-adapters.mjs';
import {createBridgeClient,BRIDGE_GUARD_KEY,BRIDGE_LOCK_NAME} from './client.mjs?v=20261110-passive-resume2';
import {consumeNativeReturnIntent,takeNativeReturnIntent} from './auth-return.mjs';
export const ORIGINAL_SCRIPT_SOURCES=Object.freeze(["https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js", "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js", "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage-compat.js", "shared/core.js?v=20261017-security1", "connection.js?v=20260927-claim-close1", "shared/vendor/markdown-it/markdown-it.umd.min.js?v=20261015-summary-markdown1", "shared/summary-markdown.js?v=20261015-summary-markdown1", "script.js?v=20261110-passive-resume2", "shared/ui.js?v=20260927-claim-close1", "shared/pdf-viewer.js?v=20260927-claim-close1"]);
const fail=()=>{throw Error('NATIVE_START_FAILED');};
function guardType(value){return value===null?'none':/^v1\.(login|active|end|ended)\.[A-Za-z0-9_-]{16,64}$/.exec(value)?.[1]??'invalid';}
function scriptLoader(document){return src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.async=false;script.onload=()=>resolve();script.onerror=()=>reject(Error('NATIVE_START_FAILED'));document.head.appendChild(script);});}
export async function startNativePage({enabled=false,window=globalThis.window,document=globalThis.document,loadScript,createEntry=createNativeEntry,api,media,initializationTimeoutMs=15000}={}){
 let entry;
 try{
  loadScript??=scriptLoader(document);const load=async sources=>{for(const src of sources)await loadScript(src);};
  const legacyLoader=async()=>{if(window.sosNativeBootstrap)window.sosNativeBootstrap.enabled=false;await load(ORIGINAL_SCRIPT_SOURCES);};
  if(!enabled){await legacyLoader();return {enabled:false};}
  if(window?.location?.origin!=='https://soslist.niraissc.jp'||!['/','/index.html'].includes(window.location.pathname)||typeof window.navigator?.locks?.request!=='function'||!Number.isInteger(initializationTimeoutMs)||initializationTimeoutMs<1||initializationTimeoutMs>30000)fail();
  if(window.location.search!=='?auth=legacy')for(const id of ['loginEmail','loginPassword']){const node=document?.getElementById?.(id);if(node)node.hidden=true;}
  const guardStorage=window.localStorage,returnStorage=window.sessionStorage,initialGuard=guardType(guardStorage.getItem(BRIDGE_GUARD_KEY));
  const wantsLegacy=window.location.search==='?auth=legacy';
  if(wantsLegacy&&!['none','ended'].includes(initialGuard))fail();
  if(!wantsLegacy&&window.location.search&&!consumeNativeReturnIntent(window.location,window.history,returnStorage))fail();
  let configured=false,native,ready;
  const proxy=key=>new Proxy({}, {get(_target,property){if(!entry)throw Error('NATIVE_NOT_READY');const target=entry[key],value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}});
  const handles=Object.freeze({auth:proxy('auth'),db:proxy('db'),storage:proxy('storage')});
  const configureApp=(config,firebase)=>{
   if(configured||config?.projectId!=='sos-list-4d150'||!Array.isArray(firebase?.apps))fail();configured=true;
   const existing=firebase.apps.find(app=>app.name==='soslist-passkey');
   if(existing&&existing.options?.projectId!==config.projectId)fail();
   const app=existing??firebase.initializeApp(config,'soslist-passkey');
   if(app.name!=='soslist-passkey')fail();
   native={firestore:app.firestore(),storage:app.storage()};ready=prepareNamedFirebaseAuth(app.auth());ready.catch(()=>{});
   return handles;
  };
  window.sosNativeBootstrap={enabled:!wantsLegacy,legacyCleanup:wantsLegacy,target:'root-web',configure:configureApp,configureLegacy:configureApp};
  await load(ORIGINAL_SCRIPT_SOURCES.slice(0,5));if(!configured||!ready)fail();
  let timer;const sdk=await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('NATIVE_START_FAILED')),initializationTimeoutMs);})]).finally(()=>clearTimeout(timer));
  if(wantsLegacy){
   const withLock=operation=>window.navigator.locks.request(BRIDGE_LOCK_NAME,operation);
   // A shared ended fence is not proof that this restored tab has cleared its SDK cache.
   if(initialGuard==='none'&&sdk.currentUser!==null){
    const cleanup=createBridgeClient({sdk,api:api??createNativeBridgeAPI({location:window.location,fetch:window.fetch?.bind(window)}),storage:guardStorage,withLock,views:{stop(){},clear(){}}});
    if((await cleanup.end()).phase!=='ended')fail();
   }else await withLock(async()=>{
    if(!['none','ended'].includes(guardType(guardStorage.getItem(BRIDGE_GUARD_KEY))))fail();
    await sdk.signOut();if(sdk.currentUser!==null)fail();
   });
   if(!['none','ended'].includes(guardType(guardStorage.getItem(BRIDGE_GUARD_KEY))))fail();
   await load(ORIGINAL_SCRIPT_SOURCES.slice(5));return {enabled:false};
  }
  entry=await createEntry({enabled:true,sdk,...native,guardStorage,
   withLock:operation=>window.navigator.locks.request(BRIDGE_LOCK_NAME,operation),
   api,media,window,document,fetch:window.fetch?.bind(window),legacyLoader,
   async appLoader(value){entry=value;window.sosUsualWeb=value;await load(ORIGINAL_SCRIPT_SOURCES.slice(5));}
  });
  window.sosUsualWeb=entry;
  // A return flag is navigation intent only. Backend cookie/identity checks remain authoritative.
  // Take before exchange; a reload during exchange encounters the durable login denial marker.
  const returned=takeNativeReturnIntent(returnStorage);
  if(returned&&!entry.auth.currentUser&&['none','ended'].includes(initialGuard))await entry.completeLogin();
  const safe=operation=>async()=>{try{await operation();}catch{entry.client.hide();}};
  window.addEventListener?.('pagehide',()=>entry.client.hide());
  window.addEventListener?.('pageshow',safe(()=>entry.gate.resume()));
  window.addEventListener?.('storage',event=>{if([BRIDGE_GUARD_KEY,'soslist-bridge-event'].includes(event.key))return safe(()=>entry.client.observeGuard())();});
  return entry;
 }catch{
  try{entry?.client.hide();}catch{}
  // Deliberately omit SDK errors, identity, URLs and token contents.
  const message=document?.getElementById?.('passkeyStatus')??document?.getElementById?.('loginError');if(message)message.textContent='ログインを開始できませんでした。もう一度画面を開いてください。';
  fail();
 }
}
