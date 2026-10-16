const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
class Element{
 constructor(){this.style={removeProperty(){},setProperty(){}};this.dataset={};this.listeners={};this.value='SYNTHETIC';this.textContent='';this.innerHTML='';this.children=[];this.classList={add(){},remove(){},toggle(){},contains(){return false}}}
 addEventListener(n,f){this.listeners[n]=f}setAttribute(n,v){this[n]=v}removeAttribute(n){delete this[n]}append(...v){this.children.push(...v)}prepend(...v){this.children.unshift(...v)}replaceChildren(...v){this.children=v;this.innerHTML='';this.textContent=''}querySelectorAll(q){return q==='audio'?this.children:[]}querySelector(){return new Element()}pause(){this.paused=true}load(){this.loaded=true}
}
function harness(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)},reads=[],listeners=[],writes=[];let onAuth;
 const query={where(){return this},orderBy(){return this},limit(){return this},get(){const p=deferred();reads.push(p);return p.promise},onSnapshot(...args){listeners.push(args.find(x=>typeof x==='function'));return ()=>{}},doc(){return this},update(data){writes.push(data);return Promise.resolve()}};
 const auth={onAuthStateChanged(fn){onAuth=fn},signOut:async()=>{},signInWithEmailAndPassword:async()=>{}};
 const document={getElementById:node,querySelector:q=>node(q==='#appointmentsTable tbody'?'table':q),querySelectorAll:q=>q==='.modal'?['summaryModal','detailsModal','shokaijyoModal','searchResultsModal','editModal','visitDateModal','editPhoneModal'].map(node):q==='.modal input, .modal textarea, .modal select'?['notesTextarea','phoneInput','visitDateInput','visitTimeInput','dateSelect'].map(node):[],body:node('body'),createElement:()=>new Element(),activeElement:null};
 const window={addEventListener(){},sosConnection:{stop(){},start(){},begin(){return 1},snapshot(){return true}},sosPdfViewer:{close(){node('pdf').closed=true},warmup(){}},innerWidth:1000};
 const ctx=vm.createContext({console,window,document,HTMLElement:Element,Date,Intl,alert(){},setTimeout,clearTimeout,setInterval(){return 1},clearInterval(){},localStorage:{getItem(){return null},setItem(){}},firebase:{initializeApp(){},auth:()=>auth,firestore:()=>({collection:()=>query}),storage:()=>({ref:()=>({getDownloadURL:async()=>''})})}});
 vm.runInContext(fs.readFileSync(path.join(root,'shared/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'script.js'),'utf8'),ctx);
 return {ctx,node,reads,listeners,writes,auth,logout:()=>onAuth(null),enable:()=>ctx.setSensitiveViewsAllowed(true)};
}
const tick=()=>new Promise(r=>setImmediate(r));
const doc=()=>({exists:true,data:()=>({claimantName:'SYNTHETIC ONLY',notes:'SYNTHETIC NOTE',services:[],summaryMarkdown:'SYNTHETIC SUMMARY'})});
test('document IDs are escaped in both layouts without changing the data key',()=>{
 const h=harness();h.node('dateFilter').value='2026-10-17';h.ctx.setupRealtimeListener();const id='synthetic"><img src=x onerror="globalThis.synthetic=1">';
 h.listeners.at(-1)({forEach:fn=>fn({id,data:()=>({...doc().data(),appointmentDateTime:{toDate:()=>new Date('2026-10-17T00:00:00Z')}})})});
 for(const name of ['table','mobileAppointmentsList']){assert(!h.node(name).innerHTML.includes('<img src=x'));assert(h.node(name).innerHTML.includes('&quot;&gt;&lt;img'))}assert(vm.runInContext('displayedAppointments.has('+JSON.stringify(id)+')',h.ctx));
});
test('logout removes displayed records, modal contents, passwords and audio sources',()=>{
 const h=harness(),audio=new Element();audio.src='synthetic://audio';h.node('summaryModalBody').children=[audio];
 for(const id of ['summaryModal','detailsModal','shokaijyoModal'])h.node(id).style.display='flex';
 for(const id of ['table','mobileAppointmentsList','details-content-container','searchResultsList','shokaijyoSheetContainer'])h.node(id).innerHTML='SYNTHETIC';h.logout();
 for(const id of ['summaryModal','detailsModal','shokaijyoModal'])assert.equal(h.node(id).style.display,'none');
 for(const id of ['table','mobileAppointmentsList','details-content-container','searchResultsList','shokaijyoSheetContainer'])assert.equal(h.node(id).innerHTML,'');
 assert.equal(h.node('notesTextarea').value,'');assert.equal(h.node('loginPassword').value,'');assert(audio.paused&&audio.loaded);assert.equal(audio.src,undefined);assert(h.node('pdf').closed);
});
test('late modal reads cannot reopen views after logout or a new session',async()=>{
 for(const [method,args,modal] of [['openDetailsModal',['synthetic'],'detailsModal'],['openShokaijyoModal',['synthetic','KIN'],'shokaijyoModal'],['openEditModal',['synthetic'],'editModal'],['openPhoneEditModal',['synthetic'],'editPhoneModal'],['openVisitDateModal',['synthetic','KIN'],'visitDateModal']]){
 const h=harness();h.ctx[method](...args);assert.equal(h.reads.length,1);h.logout();h.enable();h.reads[0].resolve(doc());await tick();assert.equal(h.node(modal).style.display,'none',method)}
});
test('late summary cannot repopulate text after logout',async()=>{
 const h=harness(),operation=h.ctx.showSummary();assert.equal(h.reads.length,1);h.logout();h.enable();h.reads[0].resolve(doc());await operation;assert.equal(h.node('summaryModal').style.display,'none');assert.equal(h.node('summaryModalBody').innerHTML,'');
});
test('late search cannot restore results after logout',async()=>{
 const h=harness();h.node('searchInput').value='SYNTHETIC';h.ctx.searchAppointments();assert.equal(h.reads.length,1);h.logout();h.enable();h.reads[0].resolve({docs:[doc(),doc()],empty:false});await tick();assert.equal(h.node('searchResultsList').innerHTML,'');assert.equal(h.node('searchResultsModal').style.display,'none');
});
test('sign-out failure still clears the screen and invalidates pending views',async()=>{
 const h=harness();h.auth.signOut=async()=>{throw Error('synthetic failure')};h.node('notesTextarea').value='SYNTHETIC';await h.node('logoutButton').listeners.click();assert.equal(h.node('notesTextarea').value,'');assert.equal(h.node('main-app-container').style.display,'none');assert.equal(h.ctx.captureSensitiveViewSession()(),false);assert.match(h.node('loginError').textContent,/ログアウトを完了できませんでした/);
});
test('current-session details remain available',async()=>{
 const h=harness();h.ctx.openDetailsModal('synthetic');h.reads[0].resolve(doc());await tick();assert.equal(h.node('detailsModal').style.display,'flex');assert.equal(h.node('notesTextarea').value,'SYNTHETIC NOTE');
});

test('status reads started before logout cannot write under a later session',async()=>{
 const h=harness(),button=new Element(),pending=h.ctx.toggleAppointmentStatus(button,'synthetic','isShown');
 assert.equal(h.reads.length,1);h.logout();h.enable();h.reads[0].resolve(doc());await pending;assert.equal(h.writes.length,0);
});
test('list cannot restart while signed out and queued snapshots stay cancelled',()=>{
 const h=harness();h.node('dateFilter').value='2026-10-17';h.ctx.setupRealtimeListener();const listener=h.listeners.at(-1);
 h.logout();h.ctx.setupRealtimeListener();assert.equal(h.listeners.length,1);listener({forEach:()=>{throw Error('stale snapshot accessed')}});assert.equal(h.node('table').innerHTML,'');
});
