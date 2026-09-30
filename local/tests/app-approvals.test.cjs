const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {AppApprovals}=require('../evidence-review/app-approvals.cjs');
test('only the matching invocation reply completes an app permission; channel close declines pending replies',async()=>{
 const input=new PassThrough(),events=[],host=new AppApprovals(input,e=>events.push(e));
 const first=host.ask({appId:'com.apple.finder',appName:'Finder'});
 input.write(JSON.stringify({type:'appApproval',requestId:'stale',action:'accept'})+'\n');
 assert.equal(host.pending.size,1);
 input.write(JSON.stringify({type:'appApproval',requestId:events[0].requestId,action:'accept'})+'\n');
 assert.equal(await first,'accept');
 const second=host.ask({appId:'com.apple.finder',appName:'Finder'});host.close();
 assert.equal(await second,'decline');assert.equal(host.pending.size,0);
});
