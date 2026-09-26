import Foundation

// All public entry points and callbacks run on the main queue. Pipe draining is off-main.
final class EvidenceReviewProcess {
    private var process: Process?
    private(set) var status: [String: Any]?
    var onStatus: (([String: Any]) -> Void)?

    func start(_ request: [String: Any], nodePath: String, resources: URL) {
        guard let jobID = request["jobId"] as? String, !jobID.isEmpty, jobID.count < 100 else { return }
        guard process == nil else {
            onStatus?(["jobId": jobID, "state": "error", "message": "別の取得処理が実行中です。完了までお待ちください。"])
            return
        }
        let fm = FileManager.default
        let directory = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/SOSList Local/EvidenceReview", isDirectory: true)
        let requestURL = directory.appendingPathComponent(UUID().uuidString + ".json")
        do {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONSerialization.data(withJSONObject: request)
            guard data.count < 100_000 else { throw NSError(domain: "EvidenceReview", code: 1, userInfo: [NSLocalizedDescriptionKey: "取得対象の情報が大きすぎます。"]) }
            try data.write(to: requestURL, options: .atomic)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: requestURL.path)
            let child = Process(), output = Pipe()
            child.executableURL = URL(fileURLWithPath: nodePath)
            child.arguments = [resources.appendingPathComponent("local/evidence-review/runner.cjs").path, requestURL.path]
            child.currentDirectoryURL = directory
            child.standardOutput = output
            child.standardError = FileHandle.nullDevice
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "\(URL(fileURLWithPath: nodePath).deletingLastPathComponent().path):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            child.environment = environment
            try child.run()
            process = child
            publish(["jobId": jobID, "state": "running", "message": "Codex CLIを起動しています…"])
            DispatchQueue.global(qos: .utility).async { [self] in
                var buffer = Data()
                var receivedFinal = false
                while true {
                    let chunk = output.fileHandleForReading.availableData
                    if chunk.isEmpty { break }
                    buffer.append(chunk)
                    while let newline = buffer.firstIndex(of: 10) {
                        let line = Data(buffer[..<newline])
                        buffer.removeSubrange(...newline)
                        guard var event = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
                        event["jobId"] = jobID
                        if let state = event["state"] as? String, ["completed", "partial", "blocked", "error", "cancelled"].contains(state) { receivedFinal = true }
                        let update = event
                        DispatchQueue.main.async { self.publish(update) }
                    }
                }
                child.waitUntilExit()
                try? fm.removeItem(at: requestURL)
                let finished = receivedFinal
                DispatchQueue.main.async {
                    self.process = nil
                    if !finished {
                        self.publish(["jobId": jobID, "state": "error", "message": "取得処理が終了しました（\(child.terminationStatus)）。保存完了は未確認です。"])
                    }
                }
            }
        } catch {
            try? fm.removeItem(at: requestURL)
            publish(["jobId": jobID, "state": "error", "message": "取得を開始できません: \(error.localizedDescription)"])
        }
    }

    func stop(jobID: String? = nil) {
        guard let process, process.isRunning, jobID == nil || jobID == status?["jobId"] as? String else { return }
        process.terminate() // runner forwards TERM to its Codex process group and cleans up.
    }

    private func publish(_ update: [String: Any]) {
        status = update
        onStatus?(update)
    }
}
