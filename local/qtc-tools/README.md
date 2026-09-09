# Local XR Codex Integration

The local XR/CD page posts all uploaded images to `/api/xray-report` on
`127.0.0.1:19876`. The handler calls `codex exec` with every image attached,
ChatGPT authentication, an ephemeral session, read-only sandbox, and a JSON
schema for Findings and Impression. It does not use an OpenAI API key or fall
back to the API. Images are still processed by OpenAI through Codex.

Default model: `gpt-5.6-sol`, reasoning effort `high`. Optional server environment
overrides: `XRAY_CODEX_MODEL`, `XRAY_CODEX_BIN`. Limits: 12 images, 80 MiB request,
240 seconds per execution, two concurrent executions across report windows.
Temporary image and report files are removed on completion or failure.

Each drop/paste queues a new reading of all images accumulated at that point.
Only the newest requested reading updates the report; older replies cannot
overwrite it. Failed readings leave the existing report and show an error.

Install from this directory with `python3 install.py`, then restart the existing
launchd service with `launchctl kickstart -k gui/$(id -u)/com.va.sospdf.server`.
Reopen or reload the XR page. The installer keeps `.before-codex` backups of the
two existing runtime files and updates only the XR handler and upload flow.
The local QTC HTML contains existing credentials and is intentionally not copied
into Git. The installer and the two managed components are backed up through
the existing SOSList entry in `~/Projects/apps.tsv`.

Checks: `python3 -B -m unittest discover -s local/qtc-tools -p 'test_*.py'` and
`node --test local/qtc-tools/xray-upload.test.cjs` from the repository root.

Verified locally: six Python tests and three JavaScript tests, installed copies,
served upload script, and a live POST with two synthetic solid-color PNGs. Codex
returned a structured report identifying both attachments as non-radiographic
in about 11 seconds. This checks routing and image input, not clinical accuracy.
