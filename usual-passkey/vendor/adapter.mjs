// Source-only integration candidate. Importing this module performs no I/O or SDK initialization.
const METHODS = new Set(['query', 'get', 'markers', 'edit', 'file']);
const REFERRALS = new Set(['ASBO', 'KIN', 'ANSHIN', 'LAB']);
const SAFE_CODES = new Set(['SESSION_BLOCKED','QUERY_CANCELLED','STORAGE_DENIED','LOCK_UNAVAILABLE','END_PENDING','END_UNCONFIRMED','ENDED','LOGIN_PENDING','COMMUNICATION_FAILURE','INCOMPLETE_RESULTS','CONFLICT','VERSION_REQUIRED','REFERENCE_REQUIRED','UNSUPPORTED','UNSUPPORTED_MUTATION','UNSUPPORTED_FILE','INVALID_RESPONSE','NOT_FOUND','FORBIDDEN','UNAUTHENTICATED','SESSION_EXPIRED','SESSION_REVOKED','SESSION_INVALID','INVALID_SESSION','INVALID_BINDING','MEMBER_INACTIVE','CREDENTIAL_REVOKED','GENERATION_MISMATCH','MUTATION_UNCERTAIN']);
function fault(code) { return Object.assign(new Error(code), {code}); }
const C_ERROR_CODES=Object.freeze({CURSOR_DENIED:'INCOMPLETE_RESULTS',QUERY_TOO_LARGE:'INCOMPLETE_RESULTS',VERSION_CONFLICT:'CONFLICT',MUTATION_OUTCOME_UNKNOWN:'MUTATION_UNCERTAIN',SESSION_DENIED:'SESSION_BLOCKED',MEMBER_DENIED:'SESSION_BLOCKED',FILE_DENIED:'NOT_FOUND',PATIENT_UNAVAILABLE:'COMMUNICATION_FAILURE',REQUEST_DENIED:'UNSUPPORTED',ORIGIN_DENIED:'FORBIDDEN',METHOD_DENIED:'UNSUPPORTED',CONTENT_TYPE_DENIED:'UNSUPPORTED',BODY_TOO_LARGE:'UNSUPPORTED',CONFIG_DENIED:'COMMUNICATION_FAILURE',ADAPTER_SCOPE_DENIED:'COMMUNICATION_FAILURE'});
export function normalizePatientErrorCode(error, fallback='COMMUNICATION_FAILURE') {const code=typeof error==='string'?error:error?.code;return Object.hasOwn(C_ERROR_CODES,code)?C_ERROR_CODES[code]:SAFE_CODES.has(code)?code:fallback;}
function validSubject(reply) {return reply?.authenticated === true && typeof reply.user?.subjectId === 'string' && reply.user.subjectId.length > 0 && reply.user.subjectId.length <= 256;}

export const END_GUARD_KEY='soslist.session.end.v1';
export const COOKIE_LOCK_NAME='soslist.session.cookie.v2';
function browserStorage(){try{if(globalThis.localStorage)return globalThis.localStorage;}catch{}throw fault('STORAGE_DENIED');}
function browserCookieLock(operation){if(typeof globalThis.navigator?.locks?.request!=='function')throw fault('LOCK_UNAVAILABLE');return globalThis.navigator.locks.request(COOKIE_LOCK_NAME,{mode:'exclusive'},operation);}
function markerType(value){return value===null?'none':value==='pending'?'end':value==='ended'?'ended':/^v2\.(login|end|ended|active)\.[A-Za-z0-9_-]{16,64}$/.exec(value)?.[1]??'invalid';}
/** B is the only session authority. Durable main-origin markers only deny display.
 * No browser role, UID, Firebase state or marker grants patient access. */
export function createUsualSessionGate({inspect,end,legacy,start=()=>{},teardown=()=>{},events,visibility,broadcast=()=>{},storage=browserStorage(),withCookieLock=browserCookieLock,randomId=()=>crypto.randomUUID(),setTimer=setTimeout,clearTimer=clearTimeout,inspectIntervalMs=60000,inspectTimeoutMs=8000}={}) {
  if(typeof inspect!=='function'||typeof end!=='function'||!storage||typeof withCookieLock!=='function')throw fault('INVALID_RESPONSE');
  let ready=false,epoch=0,subject=null,ownedGuard,reason='SESSION_BLOCKED',controller=new AbortController(),pendingEnd=null,timer;
  const hooks=new Set(),observers=new Set(),unbind=[];
  const notify=()=>{for(const callback of observers)callback(ready?{isPasskey:true,email:'パスキー'}:null);};
  function clear(code='SESSION_BLOCKED'){
    reason=SAFE_CODES.has(code)?code:'SESSION_BLOCKED';ready=false;subject=null;ownedGuard=undefined;epoch++;controller.abort();clearTimer(timer);timer=undefined;
    for(const callback of hooks){try{callback();}catch{}}
    try{teardown();}finally{notify();}
  }
  function guard(){try{const value=storage.getItem(END_GUARD_KEY);if(markerType(value)==='invalid')throw fault('STORAGE_DENIED');return value;}catch{throw fault('STORAGE_DENIED');}}
  function fresh(type){const value=`v2.${type}.${randomId()}`;if(markerType(value)!==type)throw fault('STORAGE_DENIED');return value;}
  function write(value){try{storage.setItem(END_GUARD_KEY,value);if(guard()!==value)throw fault('STORAGE_DENIED');}catch{throw fault('STORAGE_DENIED');}}
  function probe(){try{const key=END_GUARD_KEY+'.probe';storage.setItem(key,'1');if(storage.getItem(key)!=='1')throw fault('STORAGE_DENIED');storage.removeItem(key);}catch{throw fault('STORAGE_DENIED');}}
  function guardReason(){const type=markerType(guard());return type==='end'?'END_PENDING':type==='ended'?'ENDED':type==='login'?'LOGIN_PENDING':'SESSION_BLOCKED';}
  function blockFromGuard(){try{clear(guardReason());}catch{clear('STORAGE_DENIED');}}
  function assertOwned(capture){
    if(!ready||capture.epoch!==epoch||capture.signal.aborted)throw fault('SESSION_BLOCKED');
    try{if(guard()!==ownedGuard){blockFromGuard();throw fault('SESSION_BLOCKED');}}
    catch(error){if(error.code!=='SESSION_BLOCKED')clear('STORAGE_DENIED');throw fault('SESSION_BLOCKED');}
  }
  async function inspectBounded(){
    const activeController=controller;let deadlineTimer;
    const deadline=new Promise((_,reject)=>{deadlineTimer=setTimer(()=>{activeController.abort();reject(fault('COMMUNICATION_FAILURE'));},inspectTimeoutMs);deadlineTimer?.unref?.();});
    try{return await Promise.race([inspect({signal:activeController.signal}),deadline]);}finally{clearTimer(deadlineTimer);}
  }
  function schedule(){
    clearTimer(timer);timer=setTimer(async()=>{
      if(!ready)return;const capture={epoch,signal:controller.signal},knownSubject=subject;
      try{await withCookieLock(async()=>{assertOwned(capture);const reply=await inspectBounded();assertOwned(capture);if(!validSubject(reply)||reply.user.subjectId!==knownSubject)throw fault('SESSION_BLOCKED');});if(ready)schedule();}
      catch{if(capture.epoch===epoch)clear();}
    },inspectIntervalMs);timer?.unref?.();
  }
  async function finishEnd(){
    // Write before network/lock await. A reload can only retry end, never inspect past this intent.
    clear('END_PENDING');const attempt=epoch;let intent;
    try{probe();intent=fresh('end');write(intent);broadcast('ended');}
    catch{clear('STORAGE_DENIED');throw fault('STORAGE_DENIED');}
    try{return await withCookieLock(async()=>{
      if(attempt!==epoch||guard()!==intent)throw fault('SESSION_BLOCKED');
      const reply=await end();
      if(attempt!==epoch||guard()!==intent)throw fault('SESSION_BLOCKED');
      if(reply?.ended!==true)throw fault('END_UNCONFIRMED');
      write(fresh('ended'));clear('ENDED');return {ended:true};
    });}catch(error){
      if(attempt===epoch){try{if(guard()===intent)clear(error?.code==='LOCK_UNAVAILABLE'?'LOCK_UNAVAILABLE':'END_PENDING');else blockFromGuard();}catch{clear('STORAGE_DENIED');}}
      throw fault(normalizePatientErrorCode(error));
    }
  }
  function runEnd(){if(pendingEnd)return pendingEnd;pendingEnd=finishEnd().finally(()=>{pendingEnd=null;});return pendingEnd;}
  const gate={
    get ready(){return ready;},get epoch(){return epoch;},get reason(){return reason;},
    capture(){if(!ready)throw fault('SESSION_BLOCKED');const capture={epoch,signal:controller.signal};assertOwned(capture);return capture;},
    assert:assertOwned,onInvalidate(callback){hooks.add(callback);return()=>hooks.delete(callback);},fail(code){clear(code);},
    async resume(){
      clear();controller=new AbortController();const attempt=epoch;let initial;
      try{
        probe();initial=guard();const type=markerType(initial);
        if(type==='end'){try{await runEnd();}catch{}throw fault('SESSION_BLOCKED');}
        if(type==='ended'){clear('ENDED');throw fault('SESSION_BLOCKED');}
        await withCookieLock(async()=>{
          if(attempt!==epoch||guard()!==initial)throw fault('SESSION_BLOCKED');
          const reply=await inspectBounded();
          if(attempt!==epoch||controller.signal.aborted||guard()!==initial||!validSubject(reply))throw fault('SESSION_BLOCKED');
          // A main-origin primary click created login only after a confirmed old-session end.
          // Keep a neutral epoch after return to prevent a login→null ABA race.
          if(type==='login'){write(fresh('active'));initial=guard();}
          ownedGuard=initial;subject=reply.user.subjectId;ready=true;reason='';notify();start();schedule();
        });return true;
      }catch(error){if(attempt===epoch){try{if(guard()!==initial)blockFromGuard();else clear(error?.code==='STORAGE_DENIED'?'STORAGE_DENIED':error?.code==='LOCK_UNAVAILABLE'?'LOCK_UNAVAILABLE':'SESSION_BLOCKED');}catch{clear('STORAGE_DENIED');}}throw fault('SESSION_BLOCKED');}
    },
    async end(){return runEnd();},
    async retryEnd(){if(markerType(guard())!=='end')throw fault('SESSION_BLOCKED');return runEnd();},
    async beginLogin(){
      // Never use a login intent to bypass an unacknowledged end.
      let prior;try{probe();prior=guard();if(markerType(prior)==='end')throw fault('END_PENDING');}catch(error){if(error.code==='END_PENDING')clear('END_PENDING');else clear('STORAGE_DENIED');throw fault(normalizePatientErrorCode(error));}
      if(markerType(prior)!=='ended'){await gate.end();prior=guard();}
      clear('LOGIN_PENDING');const attempt=epoch;
      try{return await withCookieLock(async()=>{
        if(attempt!==epoch||guard()!==prior||markerType(prior)!=='ended')throw fault('SESSION_BLOCKED');
        const intent=fresh('login');write(intent);return {loginIntent:true};
      });}catch(error){if(attempt===epoch)blockFromGuard();throw fault(normalizePatientErrorCode(error));}
    },
    legacyLogin(...args){if(!legacy?.signInWithEmailAndPassword)throw fault('UNSUPPORTED');return legacy.signInWithEmailAndPassword(...args);},
    dispose(){clear();for(const remove of unbind)remove();observers.clear();hooks.clear();},
  };
  gate.auth={get currentUser(){return ready?{isPasskey:true,email:'パスキー'}:null;},onAuthStateChanged(callback){observers.add(callback);callback(gate.auth.currentUser);return()=>observers.delete(callback);},signOut:()=>gate.end(),signInWithEmailAndPassword:(...args)=>gate.legacyLogin(...args)};
  if(events?.addEventListener){const bind=(name,callback)=>{events.addEventListener(name,callback);unbind.push(()=>events.removeEventListener(name,callback));};
    bind('storage',event=>{if(event.key===END_GUARD_KEY||event.key==='soslist-passkey-session-event')blockFromGuard();});
    bind('online',()=>{void gate.resume().catch(()=>{});});bind('pagehide',()=>clear());bind('pageshow',()=>{void gate.resume().catch(()=>{});});bind('focus',()=>{void gate.resume().catch(()=>{});});bind('offline',()=>clear());
  }
  if(visibility?.addEventListener){const changed=()=>{if(visibility.hidden)clear();else void gate.resume().catch(()=>{});};visibility.addEventListener('visibilitychange',changed);unbind.push(()=>visibility.removeEventListener('visibilitychange',changed));}
  return gate;
}

export const AUTH_RETURN_INTENT = 'usual-web';
/** The auth site maps this fixed intent to its allowlisted app URL. Never a client URL. */
export function authRedirectIntent(authOrigin) {return `${fixedOrigin(authOrigin)}/?returnTo=${AUTH_RETURN_INTENT}`;}
function fixedOrigin(value) {
  let url;try{url=new URL(value);}catch{throw fault('INVALID_ORIGIN');}
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw fault('INVALID_ORIGIN');
  return url.origin;
}
function exactKeys(value, keys) {
  return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function transportPayload(method,payload){
  if(method==='query'){
    if(!exactKeys(payload,payload?.cursor===undefined?['query']:['query','cursor']))throw fault('UNSUPPORTED');
    if(payload.cursor!==undefined&&!validCursor(payload.cursor))throw fault('UNSUPPORTED');
    const q=payload.query;
    if(!q || !exactKeys(q,q.limit===undefined?['where','orderBy']:['where','orderBy','limit']) || !Array.isArray(q.where) || !Array.isArray(q.orderBy))throw fault('UNSUPPORTED');
    for(const row of q.where)if(!exactKeys(row,['field','op','value']))throw fault('UNSUPPORTED');
    for(const row of q.orderBy)if(!exactKeys(row,['field','direction']))throw fault('UNSUPPORTED');
    return {query:querySpec(q.where,q.orderBy,q.limit),...(payload.cursor===undefined?{}:{cursor:payload.cursor})};
  }
  const keys=method==='get'?['id']:method==='file'?['id','kind']:['id','expectedVersion','patch'];
  if(!exactKeys(payload,keys) || !validId(payload.id))throw fault('UNSUPPORTED');
  if(method==='file' && !['pdf','summary-audio'].includes(payload.kind))throw fault('UNSUPPORTED_FILE');
  if(method==='markers'||method==='edit'){
    if(typeof payload.expectedVersion!=='string' || payload.expectedVersion.length<1 || payload.expectedVersion.length>256)throw fault('UNSUPPORTED_MUTATION');
    return {id:payload.id,expectedVersion:payload.expectedVersion,patch:method==='markers'?markerPatch(payload.patch):clinicalPatch(payload.patch)};
  }
  return {...payload};
}
export function normalizePatientQuery(query){return transportPayload('query',{query}).query;}
export function createFixedPatientTransport({origin,fetch:fetcher,timeoutMs=15000,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  const base=fixedOrigin(origin);if(typeof fetcher!=='function' || !Number.isFinite(timeoutMs) || timeoutMs<1 || timeoutMs>60000)throw fault('INVALID_RESPONSE');
  return async(method,payload,{signal}={})=>{
    if(!METHODS.has(method))throw fault('UNSUPPORTED');
    const body=JSON.stringify(transportPayload(method,payload));
    const controller=new AbortController();let timer,rejectDeadline;
    const deadline=new Promise((_,reject)=>{rejectDeadline=reject;timer=setTimer(()=>{controller.abort();reject(fault('COMMUNICATION_FAILURE'));},timeoutMs);timer?.unref?.();});
    const abort=()=>{controller.abort();rejectDeadline(fault('COMMUNICATION_FAILURE'));};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const work=async()=>{
      let response;
      try {response=await fetcher(`${base}/api/patient/${method}`,{method:'POST',mode:'cors',credentials:'include',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body,signal:controller.signal});}
      catch{throw fault('COMMUNICATION_FAILURE');}
      if(!response.ok){
        let code='COMMUNICATION_FAILURE';try{const reply=await response.json();code=normalizePatientErrorCode(reply.error??reply);}catch{}
        throw fault(code);
      }
      if(method==='file'){
        const contentType=(response.headers?.get('content-type')||'').split(';')[0].trim();
        return {bytes:new Uint8Array(await response.arrayBuffer()),contentType};
      }
      try{return await response.json();}catch{throw fault('INVALID_RESPONSE');}
    };
    try{return await Promise.race([work(),deadline]);}
    catch(error){throw fault(normalizePatientErrorCode(error));}
    finally{clearTimer(timer);signal?.removeEventListener('abort',abort);}
  };
}

export function timestampFromDate(date) {
  const ms=date instanceof Date?date.getTime():NaN;if(!Number.isFinite(ms))throw fault('UNSUPPORTED');
  const seconds=Math.floor(ms/1000);return {$timestamp:{seconds,nanoseconds:Math.round((ms-seconds*1000)*1e6)}};
}
function wire(value){
  if(value instanceof Date)return timestampFromDate(value);
  if(value?.toDate && typeof value.toDate==='function')return timestampFromDate(value.toDate());
  return value;
}
function hydrate(value,depth=0){
  if(depth>30)throw fault('INVALID_RESPONSE');
  if(value===null || typeof value==='string' || typeof value==='boolean')return value;
  if(typeof value==='number' && Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(item=>hydrate(item,depth+1));
  if(!value || typeof value!=='object')throw fault('INVALID_RESPONSE');
  if(Object.hasOwn(value,'$timestamp')){
    if(Object.keys(value).length!==1)throw fault('INVALID_RESPONSE');
    const t=value.$timestamp;
    if(!t || !Number.isSafeInteger(t.seconds) || !Number.isInteger(t.nanoseconds) || t.nanoseconds<0 || t.nanoseconds>=1e9 || Object.keys(t).sort().join(',')!=='nanoseconds,seconds')throw fault('INVALID_RESPONSE');
    const ms=t.seconds*1000+t.nanoseconds/1e6;if(!Number.isFinite(new Date(ms).getTime()))throw fault('INVALID_RESPONSE');
    return Object.freeze({toDate:()=>new Date(ms)});
  }
  const copy={};for(const [key,item]of Object.entries(value)){
    if(['__proto__','constructor','prototype'].includes(key))throw fault('INVALID_RESPONSE');
    copy[key]=hydrate(item,depth+1);
  }return copy;
}
function validId(id){return typeof id==='string' && id.length>0 && id.length<=256 && /^[A-Za-z0-9_.-]+$/.test(id);}
function markerPatch(patch){
  if(!patch || typeof patch!=='object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).length>11)throw fault('UNSUPPORTED_MUTATION');
  for(const [key,value]of Object.entries(patch)){
    const parts=key.split('.');
    if(typeof value!=='boolean' || !(new Set(['isShown','isReceived','isCompleted']).has(key) || (parts.length===3 && parts[0]==='referrals' && REFERRALS.has(parts[1]) && ['isReceived','isCompleted'].includes(parts[2]))))throw fault('UNSUPPORTED_MUTATION');
  }return {...patch};
}
function clinicalPatch(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw fault('UNSUPPORTED_MUTATION');const keys=Object.keys(patch);
  if(keys.length===1&&keys[0]==='japanCellPhone'){
    if(typeof patch.japanCellPhone!=='string')throw fault('UNSUPPORTED_MUTATION');const value=patch.japanCellPhone.trim();if(new TextEncoder().encode(value).byteLength>1024*1024-89)throw fault('UNSUPPORTED_MUTATION');return {japanCellPhone:value};
  }
  if(keys.length===1&&keys[0]==='isAgePink'&&typeof patch.isAgePink==='boolean')return {...patch};
  if(keys.length===1&&(keys[0]==='visitDate'||/^referrals\.(ASBO|KIN|ANSHIN)\.visitDate$/.test(keys[0]))){
    const value=patch[keys[0]],match=typeof value==='string'&&/^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(value);
    if(!match)throw fault('UNSUPPORTED_MUTATION');const [month,day,hour,minute]=match.slice(1).map(Number),date=new Date(Date.UTC(2000,month-1,day,hour,minute));
    if(date.getUTCMonth()!==month-1||date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute)throw fault('UNSUPPORTED_MUTATION');return {...patch};
  }
  if(exactKeys(patch,['appointmentDate','appointmentDateTime','processedAt'])){
    if(typeof patch.appointmentDate!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:09|10|11|13|14|15|16):(?:00|15|30|45):00$/.test(patch.appointmentDate)||!exactKeys(patch.processedAt,['$serverTimestamp'])||patch.processedAt.$serverTimestamp!==true)throw fault('UNSUPPORTED_MUTATION');
    const value=wire(patch.appointmentDateTime);let actual;try{actual=hydrate(value).toDate().getTime();}catch{throw fault('UNSUPPORTED_MUTATION');}
    const expected=Date.parse(patch.appointmentDate+'+09:00');if(!Number.isFinite(expected)||actual!==expected||new Date(expected+9*60*60*1000).toISOString().slice(0,19)!==patch.appointmentDate)throw fault('UNSUPPORTED_MUTATION');
    return {appointmentDate:patch.appointmentDate,appointmentDateTime:value,processedAt:{$serverTimestamp:true}};
  }
  throw fault('UNSUPPORTED_MUTATION');
}
function mutationPatch(patch){try{return {method:'markers',patch:markerPatch(patch)};}catch{return {method:'edit',patch:clinicalPatch(patch)};}}
function validCursor(value){return typeof value==='string'&&value.length<=4096&&/^p1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{22}$/.test(value);}
export const PATIENT_WIRE_RESPONSE_LIMIT=6*1024*1024+65536;
export const QUERY_READ_LIMITS=Object.freeze({maxDocuments:10000,maxBytes:32*1024*1024,maxPages:64,timeoutMs:45000});
function querySpec(where,orderBy,limit){
  if(where.length>2 || orderBy.length>1)throw fault('UNSUPPORTED');
  for(const clause of where){
    const date=clause.field==='appointmentDateTime' && ['<','<=','>','>='].includes(clause.op) && clause.value?.$timestamp;
    const shown=clause.field==='isShown' && clause.op==='==' && typeof clause.value==='boolean';
    const contract=clause.field==='contractNumber' && ['>=','<'].includes(clause.op) && typeof clause.value==='string' && clause.value.length<=128;
    if(!date && !shown && !contract)throw fault('UNSUPPORTED');if(date)hydrate(clause.value);
  }
  if(new Set(where.map(item=>item.field)).size>1||new Set(where.map(item=>item.op)).size!==where.length)throw fault('UNSUPPORTED');
  for(const order of orderBy)if(!['appointmentDateTime','contractNumber'].includes(order.field) || !['asc','desc'].includes(order.direction)||(where.length&&order.field!==where[0].field))throw fault('UNSUPPORTED');
  if(limit!==undefined && (!Number.isInteger(limit) || limit<1 || limit>300))throw fault('UNSUPPORTED');
  return {where:where.map(x=>({...x})),orderBy:orderBy.map(x=>({...x})),...(limit===undefined?{}:{limit})};
}

/** Firestore-compatible narrow subset. request(method,payload,{signal}) is injected C only. */
export function createPatientFacade({gate,request,setTimer=setTimeout,clearTimer=clearTimeout,pollIntervalMs=60000,urls=globalThis.URL,Blob:BlobType=globalThis.Blob,queryLimits={},subscribe,media}={}) {
  if(!gate || typeof request!=='function' || !Number.isFinite(pollIntervalMs) || pollIntervalMs<1000)throw fault('INVALID_RESPONSE');
  if(!queryLimits||typeof queryLimits!=='object'||Array.isArray(queryLimits)||Object.keys(queryLimits).some(key=>!Object.hasOwn(QUERY_READ_LIMITS,key)))throw fault('INVALID_RESPONSE');
  const limits={...QUERY_READ_LIMITS,...queryLimits};for(const [key,value]of Object.entries(limits))if(!Number.isSafeInteger(value)||value<1||value>QUERY_READ_LIMITS[key])throw fault('INVALID_RESPONSE');
  const records=new Map(),objectUrls=new Set(),subscriptions=new Set();
  function clear(){for(const stop of [...subscriptions])stop();records.clear();for(const url of objectUrls)urls.revokeObjectURL(url);objectUrls.clear();}
  const unbind=gate.onInvalidate(clear);
  async function call(method,payload,signal){
    const capture=gate.capture();let requestSignal=capture.signal,cleanup=()=>{};
    if(signal){
      const controller=new AbortController(),abort=()=>controller.abort();
      capture.signal.addEventListener('abort',abort,{once:true});signal.addEventListener('abort',abort,{once:true});
      if(capture.signal.aborted||signal.aborted)controller.abort();requestSignal=controller.signal;
      cleanup=()=>{capture.signal.removeEventListener('abort',abort);signal.removeEventListener('abort',abort);};
    }
    try{
      if(signal?.aborted)throw fault('QUERY_CANCELLED');
      const response=await request(method,payload,{signal:requestSignal});gate.assert(capture);
      if(signal?.aborted)throw fault('QUERY_CANCELLED');return response;
    }catch(error){
      gate.assert(capture);if(signal?.aborted)throw fault('QUERY_CANCELLED');const code=normalizePatientErrorCode(error);
      if(!['CONFLICT','NOT_FOUND','QUERY_CANCELLED'].includes(code))gate.fail(code);throw fault(code);
    }finally{cleanup();}
  }
  function validateDocument(raw,expectedId){
    if(!raw||!validId(raw.id)||(expectedId&&raw.id!==expectedId)||typeof raw.version!=='string'||raw.version.length<1||raw.version.length>256||!raw.data||typeof raw.data!=='object'||Array.isArray(raw.data))throw fault('INVALID_RESPONSE');
    return hydrate(raw.data);
  }
  function document(raw,expectedId){
    const capture=gate.capture();
    const data=validateDocument(raw,expectedId);
    records.set(raw.id,{version:raw.version,data});
    return {id:raw.id,exists:true,ref:reference(raw.id),data:()=>{gate.assert(capture);return hydrate(raw.data);}};
  }
  function invalid(error){const code=normalizePatientErrorCode(error,'INVALID_RESPONSE');if(code==='INVALID_RESPONSE' || code==='INCOMPLETE_RESULTS')gate.fail(code);throw fault(code);}
  function reference(id){
    if(!validId(id))throw fault('UNSUPPORTED');
    const referenceEpoch=gate.capture();
    let readVersion=records.get(id)?.version;
    return {id,
      async get(options){gate.assert(referenceEpoch);if(options && (Object.keys(options).length!==1 || options.source!=='server'))throw fault('UNSUPPORTED');
        const response=await call('get',{id});try{
          if(response?.document===null){readVersion=undefined;records.delete(id);return {id,exists:false,ref:reference(id),data:()=>undefined};}
          const snapshot=document(response?.document,id);readVersion=response.document.version;return snapshot;
        }catch(error){return invalid(error);}},
      async update(patch){
        gate.assert(referenceEpoch);
        const mutation=mutationPatch(patch);if(!readVersion || !records.has(id))throw fault('VERSION_REQUIRED');
        const expectedVersion=readVersion;readVersion=undefined;
        // Drop version before request: conflicts/unknown outcome require explicit fresh read.
        records.delete(id);
        const response=await call(mutation.method,{id,expectedVersion,patch:mutation.patch});
        try{const updated=document(response?.document,id);for(const stop of subscriptions)stop.refresh?.();return updated;}catch(error){return invalid(error);}
      },
      set(){throw fault('UNSUPPORTED_MUTATION');},delete(){throw fault('UNSUPPORTED_MUTATION');},
    };
  }
  function query(where=[],orderBy=[],limit){
    const spec=querySpec(where,orderBy,limit);
    async function readAll(externalSignal){
      const capture=gate.capture(),controller=new AbortController();let timer,rejectCancellation;
      const cancellation=new Promise((_,reject)=>{rejectCancellation=reject;});
      const cancel=()=>{controller.abort();rejectCancellation(fault('QUERY_CANCELLED'));};
      const ended=()=>{controller.abort();rejectCancellation(fault('SESSION_BLOCKED'));};
      externalSignal?.addEventListener('abort',cancel,{once:true});capture.signal.addEventListener('abort',ended,{once:true});
      if(externalSignal?.aborted)cancel();
      const deadline=new Promise((_,reject)=>{timer=setTimer(()=>{controller.abort();reject(fault('INCOMPLETE_RESULTS'));},limits.timeoutMs);timer?.unref?.();});
      const collect=async()=>{
        const rawDocs=[],ids=new Set(),cursors=new Set();let cursor,bytes=0,pages=0;
        for(;;){
          gate.assert(capture);if(controller.signal.aborted)throw fault('QUERY_CANCELLED');
          if(++pages>limits.maxPages)throw fault('INCOMPLETE_RESULTS');
          const response=await call('query',{query:spec,...(cursor===undefined?{}:{cursor})},controller.signal);
          gate.assert(capture);if(controller.signal.aborted)throw fault('QUERY_CANCELLED');
          if(!exactKeys(response,response?.nextCursor===undefined?['documents','complete']:['documents','complete','nextCursor'])||!Array.isArray(response.documents)||typeof response.complete!=='boolean'||response.documents.length>300)throw fault('INVALID_RESPONSE');
          let pageBytes;try{pageBytes=new TextEncoder().encode(JSON.stringify(response)).byteLength;}catch{throw fault('INVALID_RESPONSE');}
          if(pageBytes>PATIENT_WIRE_RESPONSE_LIMIT||(pageBytes>4*1024*1024&&response.documents.length!==1))throw fault('INCOMPLETE_RESULTS');bytes+=pageBytes;
          if(bytes>limits.maxBytes||rawDocs.length+response.documents.length>limits.maxDocuments)throw fault('INCOMPLETE_RESULTS');
          for(const raw of response.documents){validateDocument(raw);if(ids.has(raw.id))throw fault('INVALID_RESPONSE');ids.add(raw.id);rawDocs.push(raw);}
          if(spec.limit!==undefined&&rawDocs.length>spec.limit)throw fault('INVALID_RESPONSE');
          if(response.complete){if(response.nextCursor!==undefined)throw fault('INVALID_RESPONSE');break;}
          if(!response.documents.length||!validCursor(response.nextCursor)||cursors.has(response.nextCursor)||rawDocs.length===spec.limit)throw fault('INCOMPLETE_RESULTS');
          cursors.add(response.nextCursor);cursor=response.nextCursor;
        }
        gate.assert(capture);if(controller.signal.aborted)throw fault('QUERY_CANCELLED');
        // No page data enters the shared cache or a consumer snapshot until every page completes.
        const docs=rawDocs.map(raw=>document(raw));
        return {docs,empty:docs.length===0,size:docs.length,metadata:{fromCache:false,hasPendingWrites:false},forEach:callback=>{gate.assert(capture);docs.forEach(callback);}};
      };
      try{return await Promise.race([collect(),deadline,cancellation]);}
      catch(error){return invalid(error);}
      finally{clearTimer(timer);externalSignal?.removeEventListener('abort',cancel);capture.signal.removeEventListener('abort',ended);controller.abort();}
    }
    const result={
      where(field,op,value){return query([...where,{field,op,value:wire(value)}],orderBy,limit);},
      orderBy(field,direction='asc'){return query(where,[...orderBy,{field,direction}],limit);},
      limit(value){return query(where,orderBy,value);},doc:reference,get:()=>readAll(),
      onSnapshot(...args){
        const next=typeof args[0]==='function'?args[0]:args[1],error=typeof args[0]==='function'?args[1]:args[2];
        if(typeof next!=='function')throw fault('UNSUPPORTED');
        let active=true,timer,busy=false,again=false,revision=0,watchStop;const capture=gate.capture(),controller=new AbortController();
        const stop=()=>{active=false;controller.abort();clearTimer(timer);watchStop?.();subscriptions.delete(stop);};
        const poll=async()=>{
          if(!active)return;if(busy){again=true;return;}busy=true;clearTimer(timer);const started=revision;
          try{gate.assert(capture);const snapshot=await readAll(controller.signal);if(!active)return;gate.assert(capture);if(started===revision)next(snapshot);else again=true;}
          catch(cause){if(active){stop();error?.(fault(normalizePatientErrorCode(cause)));}return;}
          finally{busy=false;}
          if(active){if(again){again=false;void poll();}else if(!subscribe){timer=setTimer(poll,pollIntervalMs);timer?.unref?.();}}
        };
        stop.refresh=()=>{if(active){revision++;clearTimer(timer);void poll();}};
        subscriptions.add(stop);
        if(subscribe){
          const failed=cause=>{if(!active)return;const code=normalizePatientErrorCode(cause);stop();gate.fail(code);error?.(fault(code));};
          try{watchStop=subscribe({query:spec},{ready:()=>{if(active){revision++;void poll();}},change:()=>{if(active){revision++;void poll();}},error:failed,close:()=>failed({code:'COMMUNICATION_FAILURE'})},{signal:controller.signal});if(typeof watchStop!=='function')throw fault('INVALID_RESPONSE');if(!active)watchStop();}
          catch(cause){failed(cause);}
        }else void poll();return stop;
      },
    };return result;
  }
  const files={
    async get(id,kind){
      if(!['pdf','summary-audio'].includes(kind))throw fault('UNSUPPORTED_FILE');
      if(!validId(id))throw fault('UNSUPPORTED_FILE');
      const known=records.get(id);if(!known)throw fault('REFERENCE_REQUIRED');
      if(kind==='pdf' && typeof known.data.originalFileName!=='string')throw fault('REFERENCE_REQUIRED');
      if(kind==='summary-audio' && (!/^dailyBrief_\d{4}-\d{2}-\d{2}$/.test(id) || !(known.data.audioStoragePath || known.data.hasAudio)))throw fault('REFERENCE_REQUIRED');
      const capture=gate.capture();
      if(media){
        try{
          if(kind==='summary-audio'){const url=media.url(id,kind);gate.assert(capture);return url;}
          const response=await media.pdf(id,{signal:capture.signal});gate.assert(capture);
          if(!(response?.blob instanceof BlobType)||response.blob.type!=='application/pdf')throw fault('INVALID_RESPONSE');
          const url=urls.createObjectURL(response.blob);objectUrls.add(url);return url;
        }catch(error){gate.assert(capture);const code=normalizePatientErrorCode(error);if(code!=='NOT_FOUND')gate.fail(code);throw fault(code);}
      }
      const response=await call('file',{id,kind});
      gate.assert(capture);
      const type=kind==='pdf'?'application/pdf':'audio/mpeg';
      if(!(response?.bytes instanceof Uint8Array) || response.bytes.byteLength<1 || response.bytes.byteLength>50*1024*1024 || response.contentType!==type){gate.fail();throw fault('INVALID_RESPONSE');}
      const url=urls.createObjectURL(new BlobType([response.bytes],{type}));objectUrls.add(url);return url;
    },
    revoke(url){if(objectUrls.delete(url))urls.revokeObjectURL(url);},
    ref(){throw fault('UNSUPPORTED_FILE');},
  };
  const db={collection(name){if(name!=='appointments')throw fault('UNSUPPORTED');return query();},batch(){throw fault('UNSUPPORTED_MUTATION');},runTransaction(){throw fault('UNSUPPORTED_MUTATION');}};
  return {db,files,storage:files,dispose(){clear();unbind();}};
}

/** Clears content while retaining existing controls/listeners for the next session. */
export function teardownPatientUI({document,displayedAppointments,pdfViewer,stopConnection,unsubscribe}={}) {
  stopConnection?.();unsubscribe?.();displayedAppointments?.clear();pdfViewer?.close();
  if(!document)return;
  for(const audio of document.querySelectorAll('audio,video')){audio.pause?.();audio.removeAttribute?.('src');audio.load?.();}
  for(const modal of document.querySelectorAll('.modal, dialog')){
    if(modal.open)modal.close?.();
    if(modal.tagName==='DIALOG')modal.style?.removeProperty('display');
    else if(modal.style)modal.style.display='none';
    if(modal.dataset)for(const key of Object.keys(modal.dataset))delete modal.dataset[key];
  }
  for(const selector of ['#appointmentsTable tbody','#mobileAppointmentsList','#summaryModalBody','#summaryModalMeta','#details-content-container','#claimDetailText','#claimDetailIdentity','#shokaijyoSheetContainer','#searchResultsList']){
    const node=document.querySelector(selector);if(node)node.replaceChildren();
  }
  for(const node of document.querySelectorAll('input,textarea,select')){node.value='';if(node.type==='checkbox'||node.type==='radio')node.checked=false;}
  document.body?.classList.remove('modal-open','pdf-open');
  const main=document.querySelector('#main-app-container');if(main?.style)main.style.display='none';
}
