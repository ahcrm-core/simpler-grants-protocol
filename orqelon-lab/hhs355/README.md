# HHS #355: native Safari and VoiceOver evidence

This isolated test branch prepares the hosted-macOS route suggested in
[Bryan Thompson's comment](https://github.com/HHS/simpler-grants-protocol/pull/1403#issuecomment-6994537911).
It adds test infrastructure only. The product under test is checked out separately at its exact commit.

## Inputs and scope

| Input | Frozen value |
| --- | --- |
| Baseline | `HHS/simpler-grants-protocol@c47a82ba014b9ff449a91e7a8e13c7659747a872` |
| Candidate | `ahcrm-core/simpler-grants-protocol@c66cd3bda6923ae276676f96eae072e39a2d2752` |
| Route | `/protocol/api-docs/?version=0.5.0` |
| Runner | GitHub-hosted `macos-15`; record the actual image and OS build |
| Node / pnpm | `22.23.4` / `11.20.0` |
| Guidepup / setup | `0.40.0` / `0.29.3` |
| Initial link-navigation key | Native `Option+Tab`, identical for both roles |
| Product build | Frozen pnpm lock; `pnpm --filter website run build` |

The seven cases in `quality/acceptance-v1.json` were frozen before this harness
was authored. The criteria author had previously inspected the existing product
and its Chromium checker. This is independence from the new harness, **not a
product-blind holdout**. The immutable acceptance SHA-256 is:

`4b8bb6f32bfeba87b43195691bae9df3f6a67dc54321316257d1a95d53660727`.

This is fresh evidence for one API-docs route on the actual installed Safari and
VoiceOver. It is not a new Windows/NVDA session, a test of all website routes, or
a complete accessibility audit. The old Windows clips retain their original
build/environment scope.

## Execution

The workflow `orqelon-voiceover-hhs355.yml` runs on pushes to the isolated branch
`test/355-voiceover-20261118`. Fork Actions may need to be enabled by the owner.
The optional `workflow_dispatch` entry is not evidence that GitHub has registered
the workflow on the default branch. No default-branch merge is required for a
push-triggered run.

The first run resolved the exact test-package pins into one npm lockfile. That
actual lock is now committed and verified by hash; one Linux job installs it and
uploads it unchanged. Both macOS jobs consume the same artifact with
`npm ci --ignore-scripts`. The first run's transitive resolution is an observed
input, not a claim that every transitive version was chosen earlier.

## Disclosed harness correction after run 1

[Run 44435363600](https://github.com/ahcrm-core/simpler-grants-protocol/actions/runs/44435363600)
is retained unchanged. Baseline timed out during per-character URL entry and
ran none of the seven cases. Candidate reached the real recording and first
two cases, then recorded an empty settled speech capture and failed later
navigation. These are incomplete results, not baseline FIRST RED or acceptance.

Tagged Guidepup 0.40.0 source shows that `perform()` activates VoiceOver before
its command, while `press()` can target Safari explicitly. The original harness
used `perform()` for VO-F4, followed by untargeted native keys. That measurement
side effect is consistent with navigation stalling after the first capture;
it is not enough evidence to call the stall a product regression.

Revision V2 sends the same native `Control+Option+F4` chord to Safari, targets
other native keys to Safari, and records the foreground process plus
`document.hasFocus()` around captures. It also extends only the URL-entry
preflight budget from 25 to 90 seconds, recording its measured duration. The
product refs, seven acceptance criteria, initial Option+Tab policy, 15-second
settle interval, native-only interaction, navigation bounds, and media gates
remain unchanged. No old run or empty phrase is reclassified as passing.

## Disclosed native-menu correction after run 2

[Run 44436512765](https://github.com/ahcrm-core/simpler-grants-protocol/actions/runs/44436512765)
retains candidate PASS results for cases 01, 02, 04 and 05. Case 03 remains
UNVERIFIED because its new F4 capture was empty. Cases 06 and 07 did not finish.
The baseline kept keyboard focus on Skip after Enter, reproducing the case-02
failure while Safari was frontmost and the document held focus.

The run-2 candidate log establishes that Space opened API Version, then the
attempt to activate Safari before ArrowDown timed out. ArrowDown was never
dispatched and Enter never ran. Revision V3 keeps Safari-targeted Space, then
sends native ArrowDown and Enter without a Safari activation or DOM query
between them. Observations resume after Enter. A failed menu sequence is
preserved, with bounded native Escape cleanup where the failed operation has
ended; a native-operation timeout remains fatal.

The F4-only reporting procedure and its empty-capture result policy are unchanged.
V3 does not supply earlier words, another VoiceOver command's words, or synthesized
speech to satisfy a missing F4 report. The settling-end event now stores the wait
duration as `waitElapsedMs`, preserving the separate session-relative `elapsedMs`.

## Disclosed reporting variation after run 3

[Run 44438496732](https://github.com/ahcrm-core/simpler-grants-protocol/actions/runs/44438496732)
retains candidate PASS results for cases 01, 02, 04, 05, 06 and 07. Version change
and the redrawn Server report therefore completed under V3. Case 03 still had
no fresh usable F4 phrase. The baseline again failed case 02 and case 03. These
original results remain unchanged; V4 is a separately identified procedure.

V4 adds a single native `Control+Option+F1` application-summary command **only**
at the settled-heading checkpoint, after the measured 15-second interval and
read-only confirmation that Safari already owns the focused document. This is
an informational command without activation, navigation, or focus routing.
Its actual phrases, offsets and timestamps are stored separately. A measured
six-second no-input interval follows; this interval is not itself proof of
audio silence. Read-only state must establish unchanged focus and geometry.
Then the fresh F4 report receives its own new offsets and is evaluated against
the original heading requirement. The next navigation remains ordinary Tab.

For attribution, the F1 segment must identify Safari without heading or
keyboard-focus language; the distinct F4 segment must affirmatively state
"has keyboard focus" and satisfy the original heading matcher. Missing,
ambiguous or negative language stays UNVERIFIED. F1 words cannot satisfy the
F4 assertion. Independent media review must still examine the actual quiet
boundary and recorded utterances. This procedure does not establish why the
prior F4-only checkpoint was silent and does not erase that outcome. Apple
documents F1 as application information and F4 as keyboard-focus information;
no undocumented timeout or reset mechanism is assumed.

The macOS job uses Guidepup's documented CI setup to configure screen-reader
automation on its ephemeral runner. That vendor setup can update TCC permissions.
Its output and the prior SIP status are retained. This repository supplies no
SIP-disabling command or custom TCC modification. An actual permission denial
or failed setup is retained as a failed prerequisite; it is not bypassed.
The custom recorder and test runner never edit TCC. They refuse execution outside
a GitHub-hosted macOS Actions environment.

Safari's ordinary developer preference for JavaScript from Apple Events enables
**read-only** observation of focus, geometry and rendered values. The test confirms
that observation works before cases begin. Native keys perform every tested
interaction: skip-link navigation, Enter, next Tab, select opening, arrow choice,
and Enter. There is no programmatic focus, synthetic DOM event, injected repair,
or direct version-value assignment.

The static server serves the existing `website/dist/client` bytes. It adds a
declared Content-Security-Policy to keep page subresources on loopback and prevent
remote analytics. Installation and product build still use the network. No mock
API operation is executed. The product output is inventoried before and after
the run; source status, source diff, lock hashes and actual build hashes are kept.
Generated metadata may make this new build differ from historical artifacts.

## Results and limits

`result.json` separates:

- **Functional status:** the seven frozen native cases. Ambiguous or missing
  fresh speech stays `UNVERIFIED`; absent cases stay `NOT_RUN`.
- **Recording process status:** whether ScreenCaptureKit reported completion
  and a nonempty original movie exists. This alone is not media acceptance.
- **Full acceptance:** remains `INCOMPLETE` until independent media review
  verifies the visible sequence and the actual recorded VoiceOver utterances.

The recorder requests real system audio with microphone capture disabled.
It does not turn speech logs into sound. Guidepup's speech log is action-driven
captured text, not a continuous audio transcript. Each speech checkpoint issues
a new VO-F4 report, records new log offsets, and retains the raw phrases. The
15-second checkpoint never reuses the pre-wait phrase.

The process may exit zero only if all seven functional cases pass, the recorder
completes, build bytes remain identical during the run, and no run/cleanup error
is observed. Even that exit does **not** assert full video/audio acceptance.
Baseline failures are retained. A missing GUI, denied permission, failed build,
silent audio, or harness error is not a verified product FIRST RED.

## Reviewing the original evidence

Preserve both role artifacts, including failed runs, before their short retention
expires. Keep the exact run URL, workflow commit, dependency lock and original
movie hashes. The workflow saves the actual served build too.

Review `events.jsonl`, `spoken-phrases.json`, the case observations and the recorder
lifecycle together. Inspect actual movie frames at the case times. Inspect video
and audio streams and duration with a media tool. Then a capable reviewer must
listen to or independently transcribe the original recorded utterances with
timestamps and identify the verification method. A non-silent audio stream by
itself does not establish what VoiceOver said.

Record independent media review in a separate signed/attributed result file;
never rewrite the raw run report to erase a failure or missing gate. Any harness
correction after execution receives its own commit and run. Acceptance V1 stays
unchanged. A baseline that cannot execute or does not expose a product failure
must be reported even if the candidate passes.

This branch does not mark PR #1403 Ready, request reviewers, send messages,
merge code, or deploy the website.

## References

- [Guidepup CI](https://www.guidepup.dev/docs/getting-started/ci-cd)
- [Guidepup setup 0.29.3](https://github.com/guidepup/setup/blob/0.29.3/README.md)
- [Guidepup VoiceOver API](https://www.guidepup.dev/docs/api/class-voiceover)
- [Apple VoiceOver orientation commands](https://www.apple.com/uk/voiceover/info/guide/_1124.html)
- [Safari developer settings](https://developer.apple.com/documentation/safari-developer-tools/developer-settings)
- [ScreenCaptureKit recorder contract](RECORDER.md)
