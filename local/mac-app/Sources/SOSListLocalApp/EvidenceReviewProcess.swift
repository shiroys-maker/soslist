import AppKit
import Foundation

// All public entry points and callbacks run on the main queue. Pipe draining is off-main.
final class EvidenceReviewProcess {
    private var process: Process?
    private var approvalAlert: NSAlert?
    private(set) var status: [String: Any]?
    var onStatus: (([String: Any]) -> Void)?
    private var quitCompletions: [() -> Void] = []
    private let terminalStates: Set<String> = ["completed", "no_records", "paused", "partial", "blocked", "error", "cancelled"]
    private let busyStates: Set<String> = ["starting", "running", "progress", "recovering", "cancelling"]
    var isActive: Bool { process != nil }

    private var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/SOSList Local/EvidenceReview", isDirectory: true)
    }

    // The runner owns this durable file. It excludes jobId, which belongs to a single UI invocation.
    var currentStatus: [String: Any]? { status ?? restoredStatus() }

    private func restoredStatus() -> [String: Any]? {
        let file = directory.appendingPathComponent("last-status.json")
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              let size = attributes[.size] as? NSNumber, size.intValue > 0, size.intValue <= 65_536,
              let data = try? Data(contentsOf: file),
              var saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let savedState = saved["state"] as? String else { return nil }
        saved.removeValue(forKey: "jobId")
        let candidateID = saved["resumeId"] as? String
        let resumeID = candidateID?.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil ? candidateID : nil
        if resumeID == nil {
            saved.removeValue(forKey: "resumeId")
        }
        if busyStates.contains(savedState) {
            saved["state"] = resumeID == nil ? "error" : "paused"
            saved["message"] = resumeID == nil
                ? "前回の取得は中断されました。保存完了は未確認です。"
                : "前回の取得は中断されました。「再開」から状態を確認してください。"
        } else if !terminalStates.contains(savedState) {
            return nil
        }
        return saved
    }

    func start(_ request: [String: Any], nodePath: String, resources: URL) {
        guard let jobID = request["jobId"] as? String, !jobID.isEmpty, jobID.count < 100 else { return }
        let requestedResumeID = request["resumeId"] as? String
        guard let mode = request["mode"] as? String, ["single", "batch", "resume"].contains(mode),
              mode != "resume" || ((request["resumeId"] as? String)?.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil) else {
            onStatus?(["jobId": jobID, "state": "error", "message": "取得方法または再開情報が不正です。"])
            return
        }
        guard process == nil else {
            var failure: [String: Any] = ["jobId": jobID, "state": "error", "message": "別の取得処理が実行中です。完了までお待ちください。"]
            failure["resumeId"] = requestedResumeID
            onStatus?(failure)
            return
        }
        let fm = FileManager.default
        let directory = self.directory
        let requestURL = directory.appendingPathComponent(UUID().uuidString + ".json")
        do {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONSerialization.data(withJSONObject: request)
            guard data.count < 100_000 else { throw NSError(domain: "EvidenceReview", code: 1, userInfo: [NSLocalizedDescriptionKey: "取得対象の情報が大きすぎます。"]) }
            try data.write(to: requestURL, options: .atomic)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: requestURL.path)
            let child = Process(), output = Pipe(), errors = Pipe(), answers = Pipe()
            child.executableURL = URL(fileURLWithPath: nodePath)
            child.arguments = [resources.appendingPathComponent("local/evidence-review/runner.cjs").path, requestURL.path]
            child.currentDirectoryURL = directory
            child.standardOutput = output
            child.standardError = errors
            child.standardInput = answers
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "\(URL(fileURLWithPath: nodePath).deletingLastPathComponent().path):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            child.environment = environment
            try child.run()
            process = child
            publish(["jobId": jobID, "state": "running", "message": "Evidence Reviewを起動しています…"])
            DispatchQueue.global(qos: .utility).async { [self] in
                let stderrState = EvidenceStderrState()
                let stderrDrain = DispatchGroup()
                stderrDrain.enter()
                DispatchQueue.global(qos: .utility).async {
                    while true {
                        let chunk = errors.fileHandleForReading.availableData
                        if chunk.isEmpty { break }
                        stderrState.observe(chunk.count)
                    }
                    stderrDrain.leave()
                }
                var buffer = Data()
                var receivedFinal = false
                while true {
                    let chunk = output.fileHandleForReading.availableData
                    if chunk.isEmpty { break }
                    buffer.append(chunk)
                    if buffer.count > 65_536 && !buffer.contains(10) {
                        buffer.removeAll(keepingCapacity: true)
                        continue
                    }
                    while let newline = buffer.firstIndex(of: 10) {
                        let line = Data(buffer[..<newline])
                        buffer.removeSubrange(...newline)
                        guard line.count <= 65_536 else { continue }
                        guard var event = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
                        if event["type"] as? String == "appApproval" {
                            let request = event
                            DispatchQueue.main.async { self.requestAppApproval(request, child: child, answers: answers) }
                            continue
                        }
                        event["jobId"] = jobID
                        if let state = event["state"] as? String, terminalStates.contains(state) { receivedFinal = true }
                        let update = event
                        DispatchQueue.main.async { self.publish(update) }
                    }
                }
                child.waitUntilExit()
                stderrDrain.wait()
                try? fm.removeItem(at: requestURL)
                let finished = receivedFinal
                DispatchQueue.main.async {
                    self.dismissApproval()
                    self.process = nil
                    if !finished {
                        var interrupted = self.restoredStatus() ?? [:]
                        interrupted["jobId"] = jobID
                        interrupted["state"] = (interrupted["resumeId"] as? String) == nil ? "error" : "paused"
                        let reason = child.terminationReason == .uncaughtSignal ? "signal" : "exit"
                        let diagnostic = stderrState.hadOutput ? "、診断出力あり" : ""
                        interrupted["message"] = "取得処理が中断されました（\(reason) \(child.terminationStatus)\(diagnostic)）。保存完了は未確認です。"
                        self.publish(interrupted)
                    }
                    let completions = self.quitCompletions
                    self.quitCompletions.removeAll()
                    completions.forEach { $0() }
                }
            }
        } catch {
            try? fm.removeItem(at: requestURL)
            var failure: [String: Any] = ["jobId": jobID, "state": "error", "message": "取得を開始できません。アプリの実行環境を確認してください。"]
            failure["resumeId"] = requestedResumeID
            publish(failure)
        }
    }

    func stop(jobID: String? = nil) {
        guard let process, process.isRunning, jobID == nil || jobID == status?["jobId"] as? String else { return }
        dismissApproval()
        process.terminate() // The runner owns session cleanup and receives SIGTERM.
    }

    // NSApplication waits for runner-owned cleanup. A timeout lets the app quit while
    // leaving the durable interrupted state for the next launch.
    func stopForQuit(completion: @escaping () -> Void) {
        guard process != nil else { completion(); return }
        quitCompletions.append(completion)
        stop()
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, !self.quitCompletions.isEmpty else { return }
            let completions = self.quitCompletions
            self.quitCompletions.removeAll()
            completions.forEach { $0() }
        }
    }

    private func publish(_ update: [String: Any]) {
        status = update
        onStatus?(update)
    }

    private func requestAppApproval(_ request: [String: Any], child: Process, answers: Pipe) {
        guard process === child, child.isRunning,
              let requestID = request["requestId"] as? String,
              UUID(uuidString: requestID) != nil,
              let appName = request["appName"] as? String else { return }
        let respond: (Bool) -> Void = { [weak self] accepted in
            guard self?.process === child, child.isRunning,
                  let data = try? JSONSerialization.data(withJSONObject: ["type": "appApproval", "requestId": requestID, "action": accepted ? "accept" : "decline"]) else { return }
            do { try answers.fileHandleForWriting.write(contentsOf: data + Data([10])) } catch { self?.stop() }
        }
        guard approvalAlert == nil, let window = NSApp.mainWindow ?? NSApp.keyWindow else { respond(false); return }
        let alert = NSAlert()
        alert.messageText = "取得で\(appName)を使用することを許可しますか？"
        alert.informativeText = "Codexの画面操作に必要な利用許可です。今回の取得セッションに適用されます。拒否した場合は途中状態を残して停止します。"
        alert.addButton(withTitle: "許可")
        alert.addButton(withTitle: "許可しない")
        approvalAlert = alert
        NSApp.activate(ignoringOtherApps: true)
        alert.beginSheetModal(for: window) { [weak self] response in
            self?.approvalAlert = nil
            respond(response == .alertFirstButtonReturn)
        }
    }

    private func dismissApproval() {
        guard let alert = approvalAlert else { return }
        approvalAlert = nil
        if let parent = alert.window.sheetParent { parent.endSheet(alert.window, returnCode: .alertSecondButtonReturn) }
    }
}

private final class EvidenceStderrState {
    private(set) var hadOutput = false
    private var observedBytes = 0
    func observe(_ count: Int) {
        observedBytes = min(65_536, observedBytes + count)
        hadOutput = observedBytes > 0
    }
}
