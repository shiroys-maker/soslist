import Foundation
extension AppDelegate {
    func runAISettingsSmoke() {
        let js = #"""
        (async()=>{const wait=()=>new Promise(r=>setTimeout(r,150));try{
          document.getElementById('ai-settings-open').click();
          for(let i=0;i<80&&!document.querySelector('fieldset');i++)await wait();
          const models=()=>document.querySelectorAll('select.ai-model-select');
          if(models().length!==8)throw Error('Missing model dropdowns');
          if(document.querySelector('fieldset input'))throw Error('Unexpected manual model input');
          for(let i=0;i<200&&models()[0].options.length<2;i++)await wait();
          const bill=document.querySelector('[data-task=bill] .ai-model-select');
          if(![...bill.options].some(o=>o.value==='gpt-6-luna'))throw Error('Model list not loaded on open');
          bill.value='gpt-6-luna';bill.dispatchEvent(new Event('change'));
          const service=()=>document.querySelector('[data-task=summary] .ai-service-select');
          const summaryModel=()=>document.querySelector('[data-task=summary] .ai-model-select');
          const original=summaryModel().value;
          if(![...service().options].some(o=>o.value==='claude'))throw Error('Missing Claude service choice');
          service().value='claude';service().dispatchEvent(new Event('change'));
          if(summaryModel().value!=='opus')throw Error('Claude Opus not selected');
          service().value='openai';service().dispatchEvent(new Event('change'));
          if(summaryModel().value!==original)throw Error('Codex selection lost');
          service().value='claude';service().dispatchEvent(new Event('change'));
          if(![...summaryModel().options].some(o=>o.value==='claude-opus-5-5'))throw Error('Missing Opus 5.5 dropdown choice');
          summaryModel().value='claude-opus-5-5';summaryModel().dispatchEvent(new Event('change'));
          document.getElementById('ai-model-refresh').click();
          for(let i=0;i<200&&document.getElementById('ai-model-refresh').disabled;i++)await wait();
          if(document.getElementById('ai-model-refresh').disabled)throw Error('Model refresh did not finish');
          if(summaryModel().value!=='claude-opus-5-5'||service().value!=='claude')throw Error('Model refresh lost selection');
          if(![...summaryModel().options].some(o=>o.text==='Opus 5.5'))throw Error('Refreshed version label missing');
          document.getElementById('ai-settings-save').click();
          for(let i=0;i<80&&!document.getElementById('ai-settings-status').textContent.includes('保存しました');i++)await wait();
          document.getElementById('ai-settings-close').click();document.getElementById('ai-settings-open').click();
          for(let i=0;i<80&&!document.querySelector('dialog[open]');i++)await wait();
          if(document.querySelector('[data-task=bill] .ai-model-select').value!=='gpt-6-luna')throw Error('Saved model not reloaded');
          if(service().value!=='claude'||summaryModel().value!=='claude-opus-5-5')throw Error('Summary service not reloaded');
          window.webkit.messageHandlers.aiSettingsSmokeResult.postMessage({ok:true,tasks:8,model:document.querySelector('[data-task=bill] .ai-model-select').value,automaticCatalog:true,refreshedCatalog:true,summaryService:service().value,summaryModel:summaryModel().value});
        }catch(e){window.webkit.messageHandlers.aiSettingsSmokeResult.postMessage({ok:false,error:e.message});}})();
        """#
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
