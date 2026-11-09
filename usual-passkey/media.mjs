// Development candidate: bounded Blob transport; no token URLs or native cross-origin audio requests.
const ORIGIN='https://access.soslist.niraissc.jp';
const fault=code=>Object.assign(new Error(code),{code});
const fail=()=>{throw fault('MEDIA_DENIED');};
export function mediaRequestHeaders(headers){const result={};for(const [key,value]of Object.entries(headers??{})){if(!['range','if-range'].includes(key)||typeof value!=='string'||value.length>128||/[\r\n]/.test(value))fail();result['x-sos-'+key]=value;}return result;}
function createPdfTransport({origin,fetch:fetcher,timeoutMs=30000,maxBytes=1048576}={}){
 if(origin!==ORIGIN||typeof fetcher!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>1048576)fail();
 async function get(id,kind,{signal}={}){
  if(typeof id!=='string'||!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,255}$/.test(id)||!['pdf','summary-audio'].includes(kind))fail();
  const controller=new AbortController();let reader,timer,rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=reject;});
  const abort=()=>{controller.abort();try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}rejectStop(fault(signal?.aborted?'TRANSFER_CANCELLED':'REQUEST_DEADLINE'));};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();timer=setTimeout(abort,timeoutMs);
  const target=ORIGIN+'/api/patient/file?id='+encodeURIComponent(id)+'&kind='+kind,type=kind==='pdf'?'application/pdf':'audio/mpeg';
  const work=async()=>{
   const chunks=[];let offset=0,total,etag;
   do{
    if(controller.signal.aborted)fail();
    const last=Math.min(offset+65535,(total??maxBytes)-1);
    const response=await fetcher(target,{method:'GET',mode:'cors',credentials:'include',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:mediaRequestHeaders({range:`bytes=${offset}-${last}`,...(etag?{'if-range':etag}:{})})});
    if(controller.signal.aborted)fail();
    if([401,403].includes(response.status))throw fault('SESSION_BLOCKED');
    if(response.status===404)throw fault('NOT_FOUND');
    const h=response.headers,length=h?.get('content-length'),size=Number(length),tag=h?.get('etag');
    if(response.redirected||response.type==='opaqueredirect'||response.url&&response.url!==target||h?.get('content-type')?.split(';')[0]!==type||h?.get('cache-control')!=='private, no-store'||!/^"g[0-9]+"$/.test(tag??'')||!/^\d+$/.test(length??'')||!Number.isSafeInteger(size)||size<1||size>maxBytes||!response.body?.getReader)fail();
    if(response.status===200){
     // An If-Range miss legitimately returns200. Reject a changed version; never append or relabel it206.
     if(offset!==0||etag)fail();total=size;
    }else if(response.status===206){
     const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(h.get('content-range')??'');
     if(!match||Number(match[1])!==offset||Number(match[2])!==Math.min(last,Number(match[3])-1)||Number(match[2])-offset+1!==size||!Number.isSafeInteger(Number(match[3]))||Number(match[3])<1||Number(match[3])>maxBytes||total!==undefined&&total!==Number(match[3]))fail();
     total=Number(match[3]);
    }else fail();
    if(etag&&etag!==tag)fail();etag=tag;
    reader=response.body.getReader();let received=0;
    for(;;){const next=await reader.read();if(controller.signal.aborted)fail();if(next.done)break;if(!(next.value instanceof Uint8Array)||(received+=next.value.length)>size)fail();chunks.push(next.value);}
    if(received!==size)fail();reader.releaseLock();reader=null;offset+=received;
   }while(offset<total);
   return {blob:new Blob(chunks,{type}),contentType:type,length:offset,etag};
  };
  try{return await Promise.race([work(),stopped]);}catch(error){if(['SESSION_BLOCKED','NOT_FOUND','REQUEST_DEADLINE','TRANSFER_CANCELLED','MEDIA_DENIED'].includes(error?.code))throw error;throw fault('COMMUNICATION_FAILURE');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}try{reader?.releaseLock();}catch{}}
 }
 return Object.freeze({pdf:(id,options)=>get(id,'pdf',options),audio:(id,options)=>get(id,'summary-audio',options)});
}

import {createRangeAssembler} from './range-assembler.mjs';
export function createFixedMediaTransport(options={}) {
 const {origin,fetch:fetcher}=options;
 const pdfTransport=createPdfTransport(options);
 let audioContext;
 const assembler=createRangeAssembler({
  isCurrent:()=>!!audioContext && !audioContext.signal?.aborted,
  // Every response body, including URL/cache rejections, stays owned by the assembler.
  validateResponse:response=>{
   const target=ORIGIN+'/api/patient/file?id='+encodeURIComponent(audioContext.id)+'&kind=summary-audio';
   return !response.redirected&&response.type!=='opaqueredirect'&&(!response.url||response.url===target)
    &&([401,403,404].includes(response.status)||response.headers?.get('cache-control')==='private, no-store');
  },
  request:async({kind,range,ifRange,signal})=>{
   const id=audioContext.id;
   const target=ORIGIN+'/api/patient/file?id='+encodeURIComponent(id)+'&kind='+kind;
   return fetcher(target,{method:'GET',mode:'cors',credentials:'include',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal,headers:mediaRequestHeaders({range,...(ifRange?{'if-range':ifRange}:{})})});
  }
 });
 let busy=false;
 return Object.freeze({
  pdf:pdfTransport.pdf,
  async audio(id,{signal}={}){
   if(typeof id!=='string'||!/^dailyBrief_\d{4}-\d{2}-\d{2}$/.test(id))throw fault('UNSUPPORTED_FILE');
   if(busy)throw fault('TRANSFER_BUSY');
   busy=true;audioContext={id,signal};
   try{return await assembler.load({kind:'summary-audio',signal});}
   finally{busy=false;}
  }
 });
}
