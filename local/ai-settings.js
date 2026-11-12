(()=>{
 const claudeModels=[{service:'claude',id:'opus',name:'Opus（最新）',efforts:['low','medium','high','xhigh','max']}];
 const pending=new Map();let seq=0,tasks={},catalog=[];
 const call=(action,extra={})=>new Promise((resolve,reject)=>{const id=String(++seq);pending.set(id,{resolve,reject});window.webkit.messageHandlers.aiSettings.postMessage({id,action,...extra});});
 window.aiSettingsReply=r=>{const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.reject(Error(r.error)):p.resolve(r.value);};
 const dialog=document.createElement('dialog');dialog.style.cssText='width:min(780px,90vw);max-height:85vh;overflow:auto;border:0;border-radius:12px;padding:24px';
 dialog.innerHTML='<h2>AIタスク設定</h2><p>次回開始に使う設定です。実行中の処理は開始時の設定を保持します。</p><div id="ai-task-rows"></div><p id="ai-settings-status"></p><button id="ai-model-refresh">モデル一覧を更新</button> <button id="ai-settings-save">保存</button> <button id="ai-settings-close">閉じる</button>';
 document.body.append(dialog);const el=id=>dialog.querySelector('#'+id);
 function render(){el('ai-task-rows').replaceChildren();for(const id of ['bill','xray','audiogram','kana','summary','speech','tts']){const t=tasks[id];
 const box=document.createElement('fieldset');box.dataset.task=id;box.style.marginBottom='12px';const title=document.createElement('legend');title.textContent=t.label;box.append(title);
 const scope=document.createElement('p');scope.textContent=t.scope;
 if(t.execution){const used=document.createElement('p');used.textContent=(t.execution.state==='running'?'実行中: ':t.execution.state==='interrupted'?'前回中断: ':'前回実行: ')+(t.execution.service==='claude'?'Claude Code / ':'')+t.execution.model+' / '+(t.execution.effort||'非対応');box.append(used);}box.append(scope);
 const service=document.createElement('select');service.className='ai-service-select';service.setAttribute('aria-label',t.label+'のサービス');for(const value of t.services||[t.service])service.append(new Option(value==='gemini'?'Gemini TTS':value==='claude'?'Claude Code':'OpenAI / Codex',value));service.value=t.service;box.append(service);
 service.onchange=()=>{t.selections={...t.selections,[t.service]:{model:t.model,effort:t.effort}};t.service=service.value;Object.assign(t,t.selections[t.service]||t.serviceDefaults[t.service]);render();};
 const input=document.createElement('select');input.className='ai-model-select';input.setAttribute('aria-label',t.label+'のモデル');input.style.cssText='width:270px;max-width:100%';
 const available=catalog.some(m=>m.service==='claude')?catalog:[...claudeModels,...catalog];
 const candidates=available.filter(m=>(m.service||'openai')===t.service);
 if(!candidates.some(m=>m.id===t.model))input.append(new Option(t.model,t.model));
 for(const m of candidates)input.append(new Option(m.name||m.id,m.id));
 input.value=t.model;box.append(input);
 const effort=document.createElement('select');
 function efforts(){const known=available.find(m=>m.id===input.value&&(m.service||'openai')===t.service),choices=t.service==='gemini'?['']:(known?.efforts?.length?[...known.efforts]:t.service==='claude'?['low','medium','high','xhigh','max']:['none','minimal','low','medium','high','xhigh','max','ultra']);if(!choices.includes(t.effort))choices.push(t.effort);effort.replaceChildren(...choices.map(v=>new Option(v||'effort非対応',v)));effort.value=t.effort;}
 efforts();box.append(effort);input.onchange=()=>{t.model=input.value;efforts();};effort.onchange=()=>t.effort=effort.value;el('ai-task-rows').append(box);
 }}
 document.getElementById('ai-settings-open').onclick=async()=>{try{tasks=await call('get');render();el('ai-settings-status').textContent='保存済みの設定を読み込みました。';dialog.showModal();await refreshModels();}catch(e){alert(e.message);}};
 el('ai-settings-close').onclick=()=>dialog.close();
 async function refreshModels(){el('ai-model-refresh').disabled=true;el('ai-settings-status').textContent='モデル一覧を取得中…';try{const result=await call('models');catalog=result.models;render();el('ai-settings-status').textContent=(result.cached?result.warning:catalog.length+'件。')+' モデルを一覧から選択できます。';}catch(e){el('ai-settings-status').textContent=e.message;}finally{el('ai-model-refresh').disabled=false;}}
 el('ai-model-refresh').onclick=refreshModels;
 el('ai-settings-save').onclick=async()=>{try{tasks=await call('save',{tasks});render();el('ai-settings-status').textContent='保存しました。次回開始から反映します。';}catch(e){el('ai-settings-status').textContent=e.message;}};
})();
