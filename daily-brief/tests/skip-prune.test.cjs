'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const generator=path.resolve(__dirname,'../generate-brief.js'),source=fs.readFileSync(generator,'utf8');
const ymd='2099-01-01',output='/anonymous-fixture/output';
function harness(args=[],cli=false,{uploadFailure=false,ttsFailure=false,conversionFailure=false,writeFailure=false,pruneFailure=false,readbackFailure=false,previous=null,localAudio=true}={}){
 const calls={uploads:[],deletes:[],lists:0,prunes:0,tts:0,conversion:0,saves:[],reads:0,errors:[],stdout:'',events:[]};const documents=new Map(previous?[['dailyBrief_'+ymd,previous]]:[]);
 const snapshot=id=>({exists:documents.has(id),data:()=>({...documents.get(id)})});
 const reference=id=>({id,async set(value,options){if(writeFailure)throw Error('synthetic Summary write failure');documents.set(id,{...documents.get(id),...value});calls.saves.push({id,value,options});calls.events.push('save');},async get(){calls.reads++;calls.events.push('readback');const s=snapshot(id);if(readbackFailure)return {exists:true,data:()=>({...s.data(),summaryMarkdown:'CONCURRENT SYNTHETIC CHANGE'})};return s;}});
 const db={collection(name){assert.equal(name,'appointments');return {doc(id){assert.match(id,/^dailyBrief_(2099-01-01|2098-12-31)$/);return reference(id);}};},async runTransaction(fn){const pending=[];await fn({get:async target=>snapshot(target.id),set:(target,value,options)=>pending.push([target,value,options])});for(const [target,value,options] of pending)await target.set(value,options);}};
 const bucket={async upload(file,opts){calls.events.push('upload');calls.uploads.push({file,destination:opts.destination});if(uploadFailure)throw Error('synthetic upload failure');},async getFiles(){calls.events.push('prune');calls.lists++;if(pruneFailure)throw Error('synthetic prune failure');return [[ymd,'2098-12-31','2098-12-30'].map(date=>({name:`daily-brief/${date}/podcast.mp3`,async delete(){calls.deletes.push(date);}}))];}};
 const admin={apps:[{}],firestore:()=>db,storage:()=>({bucket:()=>bucket})};admin.firestore.FieldValue={serverTimestamp:()=> 'anonymous timestamp'};
 const fakeFS={existsSync:file=>!String(file).match(/podcast\.(mp3|wav)$/)||localAudio,readFileSync(file){if(file.endsWith('brief.md'))return '# '+ymd+' Synthetic Summary';if(file.endsWith('podcast-script.txt'))return '進行役: Synthetic memo.\n専門役: Synthetic explanation.';throw Error('Unexpected file read');},writeFileSync(){},readdirSync(){return [ymd,'2098-12-31','2098-12-30'].map(name=>({name,isDirectory:()=>true}));}};
 const mod={exports:{}},req=name=>name==='fs'?fakeFS:name==='firebase-admin'?admin:name==='child_process'?{spawnSync(){assert.fail('Real process must not run');}}:name==='./prepare-speech'?{async prepareSpeechDialogue(dialogue){calls.conversion++;if(conversionFailure)throw Error('synthetic conversion failure');return dialogue;}}:name==='./gemini-tts'?{settings:()=>({model:'synthetic-tts',voiceA:'A',voiceB:'B'}),validateSettings(){},async synthesizeGemini(dialogue,base){calls.events.push('tts');calls.tts++;assert.equal(dialogue.length,2);if(ttsFailure)throw Error('synthetic TTS failure');return {mp3Path:base+'.mp3'};}}:require(name);
 if(cli)req.main=mod;
 const fixtureProcess={argv:['node',generator,...args],env:{OUTPUT_DIR:output},stdout:{write(text){calls.stdout+=text;}},exit(code){this.exitCode=code;}};
 const ctx=vm.createContext({require:req,module:mod,__dirname:path.dirname(generator),process:fixtureProcess,console:{error(...items){calls.errors.push(items.join(' '));}}});
 vm.runInContext(source,ctx,{filename:generator});const prune=ctx.pruneStoredPodcasts;ctx.pruneStoredPodcasts=async(...args)=>{calls.prunes++;return prune(...args);};return {ctx,calls,api:mod.exports,get stored(){return documents.get('dailyBrief_'+ymd);}};
}
for(const entry of ['--finalize-prepared','--finalize-manual','--no-audio','--sync-audio'])for(const skipPrune of [false,true])test(`${entry} saves Summary independently and skip-prune=${skipPrune} controls retention`,async()=>{
 const args=entry==='--no-audio'?['--finalize-prepared','--no-audio']: [entry];
 const h=harness([...args,'--date',ymd,'--count','2',...(skipPrune?['--skip-prune']:[])],true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.ctx.process.exitCode,undefined,h.calls.errors.join('\n'));
 const noAudio=entry==='--no-audio',sync=entry==='--sync-audio';
 assert.equal(h.calls.prunes,noAudio||skipPrune?0:1);assert.equal(h.calls.lists,noAudio||skipPrune?0:1);assert.equal(h.calls.deletes.length,noAudio||skipPrune?0:1);
 assert.equal(h.calls.uploads.length,noAudio?0:sync?2:1);assert.equal(h.calls.saves.length,noAudio?1:2);
 assert.equal(h.calls.tts,sync||noAudio?0:1);assert.equal(h.calls.conversion,h.calls.tts);
 assert.equal(h.calls.saves.at(-1).id,`dailyBrief_${sync?'2098-12-31':ymd}`);
 if(!sync){
  assert.equal(h.calls.saves[0].value.summaryMarkdown,'# '+ymd+' Synthetic Summary');assert.equal(h.calls.saves[0].value.appointmentCount,2);assert.equal(h.calls.saves[0].value.hasAudio,false);
  assert.equal(h.calls.reads,noAudio?1:2);assert.ok(!h.calls.stdout.includes('Synthetic Summary'));assert.equal(JSON.parse(h.calls.stdout).summarySaved,true);
  if(!noAudio){assert.deepEqual(h.calls.events.slice(0,3),['save','readback','tts']);assert.equal(h.calls.saves[1].value.hasAudio,true);assert.ok(h.calls.events.lastIndexOf('save')<h.calls.events.indexOf('prune')||skipPrune);}
 }
});
test('skip-prune sync reports skipped retention without claiming retained contents',async()=>{
 const h=harness();const result=await h.api.syncLatestPodcastAudio({skipPrune:true});assert.equal(result.pruneSkipped,true);assert.equal(result.retained,null);assert.equal(h.calls.deletes.length,0);
});
for(const failure of ['uploadFailure','ttsFailure','conversionFailure'])test(`${failure} preserves independently verified Summary and previous valid cloud audio`,async()=>{
 const previous={docType:'dailyBrief',dailyBriefDate:ymd,appointmentCount:2,hasAudio:true,audioFilename:'podcast.mp3',audioStoragePath:'daily-brief/'+ymd+'/podcast.mp3'};
 const h=harness([],false,{[failure]:true,previous});await assert.rejects(h.api.finalizeManualImport({date:ymd,skipPrune:true}),/synthetic/);
 assert.equal(h.calls.saves.length,1);assert.equal(h.calls.reads,1);assert.equal(h.stored.summaryMarkdown,'# '+ymd+' Synthetic Summary');assert.equal(h.stored.appointmentCount,2);
 assert.equal(h.stored.hasAudio,true);assert.equal(h.stored.audioStoragePath,previous.audioStoragePath);assert.equal(h.calls.deletes.length,0);assert.equal(h.calls.lists,0);
});
test('Summary-only recovery does not call conversion, TTS, upload or prune and retains cloud audio metadata even without local audio',async()=>{
 const previous={appointmentCount:2,hasAudio:true,audioFilename:'podcast.mp3',audioStoragePath:'daily-brief/'+ymd+'/podcast.mp3'};
 const h=harness([],false,{previous,localAudio:false});const result=await h.api.finalizeManualImport({date:ymd,noAudio:true,skipPrune:true});
 assert.equal(result.count,2);assert.equal(result.hasAudio,true);assert.equal(h.calls.saves.length,1);assert.equal(h.calls.reads,1);assert.equal(h.calls.tts,0);assert.equal(h.calls.conversion,0);assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.deletes.length,0);assert.equal(h.stored.audioStoragePath,previous.audioStoragePath);
});
test('Summary readback mismatch stops before any paid audio work',async()=>{
 const h=harness([],false,{readbackFailure:true});await assert.rejects(h.api.finalizeManualImport({date:ymd,skipPrune:true}),/再読取/);assert.equal(h.calls.tts,0);assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.deletes.length,0);
});
test('Summary write failure stops before conversion, TTS and Storage changes',async()=>{
 const h=harness([],false,{writeFailure:true});await assert.rejects(h.api.finalizeManualImport({date:ymd,skipPrune:true}),/synthetic Summary write/);assert.equal(h.calls.saves.length,0);assert.equal(h.calls.conversion,0);assert.equal(h.calls.tts,0);assert.equal(h.calls.uploads.length,0);assert.equal(h.calls.deletes.length,0);
});
test('explicit zero appointment count replaces a previous nonzero count during Summary-only save',async()=>{
 const h=harness([],false,{previous:{appointmentCount:2}});const result=await h.api.finalizeManualImport({date:ymd,count:0,noAudio:true,skipPrune:true});assert.equal(result.count,0);assert.equal(h.stored.appointmentCount,0);assert.equal(h.calls.reads,1);assert.equal(h.calls.tts,0);
});
test('retention failure occurs only after uploaded audio metadata and Summary are saved and verified',async()=>{
 const h=harness([],false,{pruneFailure:true});await assert.rejects(h.api.finalizeManualImport({date:ymd,count:2}),/synthetic prune/);assert.equal(h.calls.saves.length,2);assert.equal(h.calls.reads,2);assert.equal(h.stored.hasAudio,true);assert.equal(h.stored.appointmentCount,2);assert.equal(h.calls.deletes.length,0);
});
