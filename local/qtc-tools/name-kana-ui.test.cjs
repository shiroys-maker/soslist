const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const pending=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function field(text='') {return {value:text,innerText:text,isConnected:true,listeners:new Set(),
 addEventListener(_,fn){this.listeners.add(fn);}, removeEventListener(_,fn){this.listeners.delete(fn);},edit(){for(const f of this.listeners)f();}};}
function harness(source, kind){
 const start=source.indexOf('async function fetchNameKana(');
 const end=source.indexOf(kind==='referral'?'function normalizeServiceTokens(':'function applyReportFields',start);
 const requests=[];let fields=[field()];const out=field('変換中...');
 const ctx=vm.createContext({AbortController,setTimeout,clearTimeout,console,
 canUseLocalNameKanaAPI:()=>true,window:{location:{hostname:'localhost',protocol:'http:'}},
 shokaijyoSheetContainer:{querySelectorAll:()=>fields},document:{getElementById:()=>out},
 fetch:()=>{const p=pending();requests.push(p);return p.promise;}});
 vm.runInContext(source.slice(start,end),ctx);
 return {ctx,requests,out,get fields(){return fields;},swap(){fields=[field()];},reply(i,kana){requests[i].resolve({ok:true,json:async()=>({kana})});}};
}
test('referral replies cannot fill another patient or overwrite manual editing',async()=>{
 const h=harness(fs.readFileSync(path.join(__dirname,'../../shared/core.js'),'utf8'),'referral');
 h.ctx.autofillShokaijyoKana('Alex Example');const old=h.fields[0];h.swap();h.ctx.autofillShokaijyoKana('Robin Sample');
 h.reply(0,'アレックス');await tick();assert.equal(h.fields[0].value,'');assert.equal(old.value,'');
 h.fields[0].edit();h.reply(1,'ロビン');await tick();assert.equal(h.fields[0].value,'');
 h.ctx.autofillShokaijyoKana('Robin Sample');h.reply(2,'ロビン');await tick();assert.equal(h.fields[0].value,'ロビン');
});
const report=process.env.NAME_KANA_REPORT_HTML;
test('ImageReport clears pending on failure and ignores stale replies and manual edits',{skip:!report},async()=>{
 const h=harness(fs.readFileSync(report,'utf8'),'report');
 h.ctx.autofillReportKana('Alex Example');h.ctx.autofillReportKana('Robin Sample');
 h.reply(0,'アレックス');await tick();assert.equal(h.out.innerText,'変換中...');
 h.reply(1,'');await tick();assert.equal(h.out.innerText,'');assert.match(h.out.title,/手入力/);
 h.out.innerText='変換中...';h.ctx.autofillReportKana('Alex Example');h.out.innerText='テスト';h.out.edit();
 h.reply(2,'アレックス');await tick();assert.equal(h.out.innerText,'テスト');assert.equal(h.out.listeners.size,0);
});
