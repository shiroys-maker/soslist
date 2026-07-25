import AppKit
import Foundation
import WebKit

private let appName = "SOS Appointment Viewer"
private let rootViewerURL = URL(string: "http://127.0.0.1:8787/index.html")!
private let qtcServerScript = "/Users/shungohiroyasu/bin/sospdf_server.py"
private let qtcPython = "/Users/shungohiroyasu/miniconda3/bin/python3"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var popupWindows: [ObjectIdentifier: NSWindow] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        webView = makeWebView()

        window = NSWindow(
            contentRect: NSRect(x: 120, y: 120, width: 1440, height: 960),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = appName
        window.setFrameAutosaveName("SOSAppointmentViewerWindow")
        window.delegate = self
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        buildMainMenu()
        NSApp.activate(ignoringOtherApps: true)
        if ensureRootServerIsRunning() {
            webView.load(URLRequest(url: rootViewerURL))
        } else {
            showServerFailure(in: webView)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }


    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "printHTML" {
            guard let payload = message.body as? [String: Any],
                  let html = payload["html"] as? String
            else {
                return
            }

            let title = payload["title"] as? String ?? "print"
            openPrintableHTMLInChrome(html: html, title: title)
            return
        }

        if message.name == "openHTMLWindow" {
            guard let payload = message.body as? [String: Any],
                  let html = payload["html"] as? String
            else {
                return
            }

            let title = payload["title"] as? String ?? appName
            openHTMLPopupWindow(html: html, title: title)
            return
        }

        if message.name == "openExternalURL" {
            guard let payload = message.body as? [String: Any],
                  let urlString = payload["url"] as? String,
                  let url = URL(string: urlString)
            else {
                return
            }

            openInChrome(url)
            return
        }

        if message.name == "openSummaryWindow" {
            guard let payload = message.body as? [String: Any],
                  let urlString = payload["url"] as? String,
                  let url = URL(string: urlString)
            else {
                return
            }

            let title = payload["title"] as? String ?? "Summary"
            openPopupWindow(url: url, title: title)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let popupWebView = makePopupWindow(configuration: configuration, title: appName)
        if navigationAction.targetFrame == nil {
            loadRequest(navigationAction.request, into: popupWebView)
        }
        return popupWebView
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url
        else {
            decisionHandler(.allow)
            return
        }

        if isBundledAppURL(url) {
            decisionHandler(.allow)
            return
        }

        openInChrome(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showFailure(error, in: webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure(error, in: webView)
    }

    private func makeWebView(configuration: WKWebViewConfiguration = WKWebViewConfiguration()) -> WKWebView {
        configuration.userContentController.add(self, name: "printHTML")
        configuration.userContentController.add(self, name: "openHTMLWindow")
        configuration.userContentController.add(self, name: "openExternalURL")
        configuration.userContentController.add(self, name: "openSummaryWindow")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        return webView
    }

    @discardableResult
    private func makePopupWindow(configuration: WKWebViewConfiguration = WKWebViewConfiguration(), title: String) -> WKWebView {
        let popupWebView = makeWebView(configuration: configuration)
        let popupWindow = NSWindow(
            contentRect: NSRect(x: 180, y: 160, width: 1280, height: 920),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        popupWindow.title = title
        popupWindow.setFrameAutosaveName("SOSAppointmentViewerPopupWindow")
        popupWindow.delegate = self
        popupWindow.isReleasedWhenClosed = false
        popupWindow.animationBehavior = .none
        popupWindow.contentView = popupWebView
        popupWindow.center()
        popupWindow.makeKeyAndOrderFront(nil)
        popupWindows[ObjectIdentifier(popupWebView)] = popupWindow
        return popupWebView
    }

    private func loadRequest(_ request: URLRequest, into webView: WKWebView) {
        webView.load(request)
    }

    private func openPopupWindow(url: URL, title: String) {
        let popupWebView = makePopupWindow(title: title)
        loadRequest(URLRequest(url: url), into: popupWebView)
    }

    private func openHTMLPopupWindow(html: String, title: String) {
        let popupWebView = makePopupWindow(title: title)
        popupWebView.loadHTMLString(html, baseURL: rootViewerURL.deletingLastPathComponent())
    }

    private func isBundledAppURL(_ url: URL) -> Bool {
        if url.isFileURL {
            return true
        }

        guard let host = url.host?.lowercased() else {
            return false
        }

        return host == "localhost" || host == "127.0.0.1"
    }

    private func openInChrome(_ url: URL) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-a", "Google Chrome", url.absoluteString]
        do {
            try process.run()
        } catch {
            NSLog("Failed to open URL in Chrome: %@", error.localizedDescription)
        }
    }


    private func openPrintableHTMLInChrome(html: String, title: String) {
        let sanitizedTitle = title.replacingOccurrences(of: "/", with: "-")
        let printDirURL = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("soslist-print", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: printDirURL, withIntermediateDirectories: true)
            let fileURL = printDirURL.appendingPathComponent("\(sanitizedTitle)-\(UUID().uuidString).html")
            try html.write(to: fileURL, atomically: true, encoding: .utf8)
            openInChrome(fileURL)
        } catch {
            NSLog("Failed to prepare printable HTML: %@", error.localizedDescription)
        }
    }

    private func ensureRootServerIsRunning() -> Bool {
        if isServerReachable(rootViewerURL) {
            return true
        }

        guard
            FileManager.default.fileExists(atPath: qtcPython),
            FileManager.default.fileExists(atPath: qtcServerScript)
        else {
            NSLog("Root viewer server dependencies are missing.")
            return false
        }

        let serverProcess = Process()
        serverProcess.executableURL = URL(fileURLWithPath: "/usr/bin/nohup")
        serverProcess.arguments = [qtcPython, qtcServerScript]
        let nullHandle = FileHandle(forWritingAtPath: "/dev/null")
        serverProcess.standardOutput = nullHandle
        serverProcess.standardError = nullHandle
        serverProcess.standardInput = nil
        do {
            try serverProcess.run()
        } catch {
            NSLog("Failed to start root viewer server: %@", error.localizedDescription)
        }

        for _ in 0..<10 {
            if isServerReachable(rootViewerURL) {
                return true
            }
            Thread.sleep(forTimeInterval: 0.5)
        }

        return false
    }

    private func isServerReachable(_ url: URL) -> Bool {
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        probe.arguments = ["-s", "--max-time", "1", url.absoluteString]
        do {
            try probe.run()
            probe.waitUntilExit()
            return probe.terminationStatus == 0
        } catch {
            NSLog("Failed to probe server %@: %@", url.absoluteString, error.localizedDescription)
            return false
        }
    }

    private func showServerFailure(in webView: WKWebView) {
        let html = """
        <!doctype html>
        <html lang="ja">
        <head><meta charset="utf-8"><title>\(appName)</title></head>
        <body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f6efe8;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
          <div style="max-width:640px;margin:24px;padding:32px;border-radius:18px;background:rgba(255,255,255,0.92);box-shadow:0 24px 60px rgba(15,23,42,0.12);">
            <h1 style="margin-top:0;font-size:28px;">\(appName)</h1>
            <p><code>http://127.0.0.1:8787/index.html</code> に接続できませんでした。</p>
            <p>ローカルサーバーを起動してから、このアプリを開き直してください。</p>
          </div>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func showFailure(_ error: Error, in webView: WKWebView) {
        let html = """
        <!doctype html>
        <html lang="ja">
        <head><meta charset="utf-8"><title>\(appName)</title></head>
        <body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f6efe8;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
          <div style="max-width:640px;margin:24px;padding:32px;border-radius:18px;background:rgba(255,255,255,0.92);box-shadow:0 24px 60px rgba(15,23,42,0.12);">
            <h1 style="margin-top:0;font-size:28px;">\(appName)</h1>
            <p><code>http://127.0.0.1:8787/index.html</code> の読み込みに失敗しました。</p>
            <code style="display:block;margin-top:16px;padding:12px 14px;border-radius:10px;background:#111827;color:#f9fafb;white-space:pre-wrap;">\(error.localizedDescription)</code>
          </div>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func windowWillClose(_ notification: Notification) {
        guard let closingWindow = notification.object as? NSWindow else {
            return
        }

        if closingWindow == window {
            NSApp.terminate(nil)
            return
        }

        if let matchingEntry = popupWindows.first(where: { $0.value == closingWindow }) {
            popupWindows.removeValue(forKey: matchingEntry.key)
        }
    }

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "\(appName) を終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        NSApp.mainMenu = mainMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
