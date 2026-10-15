// Isolated nonpersistent WKWebView smoke; no SOSList/DBQ app startup or patient API.
import AppKit
import WebKit

final class Smoke: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let web: WKWebView
    init(url: URL) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 900), configuration: config)
        super.init()
        config.userContentController.add(self, name: "smoke")
        web.navigationDelegate = self
        web.load(URLRequest(url: url))
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.host == "127.0.0.1" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript(#"""
        (async()=>{
          try {
            for(let i=0;i<100&&document.getElementById('status').textContent!=='表示中';i++)await new Promise(r=>setTimeout(r,50));
            const check=(ok,reason)=>{if(!ok)throw Error(reason);};
            check(document.querySelector('#summary h1').textContent==='Synthetic Summary','heading');
            check(document.querySelectorAll('#summary table').length===1,'table');
            check(document.querySelector('#summary strong').textContent==='First','strong');
            check(document.querySelectorAll('#summary script,#summary img,#summary svg,#summary iframe').length===0,'unsafe nodes');
            check(globalThis.pwned===undefined,'script execution');
            check(document.querySelectorAll('#summary a').length===1,'unsafe links');
            const source=document.getElementById('summarySource');
            const original=source.value;
            toggleSource();check(source.value===original&&!source.hidden,'source view');toggleSource();
            const range=document.createRange();range.selectNodeContents(document.getElementById('summary'));getSelection().removeAllRanges();getSelection().addRange(range);
            check(getSelection().toString().includes('Fictional findings'),'selection');getSelection().removeAllRanges();
            window.webkit.messageHandlers.smoke.postMessage({ok:true,engine:'WKWebView',heading:true,table:true,bold:true,xss:true,source:true,selection:true});
          } catch(e) {window.webkit.messageHandlers.smoke.postMessage({ok:false,error:e.message});}
        })();
        """#, completionHandler: nil)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { exit(2) }
        print(String(data: data, encoding: .utf8)!)
        exit(payload["ok"] as? Bool == true ? 0 : 1)
    }
}
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
let smoke=Smoke(url:URL(string:CommandLine.arguments[1])!)
let deadline=Timer.scheduledTimer(withTimeInterval:20,repeats:false){_ in print("WKWebView smoke timed out");exit(1)}
app.run()
