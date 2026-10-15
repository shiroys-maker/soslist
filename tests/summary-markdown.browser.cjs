// Synthetic-only end-to-end rendering. No credentials, patient files or live APIs.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core node tests/summary-markdown.browser.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
 let server;const filename=path.join(root,'daily-brief/server.js');const localRequire=createRequire(filename);
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:n=>n==='http'?{createServer:fn=>{server=http.createServer(fn);return server;}}:
 n==='./generate-brief'?{getExistingBriefResult:ymd=>({exists:true,ymd,summaryMarkdown:fixture}),saveBriefToFirestore:async()=>{}}:localRequire(n),
 process:{env:{PORT:'0'}},__dirname:path.dirname(filename),URL,console:{log(){},error(){assert.fail('server error');}}});
 await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await playwright.chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext();const external=[],errors=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 try{
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>assert.fail('unexpected script dialog'));
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}}));
  for(const viewport of [{width:1180,height:900},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.goto(origin+'/summary-popup?date=2099-01-01');await page.waitForFunction(()=>document.getElementById('status').textContent==='表示中');
   assert.equal(await page.locator('#summary h1').textContent(),'Synthetic Summary');assert.equal(await page.locator('#summary h2').textContent(),'Fictional findings');
   assert.equal(await page.locator('#summary ul ul li').textContent(),'nested item');assert.equal(await page.locator('#summary strong').textContent(),'First');assert.equal(await page.locator('#summary td').last().textContent(),'Normal');
   assert.equal(await page.locator('#summary script, #summary img, #summary svg, #summary iframe').count(),0);assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);
   assert.equal(await page.locator('#summary a').count(),1);assert.equal(await page.locator('#summary a').getAttribute('href'),'https://example.org/info');assert.equal(await page.locator('#summary a').getAttribute('rel'),'noopener noreferrer');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'viewport should not overflow');
   await page.getByRole('button',{name:'原文をコピー'}).click();assert.equal(await page.evaluate(()=>window.__copied),fixture);
   await page.getByRole('button',{name:'原文を表示',exact:true}).click();assert.equal(await page.locator('#summarySource').inputValue(),fixture);assert.equal(await page.locator('#summarySource').getAttribute('readonly'),'');
   await page.getByRole('button',{name:'表示に戻る'}).click();
   const selected=await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.getElementById('summary'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();});
   assert.ok(selected.includes('Fictional findings')&&selected.includes('Normal'),'rendered output remains selectable');
   await page.evaluate(()=>getSelection().removeAllRanges());
   if(process.env.SUMMARY_EVIDENCE_DIR)await page.screenshot({path:path.join(process.env.SUMMARY_EVIDENCE_DIR,`summary-${viewport.width}.png`),fullPage:true});
  }
  const crlf=fixture.replace(/\n/g,'\r\n');await page.evaluate(text=>renderResult({ymd:'2099-01-01',summaryMarkdown:text}),crlf);
  await page.getByRole('button',{name:'原文をコピー'}).click();assert.equal(await page.evaluate(()=>window.__copied),crlf,'copy retains original CRLF');
  await page.evaluate(text=>renderResult({ymd:'2099-01-01',summaryMarkdown:text}),fixture);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('denied');};});
  await page.getByRole('button',{name:'原文をコピー'}).click();assert.equal(await page.locator('#summarySource').isVisible(),true);
  assert.equal(await page.locator('#summarySource').evaluate(e=>e.selectionEnd-e.selectionStart),fixture.length);
  const long=('# Long synthetic\n\n| Test | Result |\n| --- | --- |\n| Fiction | Normal |\n\nParagraph 日本語 '.repeat(2500))+'END-SENTINEL';
  await page.evaluate(text=>renderResult({ymd:'2099-01-01',summaryMarkdown:text}),long);
  assert.equal(await page.locator('#summarySource').inputValue(),long);await page.getByRole('button',{name:'表示に戻る'}).click();
  assert.ok((await page.locator('#summary').textContent()).trimEnd().endsWith('END-SENTINEL'));await page.locator('#summary').evaluate(e=>e.lastElementChild.scrollIntoView());
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
  console.log(JSON.stringify({ok:true,viewports:2,normalMarkdown:true,xss:true,noExternalRequests:true,copyExactAndFallback:true,renderedSelection:true,longCharacters:long.length,details86ae567:true,assetsMatchSource:true,cloudConsumer:true}));
 } finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
