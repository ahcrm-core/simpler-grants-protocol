import AVFoundation
import CoreGraphics
import CoreMedia
import Darwin
import Foundation
import ScreenCaptureKit

// Compile on the disposable macOS runner; see RECORDER.md.
// This helper never requests or changes macOS privacy permissions.

private let maximumRecordingSeconds: TimeInterval = 240
private let pollingNanoseconds: UInt64 = 100_000_000

private struct RecorderFailure: Error, CustomStringConvertible {
    let description: String
}

private struct Paths {
    let movie: URL
    let lifecycle: URL
    let ready: URL
    let stop: URL

    init(arguments: [String]) throws {
        guard arguments.count == 5 else {
            throw RecorderFailure(description:
                "Usage: ScreenRecorder output.mov lifecycle.json ready-file stop-file")
        }
        let urls = arguments.dropFirst().map {
            URL(fileURLWithPath: $0).standardizedFileURL.resolvingSymlinksInPath()
        }
        guard Set(urls.map(\.path)).count == 4 else {
            throw RecorderFailure(description: "All four artifact paths must be distinct.")
        }
        movie = urls[0]
        lifecycle = urls[1]
        ready = urls[2]
        stop = urls[3]
        guard movie.pathExtension.lowercased() == "mov" else {
            throw RecorderFailure(description: "The output filename must end in .mov.")
        }
        for url in urls where FileManager.default.fileExists(atPath: url.path) {
            throw RecorderFailure(description:
                "Refusing to overwrite or reuse an existing artifact: \(url.path)")
        }
    }
}

// Delegate callbacks are not assumed to arrive on the main thread.
private final class LifecycleLog {
    private let lock = NSLock()
    private let url: URL
    private var document: [String: Any]
    private var events: [[String: Any]] = []
    private var hasFailed = false

    init(paths: Paths) throws {
        url = paths.lifecycle
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        document = [
            "schemaVersion": 1,
            "status": "initializing",
            "outputPath": paths.movie.path,
            "readyPath": paths.ready.path,
            "stopPath": paths.stop.path,
            "maximumRecordingSeconds": maximumRecordingSeconds,
            "capturesSystemAudio": true,
            "capturesMicrophone": false,
            "audioVerification": "unverified; inspect and listen to the actual movie",
            "macOS": ProcessInfo.processInfo.operatingSystemVersionString
        ]
        event("initialized")
    }

    func event(_ name: String, status: String? = nil,
               details: [String: Any] = [:]) {
        lock.lock()
        defer { lock.unlock() }
        if let status = status, !hasFailed {
            document["status"] = status
        }
        var entry = details
        entry["event"] = name
        entry["time"] = ISO8601DateFormatter().string(from: Date())
        entry["uptimeSeconds"] = ProcessInfo.processInfo.systemUptime
        events.append(entry)
        persistLocked()
    }

    func fail(_ stage: String, _ message: String) {
        lock.lock()
        defer { lock.unlock() }
        hasFailed = true
        document["status"] = "failed"
        if document["error"] == nil {
            document["error"] = ["stage": stage, "message": message]
        }
        events.append([
            "event": "error",
            "stage": stage,
            "message": message,
            "time": ISO8601DateFormatter().string(from: Date()),
            "uptimeSeconds": ProcessInfo.processInfo.systemUptime
        ])
        persistLocked()
    }

    private func persistLocked() {
        document["events"] = events
        do {
            let data = try JSONSerialization.data(
                withJSONObject: document, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: url, options: .atomic)
        } catch {
            FileHandle.standardError.write(
                Data("Cannot persist recorder lifecycle: \(error)\n".utf8))
            exit(74)
        }
    }
}

// A dispatch timer also bounds OS calls that never return to the async caller.
private final class Watchdog {
    private let timer = DispatchSource.makeTimerSource(
        queue: DispatchQueue.global(qos: .utility))
    private let log: LifecycleLog

    init(log: LifecycleLog) {
        self.log = log
        timer.schedule(deadline: .distantFuture)
        timer.resume()
    }

    func arm(seconds: TimeInterval, stage: String) {
        let log = self.log
        timer.setEventHandler {
            log.fail(stage, "Operation exceeded its \(seconds)-second deadline.")
            FileHandle.standardError.write(Data("Recorder timed out: \(stage)\n".utf8))
            // Forced exit is a failed, potentially incomplete artifact, never success.
            exit(124)
        }
        timer.schedule(deadline: .now() + seconds)
    }

    func cancel() { timer.cancel() }
}

@available(macOS 15.0, *)
private final class RecorderSession: NSObject,
    SCRecordingOutputDelegate, SCStreamDelegate {
    private let lock = NSLock()
    private let log: LifecycleLog
    private let readyURL: URL
    private var startedAt: TimeInterval?
    private var finished = false
    private var failure: String?

    // Strong references retain the capture objects throughout asynchronous teardown.
    var stream: SCStream?
    var recording: SCRecordingOutput?

    init(log: LifecycleLog, readyURL: URL) {
        self.log = log
        self.readyURL = readyURL
        super.init()
    }

    func snapshot() -> (startedAt: TimeInterval?, finished: Bool, failure: String?) {
        lock.lock()
        defer { lock.unlock() }
        return (startedAt, finished, failure)
    }

    private func recordFailure(stage: String, error: Error) {
        lock.lock()
        if failure == nil { failure = String(describing: error) }
        lock.unlock()
        log.fail(stage, String(describing: error))
    }

    func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        var readyError: Error?
        lock.lock()
        guard startedAt == nil, failure == nil, !finished else {
            lock.unlock()
            return
        }
        startedAt = ProcessInfo.processInfo.systemUptime
        log.event("recording_started_delegate", status: "recording")
        do {
            // This is the only place that creates the ready signal or emits READY.
            // Publish while holding the state lock, so a known failure cannot race it.
            try Data("READY\n".utf8).write(to: readyURL, options: .atomic)
            FileHandle.standardOutput.write(Data("READY\n".utf8))
        } catch {
            failure = String(describing: error)
            readyError = error
        }
        lock.unlock()
        if let error = readyError {
            log.fail("ready_signal", String(describing: error))
        }
    }

    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        lock.lock()
        finished = true
        lock.unlock()
        log.event("recording_finished_delegate")
    }

    func recordingOutput(_ recordingOutput: SCRecordingOutput,
                         didFailWithError error: Error) {
        recordFailure(stage: "recording_delegate", error: error)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        recordFailure(stage: "stream_delegate", error: error)
    }
}

@available(macOS 15.0, *)
private func runRecorder(paths: Paths, log: LifecycleLog) async throws {
    let environment = ProcessInfo.processInfo.environment
    guard environment["GITHUB_ACTIONS"] == "true",
          environment["RUNNER_ENVIRONMENT"] == "github-hosted",
          environment["RUNNER_OS"] == "macOS" else {
        throw RecorderFailure(description:
            "Capture is restricted to a disposable GitHub-hosted macOS Actions runner.")
    }

    for url in [paths.movie, paths.ready, paths.stop] {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    }

    let watchdog = Watchdog(log: log)
    defer { watchdog.cancel() }
    watchdog.arm(seconds: 45, stage: "startup_timeout")
    let session = RecorderSession(log: log, readyURL: paths.ready)
    var captureMayBeActive = false

    do {
        // Diagnostic only: actual ScreenCaptureKit access is the capability check.
        log.event("permission_preflight", details: [
            "screenCaptureAccess": CGPreflightScreenCaptureAccess()
        ])
        let content = try await SCShareableContent.current
        guard let display = content.displays.first(where: {
            $0.displayID == CGMainDisplayID()
        }) ?? content.displays.sorted(by: { $0.displayID < $1.displayID }).first else {
            throw RecorderFailure(description: "No capturable display is available.")
        }
        guard display.width > 0, display.height > 0 else {
            throw RecorderFailure(description: "The selected display has invalid dimensions.")
        }
        log.event("display_selected", details: [
            "displayID": display.displayID,
            "width": display.width,
            "height": display.height,
            "availableDisplayCount": content.displays.count,
            "selection": "entire main display, or first display if no main display matches"
        ])

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = display.width
        configuration.height = display.height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.showsCursor = true
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = false
        configuration.captureMicrophone = false

        let stream = SCStream(
            filter: filter, configuration: configuration, delegate: session)
        let outputConfiguration = SCRecordingOutputConfiguration()
        guard outputConfiguration.availableOutputFileTypes.contains(.mov),
              outputConfiguration.availableVideoCodecTypes.contains(.h264) else {
            throw RecorderFailure(description: "MOV with H.264 is unavailable on this runner.")
        }
        outputConfiguration.outputURL = paths.movie
        outputConfiguration.outputFileType = .mov
        outputConfiguration.videoCodecType = .h264
        let recording = SCRecordingOutput(
            configuration: outputConfiguration, delegate: session)
        session.stream = stream
        session.recording = recording
        try stream.addRecordingOutput(recording)
        log.event("capture_start_requested", status: "starting")
        captureMayBeActive = true
        try await stream.startCapture()

        while session.snapshot().startedAt == nil {
            let state = session.snapshot()
            if let failure = state.failure {
                throw RecorderFailure(description: failure)
            }
            if state.finished {
                throw RecorderFailure(description: "Recording finished before it started.")
            }
            try await Task.sleep(nanoseconds: pollingNanoseconds)
        }
        let startedAt = session.snapshot().startedAt!
        // Polling below requests stop at 240 seconds; this timer catches a stalled loop.
        watchdog.arm(
            seconds: max(1, maximumRecordingSeconds
                         - (ProcessInfo.processInfo.systemUptime - startedAt) + 2),
            stage: "recording_monitor_timeout")

        var stopReason = "stop_file"
        while true {
            let state = session.snapshot()
            if let failure = state.failure {
                throw RecorderFailure(description: failure)
            }
            if state.finished {
                throw RecorderFailure(description: "Recording ended before a stop request.")
            }
            if FileManager.default.fileExists(atPath: paths.stop.path) { break }
            if ProcessInfo.processInfo.systemUptime - startedAt >= maximumRecordingSeconds {
                stopReason = "maximum_duration"
                break
            }
            try await Task.sleep(nanoseconds: pollingNanoseconds)
        }

        log.event("capture_stop_requested", status: "stopping", details: [
            "reason": stopReason,
            "elapsedRecordingSeconds": ProcessInfo.processInfo.systemUptime - startedAt
        ])
        watchdog.arm(seconds: 20, stage: "stop_capture_timeout")
        try await stream.stopCapture()
        captureMayBeActive = false
        watchdog.arm(seconds: 20, stage: "finalization_timeout")
        log.event("capture_stopped", status: "finalizing")
        while !session.snapshot().finished {
            if let failure = session.snapshot().failure {
                throw RecorderFailure(description: failure)
            }
            try await Task.sleep(nanoseconds: pollingNanoseconds)
        }
        if let failure = session.snapshot().failure {
            throw RecorderFailure(description: failure)
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: paths.movie.path)
        let bytes = (attributes[.size] as? NSNumber)?.int64Value ?? 0
        guard bytes > 0 else {
            throw RecorderFailure(description: "The finalized movie is empty or missing.")
        }
        log.event("movie_finalized", details: ["bytes": bytes, "stopReason": stopReason])
        guard stopReason == "stop_file" else {
            throw RecorderFailure(description:
                "The 240-second recording limit was reached before the harness stopped it.")
        }
        log.event("completed", status: "completed", details: [
            "bytes": bytes,
            "audioVerification": "not performed by recorder; actual movie review required"
        ])
        session.recording = nil
        session.stream = nil
    } catch {
        log.fail("capture", String(describing: error))
        if captureMayBeActive, let stream = session.stream {
            log.event("failure_cleanup_stop_requested")
            watchdog.arm(seconds: 15, stage: "failure_cleanup_timeout")
            do {
                try await stream.stopCapture()
                // Best-effort finalization remains bounded; failure stays recorded.
                let deadline = ProcessInfo.processInfo.systemUptime + 5
                while !session.snapshot().finished,
                      ProcessInfo.processInfo.systemUptime < deadline {
                    try await Task.sleep(nanoseconds: pollingNanoseconds)
                }
                log.event("failure_cleanup_finished", details: [
                    "receivedFinishDelegate": session.snapshot().finished
                ])
            } catch {
                log.fail("failure_cleanup", String(describing: error))
            }
        }
        throw error
    }
}

@main
private struct ScreenRecorderMain {
    static func main() async {
        var log: LifecycleLog?
        do {
            let paths = try Paths(arguments: CommandLine.arguments)
            let lifecycle = try LifecycleLog(paths: paths)
            log = lifecycle
            guard #available(macOS 15.0, *) else {
                throw RecorderFailure(description: "This recorder requires macOS 15 or newer.")
            }
            try await runRecorder(paths: paths, log: lifecycle)
        } catch {
            log?.fail("main", String(describing: error))
            FileHandle.standardError.write(Data("Recorder failed: \(error)\n".utf8))
            exit(1)
        }
    }
}
