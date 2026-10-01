(()=>{
 const pending=new Map();let seq=0,tasks={},catalog=[];
 const call=(action,extra={})=>new Promise((resolve,reject)=>{const id=String(++seq);pending.set(id,{resolve,reject});window.webkit.messageHandlers.aiSettings.postMessage({id,action,...extra});});
 window.aiSettingsReply=r=>{const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.reject(Error(r.error)):p.resolve(r.value);};
 const dialog=document.createElement('dialog');dialog.style.cssText='width:min(780px,90vw);max-height:85vh;overflow:auto;border:0;border-radius:12px;padding:24px';
 dialog.innerHTML='<h2>AIタスク設定</h2><p>次回開始に使う設定です。実行中の処理は開始時の設定を保持します。</p><div id="ai-task-rows"></div><p id="ai-settings-status"></p><button id="ai-model-refresh">モデル一覧を更新</button> <button id="ai-settings-save">保存</button> <button id="ai-settings-close">閉じる</button>';
 document.body.append(dialog);const el=id=>dialog.querySelector('#'+id);
 function render(){el('ai-task-rows').replaceChildren();for(const [id,t]of Object.entries(tasks)){
 const box=document.createElement('fieldset');box.style.marginBottom='12px';const title=document.createElement('legend');title.textContent=t.label;box.append(title);
 const scope=document.createElement('p');scope.textContent=t.scope;
 if(t.execution){const used=document.createElement('p');used.textContent=(t.execution.state==='running'?'実行中: ':t.execution.state==='interrupted'?'前回中断: ':'前回実行: ')+t.execution.model+' / '+(t.execution.effort||'非対応');box.append(used);}box.append(scope);
 const service=document.createElement('select');service.append(new Option(t.service==='gemini'?'Gemini TTS':'OpenAI / Codex',t.service));box.append(service);
 const input=document.createElement('input');input.value=t.model;input.placeholder='次回のモデルID（直接指定可能）';input.style.width='270px';input.setAttribute('list','ai-model-'+id);box.append(input);
 const list=document.createElement('datalist');list.id='ai-model-'+id;for(const m of catalog.filter(m=>(m.service||'openai')===t.service)){list.append(new Option(m.name,m.id));}box.append(list);
 const effort=document.createElement('select');
 function efforts(){const known=catalog.find(m=>m.id===input.value),choices=t.service==='gemini'?['']:(known?.efforts?.length?[...known.efforts]:['none','minimal','low','medium','high','xhigh','max','ultra']);if(!choices.includes(t.effort))choices.push(t.effort);effort.replaceChildren(...choices.map(v=>new Option(v||'effort非対応',v)));effort.value=t.effort;}
 efforts();box.append(effort);input.oninput=()=>{t.model=input.value;efforts();};effort.onchange=()=>t.effort=effort.value;el('ai-task-rows').append(box);
 }}
 document.getElementById('ai-settings-open').onclick=async()=>{try{tasks=await call('get');render();el('ai-settings-status').textContent='保存済みの設定を読み込みました。';dialog.showModal();}catch(e){alert(e.message);}};
 el('ai-settings-close').onclick=()=>dialog.close();
 el('ai-model-refresh').onclick=async()=>{el('ai-settings-status').textContent='モデル一覧を取得中…';try{const result=await call('models');catalog=result.models;render();el('ai-settings-status').textContent=(result.cached?result.warning:catalog.length+'件。')+' モデルIDの直接指定も可能です。';}catch(e){el('ai-settings-status').textContent=e.message;}};
 el('ai-settings-save').onclick=async()=>{try{tasks=await call('save',{tasks});render();el('ai-settings-status').textContent='保存しました。次回開始から反映します。';}catch(e){el('ai-settings-status').textContent=e.message;}};
})();
