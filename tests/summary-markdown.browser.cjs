// Synthetic-only end-to-end rendering. No credentials, patient files or live APIs.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core node tests/summary-markdown.browser.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const vm=require('node:vm');
const {once}=require('node:events');
const {createRequire}=require('node:module');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const root=path.resolve(__dirname,'..');
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const fixture='# Synthetic Summary\n## Fictional findings\n- **First** item\n  - nested item\n- second\n\n[Reference](https://example.org/info)\n\n| Test | Result |\n| --- | --- |\n| Fiction | Normal |\n\n> Quoted text\n\n```html\n<script>literal code</script>\n```\n\nPlain text 日本語\nNext line\n\n![Fictional image](https://example.invalid/track.png)\n\n<script>globalThis.pwned=true</script>\n<img src="https://example.invalid/raw.png" onerror="globalThis.pwned=true">\n\n[bad](javascript:alert(1))';
(async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'summary-preview-browser-'));
 const dateDir=path.join(output,'2099-01-01');fs.mkdirSync(dateDir);
 const briefFile=path.join(dateDir,'brief.md'),audioFile=path.join(dateDir,'podcast.wav');
 fs.writeFileSync(briefFile,fixture);
 // Two seconds of silent PCM: metadata and playback without an AI/TTS call.
 const wav=Buffer.alloc(44+16000*2*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
 wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
 wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 fs.writeFileSync(audioFile,wav);
 let reads=0;
 let server;const filename=path.join(root,'daily-brief/server.js');const localRequire=createRequire(filename);
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:n=>n==='http'?{createServer:fn=>{server=http.createServer(fn);return server;}}:
 n==='./generate-brief'?{getExistingBriefResult:ymd=>{reads++;return {exists:ymd!=='2099-01-04',ymd,
 summaryMarkdown:ymd==='2099-01-03'?'':fs.readFileSync(briefFile,'utf8'),audioFile:ymd==='2099-01-01'?audioFile:null};},saveBriefToFirestore:async()=>{}}:localRequire(n),
 process:{env:{PORT:'0',OUTPUT_DIR:output}},__dirname:path.dirname(filename),URL,console:{log(){},error(){assert.fail('server error');}}});
 await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await playwright.chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext();const external=[],errors=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 try{
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>assert.fail('unexpected script dialog'));
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Summary preview must not write the clipboard');}}}));
  for(const viewport of [{width:1180,height:900},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.goto(origin+'/summary-popup?date=2099-01-01');await page.waitForFunction(()=>document.getElementById('status').textContent==='表示中');
   assert.equal(await page.locator('#summary h1').textContent(),'Synthetic Summary');assert.equal(await page.locator('#summary h2').textContent(),'Fictional findings');
   assert.equal(await page.locator('#summary ul ul li').textContent(),'nested item');assert.equal(await page.locator('#summary strong').textContent(),'First');assert.equal(await page.locator('#summary td').last().textContent(),'Normal');
   assert.equal(await page.locator('#summary script, #summary img, #summary svg, #summary iframe').count(),0);assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);
   assert.equal(await page.locator('#summary a').count(),1);assert.equal(await page.locator('#summary a').getAttribute('href'),'https://example.org/info');assert.equal(await page.locator('#summary a').getAttribute('rel'),'noopener noreferrer');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'viewport should not overflow');
   assert.equal(await page.getByRole('button',{name:/原文をコピー|原文を表示/}).count(),0);
   assert.equal(await page.locator('#summarySource,#summaryCopyStatus,#copySummary,#toggleSummarySource').count(),0);
   assert.equal(await page.locator('#summary').isVisible(),true);
   assert.equal(await page.locator('#audioCard').isVisible(),true);
   assert.equal(await page.locator('#audio').getAttribute('controls'),'');
   const selected=await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.getElementById('summary'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();});
   assert.ok(selected.includes('Fictional findings')&&selected.includes('Normal'),'rendered output remains selectable');
   await page.evaluate(()=>getSelection().removeAllRanges());
   if(process.env.SUMMARY_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.SUMMARY_EVIDENCE_DIR,`summary-${viewport.width}.png`),fullPage:true});
  }
  await page.waitForFunction(()=>document.getElementById('audio').readyState>=1);
  assert.equal(await page.locator('#audio').evaluate(e=>e.duration),2);
  await page.locator('#audio').evaluate(async e=>{await e.play();});
  await page.waitForFunction(()=>document.getElementById('audio').currentTime>0);
  await page.locator('#audio').evaluate(e=>e.pause());
  const beforeReload=reads;await page.reload();await page.waitForFunction(()=>document.getElementById('status').textContent==='表示中');
  assert.ok(reads>beforeReload,'reload reads the existing Summary');
  assert.equal(await page.locator('#summary h1').textContent(),'Synthetic Summary');
  assert.equal(await page.locator('#audioCard').isVisible(),true);
  assert.equal(fs.readFileSync(briefFile,'utf8'),fixture,'view and reload preserve saved source');
  assert.deepEqual(fs.readFileSync(audioFile),wav,'view and playback preserve saved audio');
  const crlf=fixture.replace(/\n/g,'\r\n');await page.evaluate(text=>renderResult({ymd:'2099-01-01',summaryMarkdown:text}),crlf);
  assert.equal(await page.locator('#summary h1').textContent(),'Synthetic Summary');
  assert.equal(await page.locator('#summary').isVisible(),true,'CRLF preview remains visible');
  const long=('# Long synthetic\n\n| Test | Result |\n| --- | --- |\n| Fiction | Normal |\n\nParagraph 日本語 '.repeat(2500))+'END-SENTINEL';
  await page.evaluate(text=>renderResult({ymd:'2099-01-01',summaryMarkdown:text}),long);
  assert.ok((await page.locator('#summary').textContent()).trimEnd().endsWith('END-SENTINEL'));await page.locator('#summary').evaluate(e=>e.lastElementChild.scrollIntoView());
  await page.goto(origin+'/summary-popup?date=2099-01-02');await page.waitForFunction(()=>document.getElementById('status').textContent==='表示中');
  assert.equal(await page.locator('#summary').isVisible(),true);assert.equal(await page.locator('#audioCard').isVisible(),false);
  await page.goto(origin+'/summary-popup?date=2099-01-03');await page.waitForFunction(()=>document.getElementById('status').textContent==='表示中');
  assert.match(await page.locator('#summary').textContent(),/要約なし/);
  await page.goto(origin+'/summary-popup?date=2099-01-04');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('未作成'));
  assert.equal(await page.locator('#summaryCard').isVisible(),false);
  await page.route('**/api/brief-status?*',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false})}));
  await page.reload();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('取得できませんでした'));
  await page.unroute('**/api/brief-status?*');
  await page.goto(origin+'/summary-popup?date=2099-01-01');await page.waitForFunction(()=>document.getElementById('status').textContent==='表示中');
  assert.equal(await page.locator('#summary h1').textContent(),'Synthetic Summary','normal reload recovers from fetch failure');
  const assets=['/shared/summary-markdown.css','/shared/summary-markdown.js','/shared/vendor/markdown-it/markdown-it.umd.min.js'];
  for(const file of assets){const response=await fetch(origin+file);assert.equal(response.status,200);assert.equal(await response.text(),fs.readFileSync(path.join(root,file),'utf8'));}
  for(const file of ['/shared/core.js','/shared/../config.js','/shared/summary-markdown.js/extra'])assert.equal((await fetch(origin+file)).status,404);
  if(process.env.SUMMARY_WK_RUNNER){
   const native=await promisify(execFile)(process.env.SUMMARY_WK_RUNNER,[origin+'/summary-popup?date=2099-01-01']);
   const nativeResult=JSON.parse(native.stdout);assert.equal(nativeResult.ok,true);console.log(JSON.stringify(nativeResult));
  }
  // Cloud consumer also uses the exact shared parser without loading Firebase.
  const cloud=await context.newPage();await cloud.setContent('<div id="summaryModal"><h3 id="summaryModalTitle"></h3><div id="summaryModalMeta"></div><div id="summaryModalBody" class="summary-markdown"></div></div>');
  for(const file of ['shared/vendor/markdown-it/markdown-it.umd.min.js','shared/summary-markdown.js'])await cloud.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  const web=fs.readFileSync(path.join(root,'script.js'),'utf8');
  await cloud.addScriptTag({content:'const summaryModal=document.getElementById("summaryModal"),summaryModalTitle=document.getElementById("summaryModalTitle"),summaryModalMeta=document.getElementById("summaryModalMeta"),summaryModalBody=document.getElementById("summaryModalBody");'+web.slice(web.indexOf('function renderMarkdownToHtml('),web.indexOf('function closeSummaryModal('))});
  await cloud.evaluate(text=>openSummaryModal('2099-01-01',text),fixture);assert.equal(await cloud.locator('#summaryModalBody table').count(),1);assert.equal(await cloud.locator('#summaryModalBody script, #summaryModalBody img').count(),0);
  // Existing native detail initialization still avoids the browser payload cache (86ae567).
  const details=await context.newPage();await details.setContent(fs.readFileSync(path.join(root,'local/details.html'),'utf8').replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,''));
  await details.evaluate(()=>{
   window.__SOSLIST_DETAILS_PAYLOAD__={docId:'synthetic-only',claimantName:'SYNTHETIC TEST',notes:'Existing fictional memo',claimDetail:'Fictional claim',services:[],contractNumber:'TEST.1'};
   window.webkit={messageHandlers:{saveDetails:{postMessage:body=>{window.__saved=body;}}}};
   Storage.prototype.getItem=()=>{throw new Error('full payload cache');};Storage.prototype.setItem=()=>{throw new Error('full payload cache');};
  });
  await details.addScriptTag({content:fs.readFileSync(path.join(root,'local/details.js'),'utf8')});
  assert.equal(await details.locator('#notesTextarea').inputValue(),'Existing fictional memo');
  await details.locator('#notesTextarea').fill('Unsaved synthetic draft');await page.close();
  assert.equal(await details.locator('#notesTextarea').inputValue(),'Unsaved synthetic draft');
  await details.getByRole('button',{name:'保存',exact:true}).click();assert.ok(await details.evaluate(()=>window.__saved),'native detail save bridge still works');
  assert.deepEqual(external,[],'no external requests attempted');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,viewports:2,normalMarkdown:true,xss:true,noExternalRequests:true,sourceControlsRemoved:true,renderedSelection:true,reload:true,savedSourceAndAudioPreserved:true,audioPlayback:true,missingAudio:true,emptyAndMissingSummary:true,fetchFailureRecovery:true,longCharacters:long.length,details86ae567:true,assetsMatchSource:true,cloudConsumer:true}));
 } finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(output,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
