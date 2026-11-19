HHS issue #355 / PR #1403 — native Safari and VoiceOver recording

Original recording: native-voiceover-c66cd3b-20261118.mov
Bytes: 1358817
SHA-256: a2d8d26d058f7d3bdd449922c1b622e989b6506e35d4040ea1d930112344c2ae
Duration: 59.312563 seconds
Tested product: c66cd3bda6923ae276676f96eae072e39a2d2752
Baseline: c47a82ba014b9ff449a91e7a8e13c7659747a872
Harness: 1f815d8a104012d53aaa50248dd9986ec907ba69
Environment: GitHub-hosted ARM64 macOS 15.8.2 (24H232); Safari 27.2 (20625.2.8.18.4); native VoiceOver 10 (964.12.11).
The original movie contains screen video and system audio. Microphone capture was disabled.

Candidate functional cases: 7/7 PASS.
Candidate job: https://github.com/ahcrm-core/simpler-grants-protocol/actions/runs/44439490141/job/135276706416
Baseline job: https://github.com/ahcrm-core/simpler-grants-protocol/actions/runs/44439490141/job/135276706387
The baseline retained focus on Skip and failed the heading-focus assertions. The combined workflow remains red because the separate baseline job failed; the candidate job succeeded.

V4 reporting procedure: after the measured 15-second wait, one informational VO-F1 application summary is recorded separately, followed by at least six seconds with no input and a fresh VO-F4 report. Focus and geometry remain unchanged. Earlier F4-only missing-speech outcomes remain preserved.
Visible captions and numerical audio measurements are not a separate transcription. The owner reviewed this exact delivered movie and replied “الفيديو صحيح” (“the video is correct”). This is the owner's confirmation of this recording, not an itemized transcript or independent assistant listening. The raw automated reports retain their original pre-review INCOMPLETE media-acceptance state.

Public publication of this exact recording, including system audio, in ahcrm-core/simpler-grants-protocol and linking it in HHS PR1403 was explicitly approved by the owner before this branch was created.
This branch exists solely to preserve reviewer-accessible evidence. It is separate from the PR's product branch and does not alter the tested product or establish HHS acceptance.
