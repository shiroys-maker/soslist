# Memo → Claim Evidence Review → Summary

Manual and scheduled Summary use the same initial `summary` task settings snapshot. The selected service/model/effort is used to summarize each nonempty appointment memo into an English narrative, then to generate the Summary and Podcast. There is no model-version override.

`daily-brief/evidence-review.cjs` owns a section after the original claim list, with one blank line and `## Evidence Review`. Start/end markers and a SHA256 seal identify the managed body. Original notes, claim text and following manual sections remain intact. An unmarked review, multiple/broken boundaries or a changed sealed body is a conflict; the app stops without silently replacing it. Empty notes do not create fabricated review text.

All AI calls run outside Firestore transactions. After every summary succeeds, one transaction compares original notes, claimDetail and contract number for every appointment, then updates only changed claimDetail fields. AI failure or a transaction conflict leaves the original fields untouched. Independent readback checks the saved Claim detail, notes and contract before a downstream prompt is returned. A readback failure stops downstream generation; an already committed write remains saved and is not rolled back over a concurrent editor.

The downstream appointment JSON excludes `notes`. Its clinical narrative source is claimDetail, including the saved review. Existing Claim-Gen/Claim-Aud export already copies this field verbatim; it needs no separate exporter change. Claude and Codex note-generation processes use the saved model with tools disabled, a temporary directory, bounded output and timeout. No production CLI/model/Firestore call is part of fixture tests.

Summary finalize-only and already-completed scheduled skips retain their existing behavior. Existing Summary/Podcast files are not removed by failed preprocessing. Per-day atomic transactions currently have an explicit 400-appointment preflight limit.
