// Isolated local candidate only. Not wired to a website, SDK, token, or live data.
export const MEDIA_LIMITS=Object.freeze({pdf:1048576,'summary-audio':8388608,range:1048576,totalMs:180000,requestMs:25000});
const fault=code=>Object.assign(new Error(code),{code});
const stop=code=>{throw fault(code);};
const types={pdf:'application/pdf','summary-audio':'audio/mpeg'};
function integer(value){if(typeof value!=='string'||!/^\d+$/.test(value))return null;const n=Number(value);return Number.isSafeInteger(n)?n:null;}
export function createRangeAssembler({request,isCurrent,validateResponse=()=>true,BlobType=globalThis.Blob,totalMs=MEDIA_LIMITS.totalMs,requestMs=MEDIA_LIMITS.requestMs}={}){
 if(typeof validateResponse!=='function'||typeof request!=='function'||typeof isCurrent!=='function'||typeof BlobType!=='function'||!Number.isInteger(totalMs)||totalMs<1||totalMs>MEDIA_LIMITS.totalMs||!Number.isInteger(requestMs)||requestMs<1||requestMs>MEDIA_LIMITS.requestMs)stop('INVALID_CONFIGURATION');
 let busy=false,pendingOperations=0,cleanupFailed=false;
 const track=promise=>{pendingOperations++;return Promise.resolve(promise).finally(()=>{pendingOperations--;});};
 return Object.freeze({async load({kind,signal}={}){
  if(!Object.hasOwn(types,kind))stop('UNSUPPORTED_FILE');if(busy)stop('TRANSFER_BUSY');if(pendingOperations>0||cleanupFailed)stop('TRANSFER_DRAINING');busy=true;
  const controller=new AbortController();let reason='TRANSFER_CANCELLED',reader=null,currentBody=null,rangeTimer,totalTimer,rangeDeadline=Infinity;
  const started=performance.now(),cancelled=new WeakSet();
  const cancel=target=>{if(!target||typeof target.cancel!=='function'||cancelled.has(target))return;cancelled.add(target);try{track(target.cancel()).catch(()=>{cleanupFailed=true;});}catch{cleanupFailed=true;}};
  const parts=[];let first=0,total=null,etag=null;
  const abort=code=>{if(!controller.signal.aborted){reason=code;controller.abort();}cancel(reader??currentBody);};
  const guard=()=>{if(controller.signal.aborted)stop(reason);const now=performance.now();if(now-started>=totalMs){abort('TOTAL_DEADLINE');stop('TOTAL_DEADLINE');}if(now>=rangeDeadline){abort('REQUEST_DEADLINE');stop('REQUEST_DEADLINE');}if(isCurrent()!==true){abort('SESSION_BLOCKED');stop('SESSION_BLOCKED');}};
  const wait=promise=>new Promise((resolve,reject)=>{promise=track(promise);const onAbort=()=>reject(fault(reason));if(controller.signal.aborted)return onAbort();controller.signal.addEventListener('abort',onAbort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',onAbort));});
  const onExternal=()=>abort('TRANSFER_CANCELLED');signal?.addEventListener('abort',onExternal,{once:true});if(signal?.aborted)onExternal();
  totalTimer=setTimeout(()=>abort('TOTAL_DEADLINE'),totalMs);
  try{
   while(total===null||first<total){
    guard();const last=Math.min(first+MEDIA_LIMITS.range,total??MEDIA_LIMITS.range)-1;
    rangeDeadline=performance.now()+requestMs;rangeTimer=setTimeout(()=>abort('REQUEST_DEADLINE'),requestMs);
    const pending=Promise.resolve().then(()=>{guard();return request({kind,range:`bytes=${first}-${last}`,ifRange:etag??undefined,signal:controller.signal});});
    // A transport that resolves after cancellation must not retain its body.
    pending.then(response=>{if(controller.signal.aborted)cancel(response?.body);},()=>{});
    const response=await wait(pending);currentBody=response?.body??null;
    if(currentBody?.getReader)reader=currentBody.getReader();guard();
    if(validateResponse(response)!==true)stop('INVALID_RESPONSE');
    if(response?.status===401||response?.status===403)stop('SESSION_BLOCKED');
    if(response?.status===404)stop('NOT_FOUND');
    if(response?.status!==206||response.redirected===true||!reader)stop('INVALID_RESPONSE');
    const headers=response.headers,contentType=headers?.get('content-type'),encoding=headers?.get('content-encoding');
    const observedTag=headers?.get('etag'),match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers?.get('content-range')??'');
    const length=integer(headers?.get('content-length'));
    if(contentType!==types[kind]||(encoding!==null&&encoding!==undefined&&encoding!=='identity')||!/^"g[1-9][0-9]{0,19}"$/.test(observedTag??'')||!match||length===null)stop('INVALID_RESPONSE');
    const start=integer(match[1]),end=integer(match[2]),size=integer(match[3]);
    if(size===null||size<1||size>MEDIA_LIMITS[kind]||start!==first||end!==Math.min(last,size-1)||end<start||length!==end-start+1||length>MEDIA_LIMITS.range)stop('INVALID_RESPONSE');
    if(total!==null&&(size!==total||observedTag!==etag))stop('VERSION_CHANGED');
    total=size;etag=observedTag;let received=0;
    for(;;){const next=await wait(reader.read());guard();if(next.done)break;if(!(next.value instanceof Uint8Array)||received+next.value.byteLength>length)stop('INVALID_RESPONSE');received+=next.value.byteLength;parts.push(next.value);}
    if(received!==length)stop('INVALID_RESPONSE');
    try{reader.releaseLock();}catch{}reader=null;currentBody=null;clearTimeout(rangeTimer);rangeTimer=undefined;rangeDeadline=Infinity;first=end+1;
   }
   guard();const blob=new BlobType(parts,{type:types[kind]});guard();if(blob.size!==total)stop('INVALID_RESPONSE');return Object.freeze({blob,length:total,contentType:types[kind],etag});
  }catch(error){abort(error?.code??'COMMUNICATION_FAILURE');const allowed=['TRANSFER_CANCELLED','SESSION_BLOCKED','NOT_FOUND','INVALID_RESPONSE','VERSION_CHANGED','TOTAL_DEADLINE','REQUEST_DEADLINE'];throw fault(allowed.includes(error?.code)?error.code:'COMMUNICATION_FAILURE');}
  finally{clearTimeout(rangeTimer);clearTimeout(totalTimer);signal?.removeEventListener('abort',onExternal);abort('TRANSFER_CANCELLED');try{reader?.releaseLock();}catch{}parts.length=0;busy=false;}
 }});
}
