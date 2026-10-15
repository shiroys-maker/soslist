const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
function popup(options={}) {
 let handler;
 const context={require:n=>n==='http'?{createServer:fn=>{handler=fn;return{listen(){}};}}:
 n==='./generate-brief'?{}:require(n),process:{env:{}},__dirname:path.join(root,'daily-brief'),URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(root,'daily-brief/server.js'),'utf8'),context);
 let html='';const headers={};handler({method:'GET',url:'/summary-popup?date=2099-01-01',headers:{host:'localhost'}},{setHeader(){},writeHead(status,h){Object.assign(headers,h);},end:s=>{html=s;}});
 const elements=new Map();
 const document={getElementById:id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'',hidden:false,style:{},setAttribute(){},focus(){this.focused=true;},select(){this.selected=true;},classList:{remove(){},add(){}},addEventListener(){},removeAttribute(){}});
  return elements.get(id);
 }};
 const ctx=vm.createContext({document,console,Number,URL,atob,alert(){},navigator:{},fetch:()=>new Promise(()=>{})});
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
  const src=match[1].match(/src="([^"]+)"/);
  if(src && (options.skipRenderer || (options.skipParser && src[1].includes('vendor/'))))continue;
  vm.runInContext(src?fs.readFileSync(path.join(root,src[1]),'utf8'):match[2],ctx);
 }
 return {render:text=>{ctx.renderResult({ymd:'2099-01-01',summaryMarkdown:text});return document.getElementById('summary').innerHTML;},ctx,elements,html,headers};
}
test('actual local popup renders normal Markdown including mixed blocks and tables',()=>{
 const h=popup();const output=h.render('# Synthetic Summary\n## Findings\n- **First** item\n- second\n\n[Reference](https://example.org/info)\n\n| Test | Result |\n| --- | --- |\n| Fiction | Normal |');
 assert.match(output,/<h1>Synthetic Summary<\/h1>/);
 assert.match(output,/<h2>Findings<\/h2>/);assert.match(output,/<ul>/);assert.match(output,/<strong>First<\/strong>/);
 assert.match(output,/<a[^>]+href="https:\/\/example.org\/info"/);assert.match(output,/<table>/);assert.match(output,/<td>Normal<\/td>/);
});
module.exports={popup};

test('cloud page loads the shared renderer before its Summary consumer',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const parser=html.indexOf('shared/vendor/markdown-it/markdown-it.umd.min.js');
 const adapter=html.indexOf('shared/summary-markdown.js');
 assert.ok(parser>0 && adapter>parser && adapter<html.indexOf('src="script.js'));
 assert.match(html,/summary-modal-body summary-markdown/);
});

test('HTML, scripts, SVG, iframes and handlers stay literal text',()=>{
 const output=popup().render('<script>globalThis.pwned=1</script>\n<svg onload="alert(1)"></svg>\n<img src="https://example.invalid/x" onerror="alert(1)">\n<iframe srcdoc="bad"></iframe>');
 assert.doesNotMatch(output,/<(?:script|svg|img|iframe)\b/i);
 assert.match(output,/&lt;script&gt;/);assert.match(output,/&lt;img/);
});

test('dangerous, encoded, relative and protocol-relative links never become anchors',()=>{
 for(const url of ['javascript:alert(1)','JaVaScRiPt:alert(1)','java&#x73;cript:alert(1)','jav&#x09;ascript:alert(1)','vbscript:alert(1)','data:text/html,evil','file:///etc/passwd','soslist:run','//example.invalid/track','/api/action','../private','javascript%3Aalert(1)']) {
  assert.doesNotMatch(popup().render(`[danger](${url})`),/<a\b/i,url);
 }
});

test('reference and angle links use the same explicit scheme allowlist and privacy flags',()=>{
 const output=popup().render('[one][safe]\n\n[safe]: https://example.org/path?q=1&b=2 "Example"\n\n<https://example.org/angle>\n\n[mail](mailto:test@example.org)');
 assert.equal((output.match(/<a /g)||[]).length,3);
 assert.equal((output.match(/rel="noopener noreferrer"/g)||[]).length,3);
 assert.equal((output.match(/referrerpolicy="no-referrer"/g)||[]).length,3);
 assert.doesNotMatch(popup().render('[bad][x]\n\n[x]: javascript:alert(1)'),/<a\b/);
});

test('all Markdown image forms display text without any image resource',()=>{
 const output=popup().render('![Synthetic image](https://example.invalid/track.png)\n\n![ref][image]\n\n[image]: https://example.invalid/reference.png\n\n[![nested](https://example.invalid/nested.png)](https://example.org)\n\n![data](data:image/png;base64,AAAA)');
 assert.doesNotMatch(output,/<(?:img|source|picture)\b|\bsrc(?:set)?=/i);
 assert.match(output,/Synthetic image/);assert.match(output,/画像は読み込みません/);
});

test('plain text, Japanese, CRLF and code remain readable; source copy is byte-for-byte',async()=>{
 const h=popup();const source='架空のメモ\r\nLine two & <literal>\r\n\r\n```html\r\n<script>literal</script>\r\n```\r\n';
 const output=h.render(source);assert.match(output,/架空のメモ/);assert.match(output,/<br>/);assert.match(output,/<pre><code/);assert.match(output,/&lt;script&gt;/);
 assert.equal(h.elements.get('summarySource').value,source);
 let copied;h.ctx.navigator.clipboard={writeText:async value=>{copied=value;}};
 await h.ctx.copySummary();assert.equal(copied,source);
 h.ctx.navigator.clipboard={writeText:async()=>{throw new Error('denied');}};
 await h.ctx.copySummary();assert.equal(h.elements.get('summarySource').hidden,false);assert.equal(h.elements.get('summarySource').selected,true);
 assert.match(h.elements.get('summaryCopyStatus').textContent,/⌘C/);
 h.ctx.toggleSource();assert.equal(h.elements.get('summarySource').hidden,true);
});

test('missing parser or all renderer assets degrade to safe plain text',()=>{
 const source='# Plain\n<script>literal</script>';
 const parserMissing=popup({skipParser:true});assert.match(parserMissing.render(source),/&lt;script&gt;/);
 const rendererMissing=popup({skipRenderer:true});rendererMissing.render(source);
 assert.equal(rendererMissing.elements.get('summary').textContent,source);
});

test('long Summary renders through the final line without truncating original source',()=>{
 const h=popup();const source=('# Synthetic\n\n- **Fiction** only\n\nParagraph 日本語 '.repeat(2500))+'END-SENTINEL';
 const output=h.render(source);assert.match(output,/END-SENTINEL/);assert.equal(h.elements.get('summarySource').value,source);
});

test('popup restricts image/media/connect origins and prevents stale HTML',()=>{
 const {headers}=popup();assert.match(headers['Content-Security-Policy'],/img-src 'none'/);
 assert.match(headers['Content-Security-Policy'],/connect-src 'self'/);assert.match(headers['Content-Security-Policy'],/media-src 'self'/);
 assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers['Referrer-Policy'],'no-referrer');
});

test('prepared cloud deployment includes shared renderer and style assets',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/pages.yml'),'utf8');
 assert.match(workflow,/cp[^\n]*shared\/summary-markdown\.js[^\n]*shared\/summary-markdown\.css[^\n]*site\/shared\//);
});


test('unreadable presentation asset completes a safe error response without rejecting handler',async()=>{
 let handler;const fakeFs={...fs,readFileSync(){throw Object.assign(new Error('synthetic-private-file'),{code:'ENOENT'});}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'daily-brief/server.js'),'utf8'),{
  require:n=>n==='http'?{createServer:fn=>{handler=fn;return{listen(){}};}}:n==='fs'?fakeFs:n==='./generate-brief'?{}:require(n),
  process:{env:{}},__dirname:path.join(root,'daily-brief'),URL,console:{log(){},error(){}}
 });
 let status,body;const res={setHeader(){},writeHead:s=>{status=s;},end:s=>{body=s;}};
 await assert.doesNotReject(()=>handler({method:'GET',url:'/shared/summary-markdown.js',headers:{host:'localhost'}},res));
 assert.equal(status,404);assert.ok(body!==undefined);assert.doesNotMatch(String(body),/synthetic-private-file/);
});
