# Native Safari and VoiceOver evidence recorder

ScreenRecorder.swift captures the full primary display and actual system audio with Apple's ScreenCaptureKit. Microphone capture is disabled. It generates no audio, replaces no speech, and does not use a microphone or synthesized narration as a substitute for VoiceOver output.

## Intended environment and current validation

Run only in the disposable GitHub-hosted macOS acceptance job, with macOS 15 or newer and an Xcode 16 or newer SDK. The helper requires the normal GitHub Actions variables GITHUB_ACTIONS=true, RUNNER_ENVIRONMENT=github-hosted, and RUNNER_OS=macOS. It refuses local and self-hosted execution so it cannot accidentally record the developer's current desktop.

This source was authored from Apple's documented APIs. It has not been compiled or executed during authoring. Compilation, capture permission, final movie readability, and audible VoiceOver speech must be verified on the actual runner. A completed lifecycle is a recorder result, not an accessibility test pass.

## Compile on the runner

From the repository root:

    xcrun swiftc -swift-version 5 -parse-as-library \
      -target "$(uname -m)-apple-macos15.0" \
      -framework Foundation -framework AVFoundation \
      -framework CoreGraphics -framework CoreMedia -framework ScreenCaptureKit \
      orqelon-lab/hhs355/ScreenRecorder.swift \
      -o "$RUNNER_TEMP/hhs355-screen-recorder"

Swift 5 language mode avoids making Swift 6 strict-concurrency migration part of this test. The target explicitly uses the runner's architecture and macOS 15 deployment baseline. The source also gates the macOS 15-only recording APIs with availability checks. A suitable macOS SDK is still required at compile time.

## Four positional arguments

    "$RUNNER_TEMP/hhs355-screen-recorder" \
      "$RUNNER_TEMP/hhs355-evidence/voiceover-safari.mov" \
      "$RUNNER_TEMP/hhs355-evidence/lifecycle.json" \
      "$RUNNER_TEMP/hhs355-evidence/recorder.ready" \
      "$RUNNER_TEMP/hhs355-evidence/recorder.stop"

All four paths must be distinct and absent at startup. This prevents stale ready or stop files, overwriting previous evidence, and accidentally reusing a previous recording. Parent directories are created as needed.

The harness must launch the helper as a background process, monitor its exit status, and wait for the ready file before starting the acceptance actions. READY is written to the ready file and standard output only from recordingOutputDidStartRecording. Process creation, successful compilation, and return from startCapture are not the ready signal.

When the acceptance sequence finishes or fails, the harness creates the stop file and waits for the recorder process. Creating that file alone does not establish a valid movie. Upload the lifecycle, recorder stdout/stderr, movie if present, and independent acceptance evidence even when either process fails.

Do not remove or ignore a nonzero recorder exit code. Do not rely on the persistent ready file to infer that a previously started recorder is still alive.

## Capture and completion contract

- The entire primary display is selected, including Safari, the VoiceOver caption panel, native focus indicators, and relevant dialogs. If ScreenCaptureKit does not list the primary display, the first listed display by numeric identifier is selected. Its identifier, dimensions, and the number of available displays are logged.
- The output uses MOV and H.264, checked against the available file types and codecs. System audio is requested, current-process audio is not excluded, and microphone capture is explicitly disabled.
- The helper retains the stream, recording output, and their delegate state. Delegate access to mutable state is synchronized.
- The helper requests an orderly stop when the stop file appears, or when recording reaches 240 seconds. Reaching the limit is a failure even if a movie is finalized.
- Startup is bounded to 45 seconds. Stop and finalization each have a 20-second deadline. A separate dispatch watchdog can terminate an OS call that never returns. Cleanup after a failure is also bounded.
- A hung OS stop call can prevent exact media-duration enforcement. The watchdog then exits unsuccessfully; any resulting file is incomplete evidence. Successful recording is never inferred from that forced termination.
- Completion requires recordingOutputDidFinishRecording, no recorded stream or output error, and a nonempty finalized file. The helper then exits zero. All other outcomes exit nonzero.

The lifecycle is one JSON object, rewritten atomically after events. Its status progresses through initializing, starting, recording, stopping, finalizing, and completed. Any failure preserves status=failed and the first error, with subsequent errors retained in the event history. Timestamps include UTC wall time and monotonic process uptime.

## Privacy permission and evidence boundaries

The helper does not request privacy permission, edit TCC databases, disable protections, change system settings, or install audio drivers. CGPreflightScreenCaptureAccess is logged as a diagnostic, and actual ScreenCaptureKit access is attempted. If permission is unavailable, the real API can fail or wait for a system permission prompt; the deadline makes that a failed run.

Run the recording in a clean ephemeral job that displays only the public candidate and test materials. This helper is deliberately a full-display recorder, so private browser profiles, signed-in personal apps, and unrelated windows do not belong in that job.

System audio capture requests do not prove audible speech. Independently inspect movie duration and video/audio tracks, play the movie, and confirm that actual VoiceOver speaks during the tested actions. Keep audioVerification explicitly unverified until that review succeeds. A caption panel, a phrase log, a nonempty movie, or an audio track containing silence cannot close the spoken-recording requirement.

## Primary API references

- [Apple: Capturing screen content in macOS](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)
- [Apple: SCRecordingOutput](https://developer.apple.com/documentation/screencapturekit/screcordingoutput)
- [Apple: SCRecordingOutputConfiguration](https://developer.apple.com/documentation/screencapturekit/screcordingoutputconfiguration)
- [Apple: SCRecordingOutputDelegate](https://developer.apple.com/documentation/screencapturekit/screcordingoutputdelegate)
- [Apple: SCStreamDelegate](https://developer.apple.com/documentation/screencapturekit/scstreamdelegate)
- [Apple: capturesAudio](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/capturesaudio)
- [Apple: ScreenCaptureKit recording example, WWDC24](https://developer.apple.com/videos/play/wwdc2024/10088/)
- [GitHub: default environment variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables)
