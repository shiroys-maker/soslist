// Injected LOCAL lifecycle only. No imports, listeners, globals, SDK initialization or I/O on import.
export const BRIDGE_GUARD_KEY='soslist.bridge.end.v1';
export const BRIDGE_LOCK_NAME='soslist.session.cookie.v2';
const IDENTITY_KEYS=['generation','role','sid','subjectDigest','uid'];
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function identityValid(value){return exact(value,IDENTITY_KEYS)&&typeof value.uid==='string'&&value.uid.length>0&&value.uid.length<=128&&typeof value.subjectDigest==='string'&&/^[a-f0-9]{64}$/.test(value.subjectDigest)&&typeof value.sid==='string'&&/^session-[a-z0-9-]+$/.test(value.sid)&&Number.isSafeInteger(value.generation)&&value.generation>0&&['admin','staff'].includes(value.role);}
function equalIdentity(left,right){return identityValid(left)&&identityValid(right)&&IDENTITY_KEYS.every(key=>left[key]===right[key]);}
function deny(code){throw Object.assign(new Error(code),{code});}
function type(value){return value===null?'none':/^v1\.(login|active|end|ended)\.[A-Za-z0-9_-]{16,64}$/.exec(value)?.[1]??'invalid';}
/** sdk is the isolated named adapter, already initialized with browser SESSION persistence.
 * Only denial epochs are stored by this client; SDK session persistence is a separate accepted policy. */
export function createBridgeClient({api,sdk,storage,withLock,views,broadcast=()=>{},randomId=()=>crypto.randomUUID(),onChange=()=>{}}={}){
 if(!api||!['exchange','inspect','end'].every(key=>typeof api[key]==='function')||sdk?.appName!=='soslist-passkey'||sdk.persistence!=='session'||typeof sdk.signInWithCustomToken!=='function'||typeof sdk.signOut!=='function'||!('currentUser'in sdk)||!storage||!['getItem','setItem','removeItem'].every(key=>typeof storage[key]==='function')||typeof withLock!=='function'||typeof views?.clear!=='function'||typeof views?.stop!=='function'||typeof broadcast!=='function'||typeof randomId!=='function')deny('CLIENT_CONFIG_DENIED');
 let phase='idle',reason='',activeIdentity,revision=0,controller=new AbortController(),ownedGuard,pendingEnd,endOutstanding=false;
 const state=()=>Object.freeze({phase,authenticated:phase==='active',...(reason?{reason}:{}),...(activeIdentity?{identity:Object.freeze({...activeIdentity})}:{})});
 const emit=()=>{try{onChange(state());}catch{}};
 function set(next,code='',identity){phase=next;reason=code;activeIdentity=identity?{...identity}:undefined;emit();}
 function clear(next='blocked',code='CLIENT_BLOCKED'){
  revision++;controller.abort();ownedGuard=undefined;activeIdentity=undefined;let cleared=true;
  for(const key of ['stop','clear'])try{views[key]();}catch{cleared=false;}
  set(next,cleared?code:'VIEW_CLEAR_FAILED');return cleared;
 }
 function read(){try{const value=storage.getItem(BRIDGE_GUARD_KEY);if(type(value)==='invalid')deny('STORAGE_DENIED');return value;}catch{deny('STORAGE_DENIED');}}
 function fresh(kind){let value;try{value=`v1.${kind}.${randomId()}`;}catch{deny('STORAGE_DENIED');}if(type(value)!==kind)deny('STORAGE_DENIED');return value;}
 function write(value){try{storage.setItem(BRIDGE_GUARD_KEY,value);if(read()!==value)deny('STORAGE_DENIED');}catch{deny('STORAGE_DENIED');}}
 function probe(){try{const key=BRIDGE_GUARD_KEY+'.probe';storage.setItem(key,'1');if(storage.getItem(key)!=='1')deny('STORAGE_DENIED');storage.removeItem(key);if(storage.getItem(key)!==null)deny('STORAGE_DENIED');}catch{deny('STORAGE_DENIED');}}
 function showGuard(){try{const kind=type(read());set(kind==='end'?'end-pending':kind==='ended'?'end-pending':kind==='login'?'auth-busy':'blocked',kind==='end'?'END_PENDING':kind==='login'?'LOGIN_PENDING':'CLIENT_BLOCKED');}catch{set('storage-blocked','STORAGE_DENIED');}}
 function own(attempt,marker){if(attempt!==revision||controller.signal.aborted||read()!==marker)deny('CLIENT_BLOCKED');}
 async function signOut(){await sdk.signOut();if(sdk.currentUser!==null)deny('SDK_OUT_UNCONFIRMED');}
 async function verifyUser(user,expected){
  if(!identityValid(expected)||!user||user.uid!==expected.uid||typeof user.getIdTokenResult!=='function')deny('SDK_IDENTITY_DENIED');
  const result=await user.getIdTokenResult(),claims=result?.claims;
  if(!claims||claims.firebase?.sign_in_provider!=='custom'||(result.signInProvider!==undefined&&result.signInProvider!=='custom')||claims.bridgeSubject!==expected.subjectDigest||claims.bridgeSession!==expected.sid||claims.bridgeGeneration!==expected.generation||claims.bridgeRole!==expected.role)deny('SDK_IDENTITY_DENIED');
  if(sdk.currentUser?.uid!==expected.uid)deny('SDK_IDENTITY_DENIED');
 }
 async function finishEnd(){
  endOutstanding=true;const cleared=clear('ending','END_PENDING'),attempt=revision;let intent;
  try{probe();intent=fresh('end');write(intent);try{broadcast({type:'guard-changed'});}catch{}}
  catch{
   // A failed durable write cannot be acknowledged. Still fence B and attempt named-SDK cleanup.
   let server,cleanup;try{server=Promise.resolve(api.end());}catch{server=Promise.reject(new Error('END_UNCONFIRMED'));}
   try{cleanup=Promise.resolve(withLock(async()=>{if(attempt!==revision)deny('CLIENT_BLOCKED');await signOut();}));}catch{cleanup=Promise.reject(new Error('SDK_OUT_UNCONFIRMED'));}
   await Promise.allSettled([server,cleanup]);if(attempt===revision)set('storage-blocked','STORAGE_DENIED');return state();
  }
  // Fence B immediately even if an earlier SDK sign-in still owns the shared SDK lock.
  let server;try{server=Promise.resolve(api.end());}catch{server=Promise.reject(new Error('END_UNCONFIRMED'));}
  let cleanup;try{cleanup=Promise.resolve(withLock(async()=>{if(attempt!==revision||read()!==intent)deny('CLIENT_BLOCKED');await signOut();if(attempt!==revision||read()!==intent)deny('CLIENT_BLOCKED');return true;}));}catch{cleanup=Promise.reject(new Error('SDK_OUT_UNCONFIRMED'));}
  const [ended,signedOut]=await Promise.allSettled([server,cleanup]);
  if(attempt!==revision)return state();
  try{
   if(read()!==intent){showGuard();return state();}
   if(cleared&&ended.status==='fulfilled'&&exact(ended.value,['ended'])&&ended.value.ended===true&&signedOut.status==='fulfilled'&&signedOut.value===true&&sdk.currentUser===null){write(fresh('ended'));endOutstanding=false;set('ended');}
   else set('end-pending',cleared?'END_UNCONFIRMED':'VIEW_CLEAR_FAILED');
  }catch{set('storage-blocked','STORAGE_DENIED');}
  return state();
 }
 const client={state,
  assertActive(){
   if(phase!=='active'||!activeIdentity)deny('CLIENT_BLOCKED');
   try{if(read()!==ownedGuard){clear();showGuard();deny('CLIENT_BLOCKED');}}
   catch(error){if(error?.code!=='CLIENT_BLOCKED')clear('storage-blocked','STORAGE_DENIED');deny('CLIENT_BLOCKED');}
   return Object.freeze({identity:Object.freeze({...activeIdentity}),signal:controller.signal,revision});
  },
  async resume(){
   if(pendingEnd){await pendingEnd;return state();}
   if(endOutstanding){clear('end-pending','END_PENDING');return state();}
   if(!clear('checking','')){set('blocked','VIEW_CLEAR_FAILED');return state();}controller=new AbortController();const attempt=revision;let marker;
   try{
    probe();marker=read();const kind=type(marker);
    if(kind==='login'){showGuard();return state();}
    if(kind==='end'||kind==='ended')return client.observeGuard();
    await withLock(async()=>{
     own(attempt,marker);const inspected=await api.inspect({signal:controller.signal});own(attempt,marker);
     if(!exact(inspected,['authenticated','identity'])||inspected.authenticated!==true||!identityValid(inspected.identity))deny('SESSION_DENIED');
     if(sdk.currentUser===null){set('signed-out','EXPLICIT_LOGIN_REQUIRED');return;}
     await verifyUser(sdk.currentUser,inspected.identity);own(attempt,marker);
     if(kind==='none'){write(fresh('active'));marker=read();}
     ownedGuard=marker;set('active','',inspected.identity);
    });
   }catch{
    if(attempt===revision){let current;try{current=read();}catch{set('storage-blocked','STORAGE_DENIED');return state();}
     if(current!==marker){showGuard();return state();}
     clear('blocked','RESUME_UNCONFIRMED');return state();
    }
   }
   return state();
  },
  async login(){
   if(pendingEnd||endOutstanding)return state();let initial;
   try{probe();initial=read();if(['end','login'].includes(type(initial))){clear();showGuard();return state();}}
   catch{clear('storage-blocked','STORAGE_DENIED');return state();}
   if(!clear('authenticating',''))return client.end();controller=new AbortController();const attempt=revision;let marker,reply,customToken;
   try{
    await withLock(async()=>{
     own(attempt,initial);marker=fresh('login');write(marker);try{broadcast({type:'guard-changed'});}catch{}
     try{
      if(sdk.currentUser!==null)await signOut();own(attempt,marker);
      reply=await api.exchange({signal:controller.signal});own(attempt,marker);
      if(!exact(reply,['customToken','identity'])||typeof reply.customToken!=='string'||!reply.customToken||!identityValid(reply.identity))deny('EXCHANGE_DENIED');
      const expected={...reply.identity};customToken=reply.customToken;reply=undefined;
      const signed=await sdk.signInWithCustomToken(customToken);customToken=undefined;own(attempt,marker);
      await verifyUser(signed?.user,expected);own(attempt,marker);
      const inspected=await api.inspect({signal:controller.signal});own(attempt,marker);
      if(!exact(inspected,['authenticated','identity'])||inspected.authenticated!==true||!equalIdentity(inspected.identity,expected))deny('SESSION_DENIED');
      await verifyUser(sdk.currentUser,expected);own(attempt,marker);
      write(fresh('active'));ownedGuard=read();set('active','',expected);
     }catch(error){customToken=undefined;reply=undefined;try{await signOut();}catch{}throw new Error('LOGIN_UNCONFIRMED');}
    });
   }catch{
    customToken=undefined;reply=undefined;
    if(attempt===revision){let current;try{current=read();}catch{set('storage-blocked','STORAGE_DENIED');return state();}
     if(current===marker||current===initial)return client.end();showGuard();}
   }
   return state();
  },
  end(){if(pendingEnd)return pendingEnd;pendingEnd=finishEnd().finally(()=>{pendingEnd=undefined;});return pendingEnd;},
  async retryEnd(){try{if(!endOutstanding&&type(read())!=='end'&&!(type(read())==='ended'&&phase!=='ended'))return state();}catch{clear('storage-blocked','STORAGE_DENIED');return state();}return client.end();},
  async observeGuard(){
   const cleared=clear();let marker;try{marker=read();showGuard();}catch{set('storage-blocked','STORAGE_DENIED');return state();}
   if(['end','ended'].includes(type(marker)))try{await withLock(async()=>{
    if(read()!==marker||!['end','ended'].includes(type(read())))return;
    await signOut();
    if(read()===marker&&type(marker)==='ended'&&cleared){endOutstanding=false;set('ended');}
   });}catch{try{if(read()===marker)set('end-pending','SDK_OUT_UNCONFIRMED');}catch{set('storage-blocked','STORAGE_DENIED');}}
   return state();
  },
  hide(){clear('blocked','CLIENT_BLOCKED');return state();},
 };
 return Object.freeze(client);
}
