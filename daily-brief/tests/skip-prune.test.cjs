'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const generator=path.resolve(__dirname,'../generate-brief.js'),source=fs.readFileSync(generator,'utf8');
const ymd='2099-01-01',output='/anonymous-fixture/output';
function harness(args=[],cli=false,{uploadFailure=false,ttsFailure=false}={}){
 const calls={uploads:[],deletes:[],lists:0,prunes:0,tts:0,conversion:0,saves:[],errors:[]};
 const bucket={async upload(file,opts){calls.uploads.push({file,destination:opts.destination});if(uploadFailure)throw Error('synthetic upload failure');},async getFiles(){calls.lists++;return [[ymd,'2098-12-31','2098-12-30'].map(date=>({name:`daily-brief/${date}/podcast.mp3`,async delete(){calls.deletes.push(date);}}))];}};
 const db={collection(name){assert.equal(name,'appointments');return {doc(id){return {async set(value,options){calls.saves.push({id,value,options});}};}};}};
 const admin={apps:[{}],firestore:()=>db,storage:()=>({bucket:()=>bucket})};
 admin.firestore.FieldValue={serverTimestamp:()=> 'anonymous timestamp'};
 const fakeFS={existsSync:()=>true,readFileSync(file){if(file.endsWith('brief.md'))return '# '+ymd+' Synthetic Summary';if(file.endsWith('podcast-script.txt'))return '進行役: Synthetic memo.\n専門役: Synthetic explanation.';throw Error('Unexpected file read: '+file);},writeFileSync(){},readdirSync(){return [ymd,'2098-12-31','2098-12-30'].map(name=>({name,isDirectory:()=>true}));}};
 const mod={exports:{}},req=name=>name==='fs'?fakeFS:name==='firebase-admin'?admin:name==='child_process'?{spawnSync(){assert.fail('Real process must not run');}}:name==='./prepare-speech'?{async prepareSpeechDialogue(dialogue){calls.conversion++;return dialogue;}}:name==='./gemini-tts'?{settings:()=>({model:'synthetic-tts',voiceA:'A',voiceB:'B'}),validateSettings(){},async synthesizeGemini(dialogue,base){calls.tts++;assert.equal(dialogue.length,2);if(ttsFailure)throw Error('synthetic TTS failure');return {mp3Path:base+'.mp3'};}}:require(name);
 if(cli)req.main=mod;
 const ctx=vm.createContext({require:req,module:mod,__dirname:path.dirname(generator),process:{argv:['node',generator,...args],env:{OUTPUT_DIR:output},stdout:{write(){}}},console:{error(...items){calls.errors.push(items.join(' '));}}});
 vm.runInContext(source,ctx,{filename:generator});const prune=ctx.pruneStoredPodcasts;ctx.pruneStoredPodcasts=async(...args)=>{calls.prunes++;return prune(...args);};return {ctx,calls,api:mod.exports};
}
for(const entry of ['--finalize-prepared','--finalize-manual','--no-audio','--sync-audio'])for(const skipPrune of [false,true])test(`${entry} skip-prune=${skipPrune} preserves upload/save and controls only retention`,async()=>{
 const args=entry==='--no-audio'?['--finalize-prepared','--no-audio']: [entry];
 const h=harness([...args,'--date',ymd,...(skipPrune?['--skip-prune']:[])],true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.ctx.process.exitCode,undefined,h.calls.errors.join('\n'));
 assert.equal(h.calls.prunes,skipPrune?0:1);assert.equal(h.calls.lists,skipPrune?0:1);assert.equal(h.calls.deletes.length,skipPrune?0:1);
 const sync=entry==='--sync-audio';assert.equal(h.calls.uploads.length,sync?2:1);assert.equal(h.calls.saves.length,sync?2:1);
 assert.equal(h.calls.tts,sync||entry==='--no-audio'?0:1);
 assert.equal(h.calls.conversion,h.calls.tts);
 assert.equal(h.calls.uploads[0].destination,`daily-brief/${ymd}/podcast.mp3`);
 assert.equal(h.calls.saves[0].id,`dailyBrief_${ymd}`);
 if(!sync){assert.equal(h.calls.saves[0].value.summaryMarkdown,'# '+ymd+' Synthetic Summary');assert.equal(h.calls.saves[0].value.hasAudio,true);assert.equal(h.calls.saves[0].value.audioStoragePath,`daily-brief/${ymd}/podcast.mp3`);}
});
test('skip-prune sync reports that retention was skipped without claiming retained contents',async()=>{
 const h=harness();const result=await h.api.syncLatestPodcastAudio({skipPrune:true});
 assert.equal(result.pruneSkipped,true);assert.equal(result.retained,null);assert.equal(h.calls.prunes,0);assert.equal(h.calls.deletes.length,0);assert.equal(h.calls.lists,0);
});
for(const failure of ['uploadFailure','ttsFailure'])test(`${failure} still stops save and never deletes Storage objects`,async()=>{
 const h=harness([],false,{[failure]:true});
 await assert.rejects(h.api.finalizeManualImport({date:ymd,skipPrune:true}),/synthetic/);
 assert.equal(h.calls.prunes,0);assert.equal(h.calls.deletes.length,0);assert.equal(h.calls.lists,0);assert.equal(h.calls.saves.length,0);
});
