import AppKit
import Foundation
import WebKit

private let appName = "SOSList Local"
private let homeDir = FileManager.default.homeDirectoryForCurrentUser.path
private let qtcServerBaseURL = URL(string: "http://127.0.0.1:19876/")!
private let qtcHealthCheckURL = qtcServerBaseURL.appendingPathComponent("audiogram.html")
private let qtcServerScript = "\(homeDir)/bin/sospdf_server.py"
private let qtcPython = "\(homeDir)/miniconda3/bin/python3"
private let qtcImportsBaseDir = "\(homeDir)/Documents/QTC_server/cd-imports"
private let vaRecordsBaseDir = "\(homeDir)/Library/CloudStorage/Dropbox/VA/VA Records"
private let cdMonitoringDefaultsKey = "SOSListLocalCDMonitoringEnabled"
private let dailyBriefBaseURL = URL(string: "http://127.0.0.1:8790/")!
private let dailyBriefDir = "\(homeDir)/Documents/GitHub/soslist/daily-brief"
private let dailyBriefNodePath = resolveNodePath()
private let dailyBriefLogPath = "/tmp/soslist-daily-brief.log"
private let dailyBriefGeneratorScript = "generate-brief.js"

// node の実行パスを解決する。nvm の最新バージョン → よくあるインストール先の順。
// （特定バージョンをハードコードすると nvm の更新で静かに壊れるため）
private func resolveNodePath() -> String {
    let fm = FileManager.default
    let nvmVersionsDir = "\(homeDir)/.nvm/versions/node"
    if let versions = try? fm.contentsOfDirectory(atPath: nvmVersionsDir), !versions.isEmpty {
        // "v22.14.0" 形式を数値で降順ソートして最新を選ぶ
        let sorted = versions.sorted { a, b in
            let pa = a.dropFirst().split(separator: ".").compactMap { Int($0) }
            let pb = b.dropFirst().split(separator: ".").compactMap { Int($0) }
            return pa.lexicographicallyPrecedes(pb) == false
        }
        for version in sorted {
            let candidate = "\(nvmVersionsDir)/\(version)/bin/node"
            if fm.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if fm.isExecutableFile(atPath: candidate) {
            return candidate
        }
    }
    return "/usr/local/bin/node"
}

private enum PopupKind {
    case details
    case summary
    case tool
}

private struct ASBOCDMetadata {
    let volumePath: String
    let contractNumber: String
    let patientName: String
    let dateOfBirth: String
    let studyDate: String
    let gender: String
    let region: String
    let importedImageRelativePaths: [String]
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var popupWindows: [ObjectIdentifier: NSWindow] = [:]
    private var popupKinds: [ObjectIdentifier: PopupKind] = [:]
    // details保存の応答を返す先（requestId → 詳細ウィンドウのWebView）
    private var pendingDetailSaveWebViews: [String: WKWebView] = [:]
    private var cdMonitorTimer: Timer?
    private let cdMonitorQueue = DispatchQueue(label: "jp.niraissc.soslistlocal.cdmonitor", qos: .utility)
    private var processedCDVolumes: Set<String> = []
    private var isScanningCDVolumes = false
    private var isCDMonitoringEnabled = false
    private var dailyBriefProcess: Process?
    private var didAutoStartDailyBrief = false
    private var summaryGenerationProcess: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--run-codex-scheduled-summary") {
            runCodexScheduledSummaryAndTerminate()
            return
        }

        webView = makeWebView()

        window = NSWindow(
            contentRect: NSRect(x: 120, y: 120, width: 1440, height: 960),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = appName
        window.setFrameAutosaveName("SOSListLocalWindow")
        window.delegate = self
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        buildMainMenu()
        NSApp.activate(ignoringOtherApps: true)
        if let indexURL = bundledLocalFileURL("index.html") {
            loadAppFile(indexURL, into: webView)
        } else {
            showBundledContentFailure()
        }
        isCDMonitoringEnabled = UserDefaults.standard.bool(forKey: cdMonitoringDefaultsKey)
        applyCDMonitoringState(isCDMonitoringEnabled, resetProcessedVolumes: false)
        ensureDailyBriefDirectories()
    }

    private func runCodexScheduledSummaryAndTerminate() {
        DispatchQueue.global(qos: .utility).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = ["\(dailyBriefDir)/run-codex-scheduled-summary.sh"]
            process.currentDirectoryURL = URL(fileURLWithPath: dailyBriefDir, isDirectory: true)
            process.terminationHandler = { _ in
                DispatchQueue.main.async {
                    NSApp.terminate(nil)
                }
            }
            do {
                try process.run()
            } catch {
                NSLog("Failed to start scheduled Codex Summary: %@", error.localizedDescription)
                DispatchQueue.main.async {
                    NSApp.terminate(nil)
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        summaryGenerationProcess?.terminate()
        stopDailyBriefProcess()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "focusMainWindow" {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            return
        }

        if message.name == "closeDetailsWindow" {
            guard let sourceWebView = message.webView else {
                return
            }
            closePopupWindow(for: sourceWebView)
            return
        }

        // 詳細ウィンドウ→メインWebViewへの保存リレー
        // （独立したWKWebView間ではlocalStorageのstorageイベントが届かないため）
        if message.name == "saveDetails" {
            guard
                let payload = message.body as? [String: Any],
                let requestId = payload["requestId"] as? String
            else {
                return
            }
            if let sourceWebView = message.webView {
                pendingDetailSaveWebViews[requestId] = sourceWebView
            }
            relayJSON(payload, toFunction: "window.__sosApplyDetailsSave", in: webView)
            return
        }

        // メインWebView→詳細ウィンドウへの保存結果リレー
        if message.name == "detailsSaveResult" {
            guard
                let payload = message.body as? [String: Any],
                let requestId = payload["requestId"] as? String
            else {
                return
            }
            let target = pendingDetailSaveWebViews.removeValue(forKey: requestId)
            relayJSON(payload, toFunction: "window.__sosDetailSaveResult", in: target)
            return
        }

        // 詳細ウィンドウからの紹介状オープン要求をメインWebViewへリレー
        if message.name == "openReferralFromDetails" {
            guard let payload = message.body as? [String: Any] else {
                return
            }
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            relayJSON(payload, toFunction: "window.__sosOpenReferralFromDetails", in: webView)
            return
        }

        if message.name == "openQtcTool" {
            guard
                let payload = message.body as? [String: Any],
                let tool = payload["tool"] as? String,
                let contractNumber = payload["contractNumber"] as? String
            else {
                return
            }
            openQtcTool(tool: tool, contractNumber: contractNumber)
            return
        }

        if message.name == "runUtilityTool" {
            guard
                let payload = message.body as? [String: Any],
                let tool = payload["tool"] as? String
            else {
                return
            }
            let details = payload["details"] as? [String: Any]
            runUtilityTool(named: tool, details: details, sourceWebView: message.webView)
            return
        }

        if message.name == "printHTML" {
            guard
                let payload = message.body as? [String: Any],
                let html = payload["html"] as? String
            else {
                return
            }
            let title = payload["title"] as? String ?? "print"
            if let sourceWebView = message.webView,
               popupKinds[ObjectIdentifier(sourceWebView)] == .tool {
                presentNativePrint(for: sourceWebView, fallbackHTML: html, title: title)
            } else {
                openPrintableHTMLInChrome(html: html, title: title)
            }
            return
        }

        if message.name == "openExternalURL" {
            guard
                let payload = message.body as? [String: Any],
                let urlString = payload["url"] as? String,
                let url = URL(string: urlString)
            else {
                return
            }
            openInChrome(url)
            return
        }

        if message.name == "openSummaryWindow" {
            guard
                let payload = message.body as? [String: Any],
                let urlString = payload["url"] as? String,
                let url = URL(string: urlString)
            else {
                return
            }
            let title = payload["title"] as? String ?? "Summery"
            openSummaryWindow(url: url, title: title)
            return
        }

        if message.name == "startSummaryGeneration" {
            guard
                let payload = message.body as? [String: Any],
                let ymd = payload["date"] as? String
            else {
                return
            }
            startSummaryGeneration(for: ymd)
            return
        }

        if message.name == "setCDMonitoringEnabled" {
            guard
                let payload = message.body as? [String: Any],
                let enabled = payload["enabled"] as? Bool
            else {
                return
            }
            UserDefaults.standard.set(enabled, forKey: cdMonitoringDefaultsKey)
            applyCDMonitoringState(enabled, resetProcessedVolumes: enabled)
            return
        }

        guard message.name == "openDetailsWindow" else {
            return
        }

        guard let payload = message.body as? [String: Any] else {
            return
        }
        guard let detailsFileURL = bundledLocalFileURL("details.html") else {
            return
        }

        openPopupWindow(url: detailsFileURL, title: "予約詳細", detailsPayload: payload)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let popupWebView = makePopupWindow(configuration: configuration, title: "予約詳細")
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

        if isLocalAppURL(url) {
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

    private func showFailure(_ error: Error, in failingWebView: WKWebView) {
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
            <p>ページの読み込みに失敗しました。</p>
            <p>アプリを再ビルドして入れ直してください（build_and_run.sh --install）。</p>
            <code>\(error.localizedDescription)</code>
          </div>
        </body>
        </html>
        """
        failingWebView.loadHTMLString(html, baseURL: nil)
    }

    private func showBundledContentFailure() {
        let html = """
        <!doctype html>
        <html lang="ja">
        <head>
          <meta charset="utf-8">
          <title>\(appName)</title>
        </head>
        <body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f6efe8;color:#1f2937;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
          <div style="max-width:640px;margin:24px;padding:32px;border-radius:18px;background:rgba(255,255,255,0.92);box-shadow:0 24px 60px rgba(15,23,42,0.12);">
            <h1 style="margin-top:0;font-size:28px;">\(appName)</h1>
            <p>app bundle 内の local UI を読み込めませんでした。</p>
            <p>アプリを再ビルドして入れ直してください。</p>
          </div>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func makeWebView(configuration: WKWebViewConfiguration = WKWebViewConfiguration()) -> WKWebView {
        configuration.userContentController.add(self, name: "openDetailsWindow")
        configuration.userContentController.add(self, name: "focusMainWindow")
        configuration.userContentController.add(self, name: "closeDetailsWindow")
        configuration.userContentController.add(self, name: "openQtcTool")
        configuration.userContentController.add(self, name: "runUtilityTool")
        configuration.userContentController.add(self, name: "printHTML")
        configuration.userContentController.add(self, name: "openExternalURL")
        configuration.userContentController.add(self, name: "openSummaryWindow")
        configuration.userContentController.add(self, name: "startSummaryGeneration")
        configuration.userContentController.add(self, name: "setCDMonitoringEnabled")
        configuration.userContentController.add(self, name: "saveDetails")
        configuration.userContentController.add(self, name: "detailsSaveResult")
        configuration.userContentController.add(self, name: "openReferralFromDetails")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        return webView
    }

    @discardableResult
    private func makePopupWindow(
        configuration: WKWebViewConfiguration = WKWebViewConfiguration(),
        title: String,
        detailsPayload: [String: Any]? = nil,
        kind: PopupKind = .details
    ) -> WKWebView {
        let popupConfiguration = configuration
        if let detailsPayload {
            injectDetailsPayload(detailsPayload, into: popupConfiguration)
        }
        if kind == .tool {
            injectPrintBridge(into: popupConfiguration)
        }
        let popupWebView = makeWebView(configuration: popupConfiguration)
        let popupWindow = NSWindow(
            contentRect: NSRect(x: 180, y: 160, width: 1280, height: 920),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        popupWindow.title = title
        popupWindow.setFrameAutosaveName("SOSListLocalDetailsWindow")
        popupWindow.delegate = self
        popupWindow.isReleasedWhenClosed = false
        popupWindow.animationBehavior = .none
        popupWindow.contentView = popupWebView
        popupWindow.center()
        popupWindow.makeKeyAndOrderFront(nil)
        let key = ObjectIdentifier(popupWebView)
        popupWindows[key] = popupWindow
        popupKinds[key] = kind
        return popupWebView
    }

    private func openPopupWindow(
        url: URL,
        title: String,
        detailsPayload: [String: Any]? = nil,
        kind: PopupKind = .details
    ) {
        let popupWebView = makePopupWindow(title: title, detailsPayload: detailsPayload, kind: kind)
        loadRequest(URLRequest(url: url), into: popupWebView)
    }

    // payloadをJSONにして指定WebViewのグローバル関数へ渡す
    private func relayJSON(_ payload: [String: Any], toFunction functionName: String, in targetWebView: WKWebView?) {
        guard
            let targetWebView,
            JSONSerialization.isValidJSONObject(payload),
            let jsonData = try? JSONSerialization.data(withJSONObject: payload, options: []),
            let jsonString = String(data: jsonData, encoding: .utf8)
        else {
            return
        }
        let script = "if (typeof \(functionName) === 'function') { \(functionName)(\(jsonString)); }"
        targetWebView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func injectDetailsPayload(_ payload: [String: Any], into configuration: WKWebViewConfiguration) {
        guard
            JSONSerialization.isValidJSONObject(payload),
            let jsonData = try? JSONSerialization.data(withJSONObject: payload, options: []),
            let jsonString = String(data: jsonData, encoding: .utf8)
        else {
            return
        }

        let scriptSource = "window.__SOSLIST_DETAILS_PAYLOAD__ = \(jsonString);"
        let userScript = WKUserScript(source: scriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        configuration.userContentController.addUserScript(userScript)
    }

    private func injectPrintBridge(into configuration: WKWebViewConfiguration) {
        let scriptSource = """
        (() => {
          const postPrintHTML = () => {
            const handler = window.webkit?.messageHandlers?.printHTML;
            if (!handler) {
              return;
            }
            handler.postMessage({
              html: '<!doctype html>\\n' + document.documentElement.outerHTML,
              title: document.title || 'print'
            });
          };

          window.print = postPrintHTML;
          window.__SOSLIST_PRINT_BRIDGE__ = true;
        })();
        """
        let userScript = WKUserScript(source: scriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        configuration.userContentController.addUserScript(userScript)
    }

    private func bundledLocalFileURL(_ name: String) -> URL? {
        Bundle.main.resourceURL?
            .appendingPathComponent("local-web", isDirectory: true)
            .appendingPathComponent("local", isDirectory: true)
            .appendingPathComponent(name, isDirectory: false)
    }

    private func bundledWebRootURL() -> URL? {
        Bundle.main.resourceURL?
            .appendingPathComponent("local-web", isDirectory: true)
    }

    private func loadAppFile(_ fileURL: URL, into webView: WKWebView) {
        guard let rootURL = bundledWebRootURL() else {
            showBundledContentFailure()
            return
        }
        webView.loadFileURL(fileURL, allowingReadAccessTo: rootURL)
    }

    private func loadRequest(_ request: URLRequest, into webView: WKWebView) {
        guard let url = request.url else {
            return
        }

        if url.isFileURL {
            loadAppFile(url, into: webView)
            return
        }

        webView.load(request)
    }

    private func isLocalAppURL(_ url: URL) -> Bool {
        if url.isFileURL {
            return true
        }

        guard let host = url.host?.lowercased() else {
            return false
        }

        if host == "localhost" || host == "127.0.0.1" {
            return true
        }

        if host.isEmpty {
            return true
        }

        return false
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

    private func presentNativePrint(for webView: WKWebView, fallbackHTML html: String, title: String) {
        DispatchQueue.main.async {
            let printInfo = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo.shared
            let printOperation = webView.printOperation(with: printInfo)
            printOperation.jobTitle = title
            printOperation.showsPrintPanel = true
            printOperation.showsProgressPanel = true

            guard let targetWindow = self.popupWindows[ObjectIdentifier(webView)] ?? self.window else {
                self.openPrintableHTMLInChrome(html: html, title: title)
                return
            }
            printOperation.runModal(for: targetWindow, delegate: nil, didRun: nil, contextInfo: nil)
        }
    }

    private func closePopupWindow(for webView: WKWebView) {
        let key = ObjectIdentifier(webView)
        let popupKind = popupKinds.removeValue(forKey: key)
        guard let popupWindow = popupWindows.removeValue(forKey: key) else {
            return
        }

        DispatchQueue.main.async {
            popupWindow.close()
            NSApp.activate(ignoringOtherApps: true)
            self.window.makeKeyAndOrderFront(nil)
            if popupKind == .summary {
                self.stopDailyBriefIfNeeded()
            }
        }
    }

    private func openSummaryWindow(url: URL, title: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard self.ensureDailyBriefServerIsRunning() else {
                self.presentDailyBriefFailure()
                return
            }

            DispatchQueue.main.async {
                self.openPopupWindow(url: url, title: title, kind: .summary)
            }
        }
    }

    private func ensureDailyBriefServerIsRunning() -> Bool {
        if isServerReachable(dailyBriefBaseURL) {
            didAutoStartDailyBrief = false
            return true
        }

        let serverScriptPath = URL(fileURLWithPath: dailyBriefDir, isDirectory: true)
            .appendingPathComponent("server.js", isDirectory: false).path
        guard FileManager.default.fileExists(atPath: serverScriptPath) else {
            NSLog("daily-brief server script is missing: %@", serverScriptPath)
            return false
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-lc", dailyBriefLaunchCommand()]
        process.currentDirectoryURL = URL(fileURLWithPath: dailyBriefDir, isDirectory: true)
        let logURL = URL(fileURLWithPath: dailyBriefLogPath)
        FileManager.default.createFile(atPath: dailyBriefLogPath, contents: nil)
        if let logHandle = try? FileHandle(forWritingTo: logURL) {
            try? logHandle.truncate(atOffset: 0)
            if let banner = """
                [\(Date())] launching daily-brief
                cwd=\(dailyBriefDir)
                cmd=\(dailyBriefLaunchCommand())

                """.data(using: .utf8) {
                try? logHandle.write(contentsOf: banner)
            }
            process.standardOutput = logHandle
            process.standardError = logHandle
        }
        process.standardInput = nil

        do {
            try process.run()
            dailyBriefProcess = process
            didAutoStartDailyBrief = true
        } catch {
            appendDailyBriefLog("[\(Date())] failed to launch process: \(error.localizedDescription)\n")
            NSLog("Failed to start daily-brief server: %@", error.localizedDescription)
            dailyBriefProcess = nil
            didAutoStartDailyBrief = false
            return false
        }

        process.terminationHandler = { process in
            self.appendDailyBriefLog("[\(Date())] process terminated status=\(process.terminationStatus) reason=\(process.terminationReason.rawValue)\n")
        }

        for _ in 0..<20 {
            if isServerReachable(dailyBriefBaseURL) {
                return true
            }
            if let runningProcess = dailyBriefProcess, !runningProcess.isRunning {
                break
            }
            Thread.sleep(forTimeInterval: 0.5)
        }

        stopDailyBriefProcess()
        return false
    }

    private func stopDailyBriefIfNeeded() {
        guard didAutoStartDailyBrief else {
            return
        }
        let hasOpenSummaryWindow = popupKinds.contains { $0.value == .summary }
        guard !hasOpenSummaryWindow else {
            return
        }
        stopDailyBriefProcess()
    }

    private func stopDailyBriefProcess() {
        dailyBriefProcess?.terminate()
        dailyBriefProcess = nil
        didAutoStartDailyBrief = false
    }

    private func presentDailyBriefFailure() {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Summery を起動できませんでした"
            let logTail = (try? String(contentsOfFile: dailyBriefLogPath, encoding: .utf8))
                .map { String($0.suffix(800)) } ?? "(log なし)"
            alert.informativeText = """
            daily-brief の起動に失敗しました。
            \(dailyBriefLogPath) を確認してください。

            \(logTail)
            """
            alert.addButton(withTitle: "OK")
            alert.beginSheetModal(for: self.window)
        }
    }

    private func dailyBriefLaunchCommand() -> String {
        let escapedDir = shellEscaped(dailyBriefDir)
        let escapedNode = shellEscaped(dailyBriefNodePath)
        let escapedServer = shellEscaped("server.js")
        return "cd \(escapedDir) && if [ -f .env ]; then source .env; fi && export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH && exec \(escapedNode) \(escapedServer)"
    }

    private func appendDailyBriefLog(_ message: String) {
        guard let data = message.data(using: .utf8) else {
            return
        }
        if FileManager.default.fileExists(atPath: dailyBriefLogPath) == false {
            FileManager.default.createFile(atPath: dailyBriefLogPath, contents: nil)
        }
        if let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: dailyBriefLogPath)) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        }
    }

    private func shellEscaped(_ value: String) -> String {
        if value.isEmpty {
            return "''"
        }
        return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private func ensureDailyBriefDirectories() {
        let fileManager = FileManager.default
        for path in [resolvedDailyBriefOutputDirPath()] {
            do {
                try fileManager.createDirectory(at: URL(fileURLWithPath: path, isDirectory: true), withIntermediateDirectories: true)
            } catch {
                NSLog("Failed to create daily-brief directory %@: %@", path, error.localizedDescription)
            }
        }
    }

    private func startSummaryGeneration(for ymd: String) {
        guard isValidYmd(ymd) else {
            notifyMainSummaryStatus(state: "error", message: "日付形式が不正です。")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            self.prepareSummaryGeneration(for: ymd)
        }
    }

    private func prepareSummaryGeneration(for ymd: String) {
        ensureDailyBriefDirectories()

        if hasExistingSummaryOutput(for: ymd) {
            let shouldContinue = promptForSummaryOverwrite(ymd: ymd)
            guard shouldContinue else {
                notifyMainSummaryStatus(state: "idle", message: "作成をキャンセルしました。")
                return
            }
        }

        if let summaryGenerationProcess, summaryGenerationProcess.isRunning {
            notifyMainSummaryStatus(state: "error", message: "別の Summary 作成が実行中です。完了までお待ちください。")
            return
        }

        do {
            let outputDir = URL(fileURLWithPath: resolvedDailyBriefOutputDirPath(), isDirectory: true)
                .appendingPathComponent(ymd, isDirectory: true)
            try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
            try runAutomaticSummaryGeneration(for: ymd)
        } catch {
            NSLog("Failed to prepare summary generation for %@: %@", ymd, error.localizedDescription)
            notifyMainSummaryStatus(state: "error", message: "Summary 作成の準備に失敗しました: \(error.localizedDescription)")
            presentSummaryAlert(title: "Summary 作成エラー", message: error.localizedDescription)
        }
    }

    private func openSummaryView(for ymd: String) {
        let popupURL = dailyBriefBaseURL.appendingPathComponent("summary-popup")
        var components = URLComponents(url: popupURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "date", value: ymd),
            URLQueryItem(name: "mode", value: "view"),
        ]
        guard let url = components?.url else {
            return
        }
        DispatchQueue.main.async {
            self.openSummaryWindow(url: url, title: "Summery \(ymd)")
        }
    }

    private func runAutomaticSummaryGeneration(for ymd: String) throws {
        notifyMainSummaryStatus(state: "preparing", message: "Summary 作成を開始しています...")

        let process = Process()
        process.executableURL = URL(fileURLWithPath: dailyBriefNodePath)
        process.arguments = [dailyBriefGeneratorScript, "--date", ymd]
        process.currentDirectoryURL = URL(fileURLWithPath: dailyBriefDir, isDirectory: true)
        process.environment = makeDailyBriefEnvironment()

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        var stdoutBuffer = Data()
        var stderrBuffer = Data()

        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            stdoutBuffer.append(data)
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            stderrBuffer.append(data)
            if let chunk = String(data: data, encoding: .utf8) {
                self.forwardDailyBriefProgress(chunk)
            }
        }

        process.terminationHandler = { process in
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil

            let remainingStdout = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            if !remainingStdout.isEmpty { stdoutBuffer.append(remainingStdout) }
            let remainingStderr = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            if !remainingStderr.isEmpty {
                stderrBuffer.append(remainingStderr)
                if let chunk = String(data: remainingStderr, encoding: .utf8) {
                    self.forwardDailyBriefProgress(chunk)
                }
            }

            let stdout = String(data: stdoutBuffer, encoding: .utf8) ?? ""
            let stderr = String(data: stderrBuffer, encoding: .utf8) ?? ""

            DispatchQueue.main.async {
                self.summaryGenerationProcess = nil
            }

            if process.terminationStatus == 0 {
                do {
                    let countText = try self.extractSummaryCountText(from: stdout)
                    self.notifyMainSummaryStatus(state: "completed", message: "Summary を作成しました。\(ymd) / 予約 \(countText)")
                    self.openSummaryView(for: ymd)
                } catch {
                    self.notifyMainSummaryStatus(state: "completed", message: "Summary を作成しました。\(ymd)")
                    self.openSummaryView(for: ymd)
                }
            } else {
                let message = stderr.isEmpty ? stdout : stderr
                NSLog("Automatic summary generation failed for %@: %@", ymd, message)
                self.notifyMainSummaryStatus(state: "error", message: "Summary 後処理に失敗しました: \(message)")
                self.presentSummaryAlert(title: "Summary 後処理エラー", message: message)
            }
        }

        try process.run()
        summaryGenerationProcess = process
    }

    private func makeDailyBriefEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        if let envFile = try? String(contentsOf: URL(fileURLWithPath: dailyBriefDir).appendingPathComponent(".env"), encoding: .utf8) {
            environment.merge(parseDotEnv(envFile)) { _, new in new }
        }
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
        return environment
    }

    private func forwardDailyBriefProgress(_ text: String) {
        let lines = text.split(whereSeparator: \.isNewline).map(String.init)
        for line in lines {
            let message = mapDailyBriefProgressMessage(line)
            guard !message.isEmpty else { continue }
            notifyMainSummaryStatus(state: "processing", message: message)
        }
    }

    private func mapDailyBriefProgressMessage(_ line: String) -> String {
        if let range = line.range(of: "] ") {
            let raw = String(line[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if raw.contains("対象日(JST):") {
                return "対象日の予約を確認しています..."
            }
            if raw.contains("予約件数:") {
                return raw
            }
            if raw.contains("台本生成中") {
                return "brief.md と podcast-script.txt を生成しています..."
            }
            if raw.contains("AivisSpeech を起動します") {
                return "AivisSpeech を起動しています..."
            }
            if raw.contains("AivisSpeech Engine に接続しました") {
                return "AivisSpeech の起動を確認しました。音声生成を始めます..."
            }
            if raw.contains("音声生成中 (engine=aivis") {
                return "AivisSpeech で音声を生成しています..."
            }
            if raw.contains("WAV出力:") {
                return "音声ファイルを保存しています..."
            }
            if raw.contains("MP3出力:") {
                return "mp3 を保存しています..."
            }
            if raw.contains("Firebase Storage 音声アップロード:") {
                return "web再生用の mp3 を Firebase Storage へアップロードしています..."
            }
            if raw.contains("Firebase Storage 音声削除") {
                return "古い web再生用 mp3 を整理しています..."
            }
            if raw.contains("完了。") {
                return "Firestore へ保存しています..."
            }
            return raw
        }
        return line.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func extractSummaryCountText(from stdout: String) throws -> String {
        guard
            let data = stdout.data(using: .utf8),
            let payload = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
        else {
            throw NSError(domain: appName, code: 2008, userInfo: [NSLocalizedDescriptionKey: "Summary 作成結果を解析できませんでした。"])
        }
        let countValue = payload["count"] as? NSNumber
        return countValue.map { "\($0.intValue)件" } ?? "不明"
    }

    private func parseDotEnv(_ contents: String) -> [String: String] {
        var result: [String: String] = [:]
        for rawLine in contents.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") {
                continue
            }
            let normalized = line.hasPrefix("export ") ? String(line.dropFirst(7)) : line
            guard let separator = normalized.firstIndex(of: "=") else {
                continue
            }
            let key = String(normalized[..<separator]).trimmingCharacters(in: .whitespaces)
            var value = String(normalized[normalized.index(after: separator)...]).trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 {
                value = String(value.dropFirst().dropLast())
            } else if value.hasPrefix("'"), value.hasSuffix("'"), value.count >= 2 {
                value = String(value.dropFirst().dropLast())
            }
            result[key] = value
        }
        return result
    }

    private func hasExistingSummaryOutput(for ymd: String) -> Bool {
        let briefPath = URL(fileURLWithPath: resolvedDailyBriefOutputDirPath(), isDirectory: true)
            .appendingPathComponent(ymd, isDirectory: true)
            .appendingPathComponent("brief.md")
            .path
        return FileManager.default.fileExists(atPath: briefPath)
    }

    private func resolvedDailyBriefOutputDirPath() -> String {
        let envURL = URL(fileURLWithPath: dailyBriefDir, isDirectory: true).appendingPathComponent(".env")
        if let envText = try? String(contentsOf: envURL, encoding: .utf8) {
            let env = parseDotEnv(envText)
            if let outputDir = env["OUTPUT_DIR"], !outputDir.isEmpty {
                return outputDir
            }
        }
        return URL(fileURLWithPath: dailyBriefDir, isDirectory: true)
            .appendingPathComponent("output", isDirectory: true)
            .path
    }

    private func promptForSummaryOverwrite(ymd: String) -> Bool {
        promptUserSync(
            title: "既に作成済みです",
            message: "\(ymd) の Summary は既にあります。再作成しますか。",
            buttons: ["キャンセル", "再作成"]
        ) == .alertSecondButtonReturn
    }

    private func promptUserSync(title: String, message: String, buttons: [String]) -> NSApplication.ModalResponse {
        let semaphore = DispatchSemaphore(value: 0)
        var response: NSApplication.ModalResponse = .abort
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = title
            alert.informativeText = message
            for button in buttons {
                alert.addButton(withTitle: button)
            }
            response = alert.runModal()
            semaphore.signal()
        }
        semaphore.wait()
        return response
    }

    private func presentSummaryAlert(title: String, message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = title
            alert.informativeText = message
            alert.addButton(withTitle: "OK")
            alert.beginSheetModal(for: self.window)
        }
    }

    private func notifyMainSummaryStatus(state: String, message: String) {
        let escapedState = jsEscaped(state)
        let escapedMessage = jsEscaped(message)
        let script = """
        window.dispatchEvent(new CustomEvent('summary-generation-status', {
            detail: { state: "\(escapedState)", message: "\(escapedMessage)" }
        }));
        """

        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(script) { _, error in
                if let error {
                    NSLog("Failed to notify summary status: %@", error.localizedDescription)
                }
            }
        }
    }

    private func openFolderInFinder(_ url: URL) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [url.path]
        do {
            try process.run()
        } catch {
            NSLog("Failed to open folder %@: %@", url.path, error.localizedDescription)
        }
    }

    private func isValidYmd(_ value: String) -> Bool {
        let parts = value.split(separator: "-")
        guard parts.count == 3 else { return false }
        return parts.allSatisfy { !$0.isEmpty }
    }

    private func applyCDMonitoringState(_ enabled: Bool, resetProcessedVolumes: Bool) {
        isCDMonitoringEnabled = enabled
        if resetProcessedVolumes {
            processedCDVolumes.removeAll()
        }
        if enabled {
            startASBOCDMonitor()
        } else {
            stopASBOCDMonitor()
        }
    }

    private func startASBOCDMonitor() {
        cdMonitorQueue.async { [weak self] in
            self?.scanForASBOCDs()
        }
        cdMonitorTimer?.invalidate()
        cdMonitorTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            guard let self else {
                return
            }
            self.cdMonitorQueue.async {
                self.scanForASBOCDs()
            }
        }
    }

    private func stopASBOCDMonitor() {
        cdMonitorTimer?.invalidate()
        cdMonitorTimer = nil
    }

    private func scanForASBOCDs() {
        guard isCDMonitoringEnabled else {
            return
        }
        guard !isScanningCDVolumes else {
            return
        }
        isScanningCDVolumes = true
        defer { isScanningCDVolumes = false }

        let volumesRoot = URL(fileURLWithPath: "/Volumes", isDirectory: true)
        let fileManager = FileManager.default
        guard let volumeURLs = try? fileManager.contentsOfDirectory(at: volumesRoot, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else {
            return
        }

        let currentVolumePaths = Set(volumeURLs.filter { url in
            (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
        }.map(\.path))
        processedCDVolumes.formIntersection(currentVolumePaths)

        let candidateVolumes = volumeURLs.filter { isASBOCDVolume($0) }
        for volumeURL in candidateVolumes {
            let volumePath = volumeURL.path
            guard !processedCDVolumes.contains(volumePath) else {
                continue
            }
            processedCDVolumes.insert(volumePath)
            handleASBOCD(at: volumeURL)
        }
    }

    private func isASBOCDVolume(_ volumeURL: URL) -> Bool {
        let fileManager = FileManager.default
        let patientDataURL = volumeURL.appendingPathComponent("IHE_PDI/PATIENT_DATA.JS")
        let rootIndexURL = volumeURL.appendingPathComponent("INDEX.HTM")
        return fileManager.fileExists(atPath: patientDataURL.path) && fileManager.fileExists(atPath: rootIndexURL.path)
    }

    private func handleASBOCD(at volumeURL: URL) {
        do {
            let metadata = try prepareASBOCDMetadata(from: volumeURL)
            guard ensureQtcServerIsRunning() else {
                NSLog("QTC server is unavailable for aSBo CD automation.")
                return
            }
            openASBOImageReport(using: metadata)
        } catch {
            NSLog("Failed to process aSBo CD %@: %@", volumeURL.path, error.localizedDescription)
        }
    }

    private func prepareASBOCDMetadata(from volumeURL: URL) throws -> ASBOCDMetadata {
        let patientDataURL = volumeURL.appendingPathComponent("IHE_PDI/PATIENT_DATA.JS")
        let patientDataSource = try decodeCDText(from: patientDataURL)

        let patientMatch = try firstMatch(in: patientDataSource, pattern: #"Patient\('([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'"#)
        let studyMatch = try firstMatch(in: patientDataSource, pattern: #"Study\('([^']*)',\s*'([^']*)'"#)

        let patientName = stringAt(patientMatch, index: 1) ?? ""
        let contractNumber = stringAt(patientMatch, index: 2) ?? ""
        let gender = normalizeCDGender(stringAt(patientMatch, index: 3) ?? "")
        let dateOfBirth = stringAt(patientMatch, index: 4) ?? ""
        let studyDate = stringAt(studyMatch, index: 1) ?? ""

        let importedImageRelativePaths = try importASBOImages(from: volumeURL)
        let region = inferASBORegion(fromImageCount: importedImageRelativePaths.count)

        return ASBOCDMetadata(
            volumePath: volumeURL.path,
            contractNumber: contractNumber,
            patientName: patientName,
            dateOfBirth: dateOfBirth,
            studyDate: studyDate,
            gender: gender,
            region: region,
            importedImageRelativePaths: importedImageRelativePaths
        )
    }

    private func decodeCDText(from url: URL) throws -> String {
        let data = try Data(contentsOf: url)
        if let text = String(data: data, encoding: .shiftJIS) {
            return text
        }
        if let text = String(data: data, encoding: .utf8) {
            return text
        }
        throw NSError(domain: appName, code: 2001, userInfo: [
            NSLocalizedDescriptionKey: "CD のテキストを読み取れませんでした"
        ])
    }

    private func firstMatch(in text: String, pattern: String) throws -> [String] {
        let regex = try NSRegularExpression(pattern: pattern, options: [])
        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: nsRange) else {
            throw NSError(domain: appName, code: 2002, userInfo: [
                NSLocalizedDescriptionKey: "CD の患者情報を解析できませんでした"
            ])
        }

        return (0..<match.numberOfRanges).compactMap { index in
            let range = match.range(at: index)
            guard let swiftRange = Range(range, in: text) else {
                return nil
            }
            return String(text[swiftRange])
        }
    }

    private func normalizeCDGender(_ rawValue: String) -> String {
        if rawValue.contains("女") {
            return "Female"
        }
        if rawValue.contains("男") {
            return "Male"
        }
        let lowered = rawValue.lowercased()
        if lowered.contains("female") {
            return "Female"
        }
        if lowered.contains("male") {
            return "Male"
        }
        return rawValue
    }

    private func importASBOImages(from volumeURL: URL) throws -> [String] {
        let fileManager = FileManager.default
        let iheRootURL = volumeURL.appendingPathComponent("IHE_PDI", isDirectory: true)
        guard let enumerator = fileManager.enumerator(at: iheRootURL, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else {
            throw NSError(domain: appName, code: 2003, userInfo: [
                NSLocalizedDescriptionKey: "CD 内の画像フォルダを開けませんでした"
            ])
        }

        let sourceImageURLs = (enumerator.allObjects as? [URL] ?? []).filter { url in
            let ext = url.pathExtension.lowercased()
            guard ext == "jpg" || ext == "jpeg" else {
                return false
            }
            let normalizedPath = url.path
            return normalizedPath.contains("/PA") && normalizedPath.contains("/ST") && normalizedPath.contains("/SE")
        }.sorted { lhs, rhs in
            lhs.path.localizedStandardCompare(rhs.path) == .orderedAscending
        }

        guard !sourceImageURLs.isEmpty else {
            throw NSError(domain: appName, code: 2004, userInfo: [
                NSLocalizedDescriptionKey: "CD 内の JPG 画像が見つかりませんでした"
            ])
        }

        let token = makeCDImportToken(volumeName: volumeURL.lastPathComponent)
        let destinationRoot = URL(fileURLWithPath: qtcImportsBaseDir, isDirectory: true)
        let destinationDir = destinationRoot.appendingPathComponent(token, isDirectory: true)
        if fileManager.fileExists(atPath: destinationDir.path) {
            try fileManager.removeItem(at: destinationDir)
        }
        try fileManager.createDirectory(at: destinationDir, withIntermediateDirectories: true)

        var relativePaths: [String] = []
        for (index, sourceURL) in sourceImageURLs.enumerated() {
            let filename = String(format: "%02d.%@", index + 1, sourceURL.pathExtension.lowercased())
            let destinationURL = destinationDir.appendingPathComponent(filename)
            try fileManager.copyItem(at: sourceURL, to: destinationURL)
            relativePaths.append("cd-imports/\(token)/\(filename)")
        }

        return relativePaths
    }

    private func makeCDImportToken(volumeName: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Tokyo")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let timestamp = formatter.string(from: Date())
        let sanitized = volumeName.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "-", options: .regularExpression)
        return "\(sanitized)-\(timestamp)"
    }

    private func inferASBORegion(fromImageCount imageCount: Int) -> String {
        switch imageCount {
        case 2:
            return "CHEST XR"
        case 3:
            return "SINUS XR"
        default:
            return "XR"
        }
    }

    private func openASBOImageReport(using metadata: ASBOCDMetadata) {
        guard var components = URLComponents(url: qtcServerBaseURL.appendingPathComponent("ImageReport.html"), resolvingAgainstBaseURL: false) else {
            return
        }

        var queryItems = [
            URLQueryItem(name: "contract", value: metadata.contractNumber),
            URLQueryItem(name: "region", value: metadata.region),
            URLQueryItem(name: "patientName", value: metadata.patientName),
            URLQueryItem(name: "dateOfBirth", value: metadata.dateOfBirth),
            URLQueryItem(name: "studyDate", value: metadata.studyDate),
            URLQueryItem(name: "gender", value: metadata.gender),
            URLQueryItem(name: "source", value: "asbo-cd")
        ]
        queryItems.append(contentsOf: metadata.importedImageRelativePaths.map { URLQueryItem(name: "image", value: $0) })
        components.queryItems = queryItems

        guard let url = components.url else {
            return
        }

        openInChrome(url)
    }

    private func openQtcTool(tool: String, contractNumber: String) {
        let normalizedTool = tool.lowercased()
        let toolFile: String
        let toolTitle: String
        switch normalizedTool {
        case "audiogram":
            toolFile = "audiogram.html"
            toolTitle = "AUD"
        case "imaging":
            toolFile = "ImageReport.html"
            toolTitle = "XR"
        default:
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard self.ensureQtcServerIsRunning() else {
                self.presentQtcFailure(tool: toolTitle)
                return
            }

            guard
                var components = URLComponents(url: qtcServerBaseURL.appendingPathComponent(toolFile), resolvingAgainstBaseURL: false)
            else {
                return
            }
            components.queryItems = [
                URLQueryItem(name: "contract", value: contractNumber)
            ]
            guard let url = components.url else {
                return
            }

            DispatchQueue.main.async {
                self.openPopupWindow(url: url, title: toolTitle, kind: .tool)
            }
        }
    }

    private func ensureQtcServerIsRunning() -> Bool {
        if isQtcServerReady() {
            return true
        }

        guard
            FileManager.default.fileExists(atPath: qtcPython),
            FileManager.default.fileExists(atPath: qtcServerScript)
        else {
            NSLog("QTC server dependencies are missing.")
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
            NSLog("Failed to start QTC server: %@", error.localizedDescription)
        }

        for _ in 0..<10 {
            if isQtcServerReady() {
                return true
            }
            Thread.sleep(forTimeInterval: 0.5)
        }

        return false
    }

    private func presentQtcFailure(tool: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "\(tool) を起動できませんでした"
            alert.informativeText = """
            QTC tool server の起動に失敗しました。
            /Users/shungohiroyasu/bin/sospdf_server.py を確認してください。
            """
            alert.addButton(withTitle: "OK")
            alert.beginSheetModal(for: self.window)
        }
    }

    private func isQtcServerReady() -> Bool {
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        probe.arguments = ["-fsS", "--max-time", "1", qtcHealthCheckURL.absoluteString]
        probe.standardOutput = FileHandle(forWritingAtPath: "/dev/null")
        probe.standardError = FileHandle(forWritingAtPath: "/dev/null")
        do {
            try probe.run()
            probe.waitUntilExit()
            return probe.terminationStatus == 0
        } catch {
            NSLog("Failed to probe QTC server %@: %@", qtcHealthCheckURL.absoluteString, error.localizedDescription)
            return false
        }
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

    private func runUtilityTool(named tool: String, details: [String: Any]?, sourceWebView: WKWebView?) {
        guard tool == "va-records" else {
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            guard let details else {
                NSLog("VA Records details are missing.")
                self.notifyWebView(sourceWebView, status: "error", message: "VA Records のデータが見つかりません。")
                return
            }

            do {
                let folderName = try self.createVaRecordFolder(details: details)
                self.openVaRecordsFolderInFinder()
                self.notifyWebView(sourceWebView, status: "success", message: "保存しました: \(folderName)")
            } catch {
                NSLog("Failed to create VA Records folder: %@", error.localizedDescription)
                self.notifyWebView(sourceWebView, status: "error", message: "エラー: \(error.localizedDescription)")
            }
        }
    }

    private func createVaRecordFolder(details: [String: Any]) throws -> String {
        let folderName = try resolveVaRecordFolderName(details: details)
        let folderURL = URL(fileURLWithPath: vaRecordsBaseDir).appendingPathComponent(folderName, isDirectory: true)
        try FileManager.default.createDirectory(at: folderURL, withIntermediateDirectories: true)
        let markdown = buildAppointmentMarkdown(details: details)
        let markdownFilename = vaRecordMarkdownFilename(details: details)
        let markdownURL = folderURL.appendingPathComponent(markdownFilename)
        try markdown.write(to: markdownURL, atomically: true, encoding: .utf8)
        return folderName
    }

    private func openVaRecordsFolderInFinder() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [vaRecordsBaseDir]
        do {
            try process.run()
        } catch {
            NSLog("Failed to open VA Records folder: %@", error.localizedDescription)
        }
    }

    private func resolveVaRecordFolderName(details: [String: Any]) throws -> String {
        let appointmentDate = extractDate(details["appointmentDateTimeMs"])
        let claimantName = stringValue(details["claimantName"])
        let mmdd = folderDateString(from: appointmentDate)
        let initials = try folderInitials(from: claimantName)
        return "\(mmdd)\(initials)"
    }

    private func vaRecordMarkdownFilename(details: [String: Any]) -> String {
        let services = (details["services"] as? [String]) ?? []
        let hasAudiology = services.contains { service in
            let normalized = service.trimmingCharacters(in: .whitespacesAndNewlines)
            return normalized.localizedCaseInsensitiveContains("audiology")
                || normalized.localizedCaseInsensitiveContains("audiologist")
        }
        return hasAudiology ? "Audiology.md" : "General.md"
    }

    private func buildAppointmentMarkdown(details: [String: Any]) -> String {
        let claimantName = sanitizeMarkdownInline(stringValue(details["claimantName"]))
        let contractNumber = sanitizeMarkdownInline(stringValue(details["contractNumber"]))
        let appointmentDate = formattedAppointmentDate(details["appointmentDateTimeMs"])
        let dateOfBirth = sanitizeMarkdownInline(stringValue(details["dateOfBirth"]))
        let phone = sanitizeMarkdownInline(stringValue(details["japanCellPhone"]))
        let visitDate = sanitizeMarkdownInline(stringValue(details["visitDate"]))
        let referenceUrl = sanitizeMarkdownInline(stringValue(details["referenceUrl"]))
        let notes = stringValue(details["notes"])
        let services = ((details["services"] as? [String]) ?? []).map { sanitizeMarkdownInline($0) }
        let referralDests = (details["referralDests"] as? [String]) ?? []

        let serviceLines = services.isEmpty ? "- なし" : services.map { "- \($0)" }.joined(separator: "\n")
        let referralLines = referralDests.isEmpty
            ? "- なし"
            : referralDests.map { "- \(referralDisplayName(for: $0))" }.joined(separator: "\n")
        let notesBlock = notes.isEmpty ? "なし" : notes

        return """
        # Reservation Details

        - 氏名: \(claimantName)
        - 契約番号: \(contractNumber)
        - 予約日時: \(appointmentDate)
        - 生年月日: \(dateOfBirth)
        - 電話番号: \(phone)
        - 受診日: \(visitDate)
        - URL: \(referenceUrl)

        ## 紹介先
        \(referralLines)

        ## 検査内容
        \(serviceLines)

        ## メモ
        \(notesBlock)
        """
    }

    private func formattedAppointmentDate(_ rawValue: Any?) -> String {
        if let number = rawValue as? NSNumber {
            let date = Date(timeIntervalSince1970: number.doubleValue / 1000.0)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "ja_JP")
            formatter.timeZone = TimeZone(identifier: "Asia/Tokyo")
            formatter.dateFormat = "MM/dd(E) HH:mm"
            return formatter.string(from: date)
        }

        return ""
    }

    private func referralDisplayName(for key: String) -> String {
        switch key {
        case "ASBO":
            return "aSBo"
        case "KIN":
            return "KINSP"
        case "ANSHIN":
            return "ANSIN"
        default:
            return key
        }
    }

    private func stringValue(_ value: Any?) -> String {
        if let string = value as? String {
            return string
        }
        return ""
    }

    // Firestore由来の値が改行を含むとMarkdownの見出し・リストとして解釈されうるため1行に潰す
    private func sanitizeMarkdownInline(_ value: String) -> String {
        return value
            .replacingOccurrences(of: "\r\n", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func extractDate(_ rawValue: Any?) -> Date {
        if let number = rawValue as? NSNumber {
            return Date(timeIntervalSince1970: number.doubleValue / 1000.0)
        }
        return Date()
    }

    private func folderDateString(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = TimeZone(identifier: "Asia/Tokyo")
        formatter.dateFormat = "MMdd"
        return formatter.string(from: date)
    }

    private func folderInitials(from claimantName: String) throws -> String {
        let parts = claimantName.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: true)
        guard parts.count == 2 else {
            throw NSError(domain: appName, code: 1001, userInfo: [
                NSLocalizedDescriptionKey: "氏名の形式を解釈できません"
            ])
        }

        let lastInitial = parts[0].trimmingCharacters(in: .whitespacesAndNewlines).first
        let firstInitial = parts[1].trimmingCharacters(in: .whitespacesAndNewlines).first
        guard let lastInitial, let firstInitial else {
            throw NSError(domain: appName, code: 1002, userInfo: [
                NSLocalizedDescriptionKey: "氏名のイニシャルを取得できません"
            ])
        }

        return "\(String(lastInitial).uppercased())\(String(firstInitial).uppercased())"
    }

    private func notifyWebView(_ webView: WKWebView?, status: String, message: String) {
        guard let webView else {
            return
        }

        let escapedStatus = jsEscaped(status)
        let escapedMessage = jsEscaped(message)
        let script = """
        window.dispatchEvent(new CustomEvent('va-records-result', {
            detail: { status: "\(escapedStatus)", message: "\(escapedMessage)" }
        }));
        """

        DispatchQueue.main.async {
            webView.evaluateJavaScript(script) { _, error in
                if let error {
                    NSLog("Failed to notify detail webview: %@", error.localizedDescription)
                }
            }
        }
    }

    private func jsEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "")
    }

    private func stringAt(_ values: [String], index: Int) -> String? {
        guard values.indices.contains(index) else {
            return nil
        }
        return values[index]
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
            let popupKind = popupKinds.removeValue(forKey: matchingEntry.key)
            popupWindows.removeValue(forKey: matchingEntry.key)
            if popupKind == .summary {
                stopDailyBriefIfNeeded()
            }
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
