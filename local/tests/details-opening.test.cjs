const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
const opening=source.slice(source.indexOf('function openDetailsModal('),source.indexOf('function buildDetailsPayload('));
function harness({native=true,storageError=false}={}) {
 const payload={docId:'synthetic-id',notes:'Synthetic memo',claimDetail:'Synthetic claim',services:[]};
 const messages=[],writes=[],alerts=[];const popup={location:{}};
 const ctx={readInteractionAppointment:async()=>({exists:true,data:()=>payload}),buildDetailsPayload:()=>payload,
  DETAIL_PAYLOAD_PREFIX:'soslist-detail-payload:',encodeURIComponent,
  alert:message=>alerts.push(message),console:{error(){}},
  localStorage:{setItem(key,value){writes.push([key,value]);if(storageError){const error=new Error('Storage quota exceeded');error.name='QuotaExceededError';throw error;}}},
  window:{open:()=>popup}};
 if(native)ctx.window.webkit={messageHandlers:{openDetailsWindow:{postMessage:body=>messages.push(body)}}};
 vm.runInNewContext(opening,ctx);
 return{ctx,payload,messages,writes,alerts,popup};
}
test('native details opens with its complete snapshot when the browser cache is full',async()=>{
 const h=harness({storageError:true});h.ctx.openDetailsModal('synthetic-id');await flush();
 assert.equal(h.messages.length,1);assert.equal(h.messages[0],h.payload);
 assert.deepEqual(h.alerts,[]);assert.equal(h.writes.length,0);
});
test('native details does not grow the unused browser payload cache',async()=>{
 const h=harness();h.ctx.openDetailsModal('synthetic-id');await flush();
 assert.equal(h.messages.length,1);assert.equal(h.writes.length,0);
});
test('browser details still receives the cached snapshot and encoded ID',async()=>{
 const h=harness({native:false});h.ctx.openDetailsModal('synthetic id');await flush();
 assert.equal(h.messages.length,0);assert.deepEqual(h.writes,[['soslist-detail-payload:synthetic id',JSON.stringify(h.payload)]]);
 assert.equal(h.popup.location.href,'details.html#id=synthetic%20id');assert.deepEqual(h.alerts,[]);
});
