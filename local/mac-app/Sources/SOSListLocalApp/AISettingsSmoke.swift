import Foundation
extension AppDelegate {
    func runAISettingsSmoke() {
        let js = #"""
        (async()=>{const wait=()=>new Promise(r=>setTimeout(r,150));try{
          document.getElementById('ai-settings-open').click();
          for(let i=0;i<80&&!document.querySelector('fieldset input');i++)await wait();
          const inputs=[...document.querySelectorAll('fieldset input')];if(inputs.length!==8)throw Error('Missing task rows');
          inputs[0].value='gpt-6-luna';inputs[0].dispatchEvent(new Event('input'));
          document.getElementById('ai-settings-save').click();
          for(let i=0;i<80&&!document.getElementById('ai-settings-status').textContent.includes('保存しました');i++)await wait();
          document.getElementById('ai-settings-close').click();document.getElementById('ai-settings-open').click();await wait();await wait();
          if(document.querySelector('fieldset input').value!=='gpt-6-luna')throw Error('Saved model not reloaded');
          window.webkit.messageHandlers.aiSettingsSmokeResult.postMessage({ok:true,tasks:8,model:document.querySelector('fieldset input').value});
        }catch(e){window.webkit.messageHandlers.aiSettingsSmokeResult.postMessage({ok:false,error:e.message});}})();
        """#
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
