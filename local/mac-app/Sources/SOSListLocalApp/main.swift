import AppKit
import WebKit

private let appName = "SOSList Local"
private let appURL = URL(string: "http://localhost:8787/local/index.html")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 120, y: 120, width: 1440, height: 960),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = appName
        window.setFrameAutosaveName("SOSListLocalWindow")
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: appURL))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure(error)
    }

    private func showFailure(_ error: Error) {
        let html = """
        <!doctype html>
        <html lang="ja">
        <head>
          <meta charset="utf-8">
          <title>\(appName)</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, sans-serif;
              background: linear-gradient(135deg, #f6efe8, #f2f7fb);
              color: #1f2937;
              margin: 0;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .card {
              max-width: 640px;
              margin: 24px;
              padding: 32px;
              border-radius: 18px;
              background: rgba(255,255,255,0.92);
              box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
            }
            h1 { margin-top: 0; font-size: 28px; }
            code {
              display: block;
              margin-top: 16px;
              padding: 12px 14px;
              border-radius: 10px;
              background: #111827;
              color: #f9fafb;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>\(appName)</h1>
            <p><code>http://localhost:8787/local/index.html</code> に接続できませんでした。</p>
            <p>ローカルサーバーを起動してから、このアプリを開き直してください。</p>
            <code>\(error.localizedDescription)</code>
          </div>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
