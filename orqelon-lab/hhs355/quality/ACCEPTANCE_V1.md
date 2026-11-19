# HHS #355 — native Safari / VoiceOver acceptance V1

**Frozen before the new Guidepup harness is implemented.** This covers the API documentation route on baseline `c47a82ba014b9ff449a91e7a8e13c7659747a872` and candidate `c66cd3bda6923ae276676f96eae072e39a2d2752`. The companion JSON contains the fixed assertions and evidence gates.

## Independence and ownership

The author previously read the existing pinned product and Chromium checker during the repository audit. No new Guidepup harness has been inspected or executed. This is independent of that new harness, **not a product-blind holdout**. Root alone implements, runs, builds, changes Git and preserves execution receipts. The author owns only this document and `acceptance-v1.json`.

## Fixed environment and navigation

Use the specified `macos-15` runner, Node 22.23.4, pnpm 11.20.0, Guidepup 0.40.0 and setup 0.29.3. Record actual OS, architecture, runner image, Safari and VoiceOver versions. Test actual native Safari with VoiceOver.

Use real keyboard/VoiceOver input. Read-only DOM snapshots may measure focus, geometry, values and readiness. Choose ordinary Tab or documented Option+Tab for initial Skip reach **before the baseline**, record Safari's tab preference and Quick Nav state, and keep the choice identical on the candidate. Navigation is bounded to 40 keys per target. No JavaScript focus, clicks, value assignment, direct rendering or injected repair is allowed.

## Seven cases, unchanged between refs

| ID | Required observation |
| --- | --- |
| VO355-01 | Reach visible Skip to content with native keyboard focus. |
| VO355-02 | Enter transfers focus to `h1#_top` inside main; fresh VO-F4 identifies the OpenAPI docs heading. |
| VO355-03 | After a measured minimum 15 seconds, focus remains on that heading and it remains visible below the header; collect a **new** VO-F4 report after the wait. |
| VO355-04 | The next ordinary Tab reaches API Version; fresh focus speech identifies the control and selection. |
| VO355-05 | Native keyboard reaches Server; fresh focus speech identifies its purpose and `/api/v0.5.0`. |
| VO355-06 | Native keyboard changes API Version to 0.4.0; selected value, URL, rendered version and Server value establish the redraw. |
| VO355-07 | Native keyboard reaches the redrawn Server; fresh focus speech still identifies its purpose and `/api/v0.4.0`. |

Preserve each speech capture's new-event offsets or timestamps and the complete raw session log. An earlier utterance cannot satisfy a later checkpoint. Ambiguous speech stays unverified; DOM values cannot be promoted into words supposedly spoken.

## Recording and audio are separate gates

Retain an actual screen recording of native Safari and the sequence. Verify real frames at the checkpoints and the media metadata. Speech logs or synthesized videos do not replace the recording. Separate native clips may be used only with their session/build identities disclosed.

Capture actual VoiceOver system audio. Presence of an audio stream or nonzero signal does not establish its words. An identified capable reviewer/tool must separately verify the relevant recorded utterances with timestamps before audio content is claimed verified. `spokenPhraseLog()` establishes captured reader speech text within its actual method; it is not a listening session. Without separate audio verification, full recording acceptance remains **INCOMPLETE**, even when functional assertions pass.

## Results and preservation

Record the acceptance/harness hashes, source and lock hashes, actual served-build inventory/hash, clean or dirty source state, versions, preferences, native inputs, read-only snapshots, fresh speech, media hashes, all results and shutdown status.

Preserve every attempt. Installation, GUI, permissions, recorder or harness failures are distinguished from observed product failures; do not invent FIRST RED or silently turn a timeout into a specific cause. Do not erase a failed case when later diagnostic steps run. Any correction after execution requires an additive version and explanation, leaving V1 and its results intact.

This is one API route on macOS. It does not refresh all 181 routes or relabel old Windows/NVDA recordings as current-build sessions. No automatic Ready, merge, deployment or external message follows from a test result.

