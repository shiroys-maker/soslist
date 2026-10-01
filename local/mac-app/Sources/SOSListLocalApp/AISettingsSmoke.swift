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
          document.getElementById('ai-settings-save').click();
          for(let i=0;i<80&&!document.getElementById('ai-settings-status').textContent.includes('保存しました');i++)await wait();
          document.getElementById('ai-settings-close').click();document.getElementById('ai-settings-open').click();
          for(let i=0;i<80&&!document.querySelector('dialog[open]');i++)await wait();
          if(document.querySelector('[data-task=bill] .ai-model-select').value!=='gpt-6-luna')throw Error('Saved model not reloaded');
          window.webkit.messageHandlers.aiSettingsSmokeResult.postMessage({ok:true,tasks:8,model:document.querySelector('[data-task=bill] .ai-model-select').value,automaticCatalog:true});
        }catch(e){window.webkit.messageHandlers.aiSettingsSmokeResult.postMessage({ok:false,error:e.message});}})();
        """#
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
