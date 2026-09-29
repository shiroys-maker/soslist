# Evidence Review / DBQ Entry resilience

Approved design: the 2026-09-30 conversation's six-point proposal and request to implement it in SOSList and apply relevant parts to DBQ Processor.

## Constraints

- Existing ChatGPT login and authenticated Edge/SOSList only. No plaintext credentials, token extraction, forced ownership takeover, permission weakening, or new public service.
- Preserve model gpt-6-astra/high for SOSList; preserve DBQ settings and clinical workflows. No signature/submission.
- Distinguish terminal completion, saved-but-unverified values, incomplete drafts, interruption, and cleanup failure.
- Keep sensitive checkpoints in app-owned local storage, owner-only permissions, never Git/Dropbox. Diagnostic metadata must omit clinical text, credentials, full URLs, and raw tool bodies.
- Every restarted operation reacquires live UI and matches identity. Never blindly replay writes whose outcome is unknown.
- Record ownership before executing browser operations. Release only recorded own sessions. Abnormal shutdown retains the cleanup obligation; no new patient operation until recovery succeeds.
- Checkpoint recovery survives application restart and preserves the original queue, including the exact SHA appointment moved to Provider In Progress by this run.
- Normal in-scope clinical saves require full readback. Incomplete collection remains an app draft, not a completed clinical memo.

## Deliverables / implementation sequence

1. SOSList app-server transport: explicit account/tool readiness, event handling, interruption, bounded RPCs, own-session cleanup, crash recovery record; no free-running CLI lifecycle.
2. SOSList checkpoint store and host tools: validated appointment queue, verified source blocks/drafts, stage states and verification outcomes; atomic private files; explicit resume; final validation and deletion of completed clinical drafts.
3. SOSList UI/native integration: progress and last activity, error/recovery status, resume on restart, cooperative stop; supplied skill body and companion references, bounded recovery workflow.
4. DBQ independent adaptation: close failure-path cleanup gaps, keep exact session identity, persist cleanup obligations and batch progress tied to exact source hashes, resume uncertain writes with audit, diagnostics/stall handling and native state integration.
5. Verification: fault-injection transport/store tests; existing regression suites; native builds; real CUA synthetic tab acquisition/release/reacquisition. Install only tested builds, compare bundled sources, run codesign checks. Live clinical workflow must be explicitly reported separately from synthetic verification.
6. Commit each application and use Projects backup.sh; verify published bundle heads and hashes. Do not push public Web changes.

## Acceptance tests

- Normal finish, model failure, malformed output, duplicate/late events, stop during startup/tool call, app/server crash, cleanup timeout/failure.
- Second session can acquire a released test tab; an unrelated live owner is never displaced.
- App restart restores checkpoints and an unresolved cleanup blocks new work until resolved.
- Corrupt/mismatched checkpoint, changed clinical source, wrong document/contract/date/exam, and save acknowledgement loss never count as completion.
- Ownership conflicts stop immediately; repeat recoverable window failures have a maximum of two attempts; stalled tool calls time out and retain progress.
- Full original source provenance and reviewed coverage are retained, not just a paraphrase or success flag.

## Progress

- Baseline inspection: SOSList only has untracked .codex/; DBQ working tree clean. Existing source paths must remain stable. Work in existing checkouts on task branches; no source relocation.
- Prior DBQ lifecycle logic is a reference, not proof that every error path is safe; fail() currently terminates directly.

## Verified lifecycle finding and final design

The real installed CUA runtime was tested with a dedicated public example.com tab (no patient data). Calling `turn_ended` from a fresh maintenance runtime returned success but did not release the old tab. The browser implementation tracks turn callbacks in process-local memory, so that response was not proof of release.

The corrected implementation uses a persistent internal Codex thread while unfinished and resumes the original thread/session after host loss. A real `thread/resume` preserved session identity and reacquired the same test tab successfully. Normal cleanup in the original live runtime also allowed a separate new session to acquire the test tab. Both cases were confirmed by reading the Example Domain title and closing the dedicated test tab. The original deliberately stranded test tab from the failed maintenance experiment was left untouched; no unrelated session was taken over.

Final behavior:
- Private app checkpoints keep complete source excerpts, original queue/identity, coverage, drafts and verified readbacks.
- Failed/uncertain writes resume with live audit; completed intake is not blindly replayed.
- The old app-server process must be gone before recovery. Actual browser reacquisition is required before a recovered ownership obligation can be cleared.
- Interrupt acknowledgement alone is not enough: wait for the turn-completed event; otherwise retain ownership and terminate only the app's own process group.
- Retained fully verified results resume only history cleanup, without another clinical turn.
- Completion removes the app checkpoint after internal thread archive/delete and result persistence.
- A corrupt checkpoint, wrong identity, changed source, live foreign owner, missing session or unreadable state fails closed without credential fallbacks.

Validation logs are private temporary test artifacts, not patient evidence. Installed-app UI verification requires an unlocked Mac; the machine locked during the final UI check. No live patient record was edited during this implementation.
