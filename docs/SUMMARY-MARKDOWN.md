# Safe Summary Markdown (2026-10-15)

## Scope and cause

Local `local/script.js::openSummaryPopup` sends the chosen date to the native
`openSummaryWindow` bridge. The installed app starts
`~/Documents/GitHub/soslist/daily-brief/server.js` and loads its loopback
`/summary-popup`. Summary HTML is therefore external to the app bundle.
The previous inline renderer split content only at blank paragraphs, so adjacent
headings/lists were treated as plain paragraphs. It also had no link/table support.
Isolated simple headings and emphasis already worked; escaping was not the cause.
The cloud root `script.js` had a separate limited paragraph-based renderer.

Both now use `shared/summary-markdown.js` and locally vendored markdown-it 15.0.2.
The old regex renderers are replaced, while all generation, storage, mirroring,
audio and appointment/detail behavior is unchanged. The app baseline remains
86ae567 (native detail snapshots bypass the localStorage payload cache).

## Rendering and security contract

Headings, nested ordered/unordered lists, emphasis, links, tables, block quotes,
code fences, inline code, rules, line breaks and plain Japanese/English text are
supported. Raw HTML is escaped as literal text. Link destinations are limited to
absolute HTTP/HTTPS/mailto URLs; relative, protocol-relative, file, data and custom
schemes are inert. Links have `noopener noreferrer` and no-referrer policy.
Markdown images become selectable alt text; no image element, request or automatic
external resource is produced. The popup CSP also disables images, objects and
frames, and limits fetch/media to its own origin. Its asset route is an explicit
three-file allowlist; unreadable assets return a safe 404 so the text fallback
can still run without terminating the server. No patient content is sent to a renderer service or AI.

The popup has a read-only source toggle and explicit source-copy button. The button
copies the original response string, including CRLF. Clipboard denial shows and
selects the source for the user's normal keyboard copy (textarea selection uses the
browser's normal LF representation). Rendered content remains selectable. If the
parser is unavailable, escaped plain text is rendered; if all renderer assets fail,
textContent with preserved whitespace is used.

The existing `/api/brief-status` background Firestore mirroring and audio routes
are untouched. Synthetic verification stubs the data provider and mirroring, so it
never reads patient outputs, calls the live API or writes Firestore.

## Verification

```sh
node --test local/tests/*.test.cjs local/ai/*.test.cjs local/qtc-tools/*.test.cjs tests/*.test.cjs daily-brief/tests/*.test.cjs
PLAYWRIGHT_MODULE=/path/to/playwright-core node tests/summary-markdown.browser.cjs
swiftc -module-cache-path /tmp/sos-summary-swift-cache tests/summary-markdown-wk.swift -o /tmp/summary-markdown-wk
PLAYWRIGHT_MODULE=/path/to/playwright-core SUMMARY_WK_RUNNER=/tmp/summary-markdown-wk node tests/summary-markdown.browser.cjs
```

The browser runner creates its own ephemeral loopback server with synthetic-only
Summary records. It blocks all external requests and uses a fake clipboard to
preserve the user's clipboard. It covers desktop/mobile layout, HTML/URL/image XSS,
original copying and denial fallback, selection, 215,012-character content, exact
asset delivery, cloud renderer parity, and native detail rendering/edit/save with
a deliberately unavailable localStorage payload cache. The Swift runner uses an
independent nonpersistent WKWebView with no app launch/startup tasks.

## Book local application

Fast-forward the reviewed commit onto Book's source after confirming its baseline
is 86ae567 and in-scope files have no user modifications. Preserve all untracked
files. No app replacement, restart, window reload, patient-file operation or
configuration change is needed: next Summary server startup reads the new source.
The installed app stays 86ae567 and retains its exact binary/resources.

If a Summary server/window is currently open, leave it and all editors alone.
After the user closes the Summary window normally, the app's existing server
lifecycle will use the new source on the next open. A separately managed persistent
server would need its normal restart when idle. Do not terminate it to force update.

For rollback, restore the three prior tracked presentation files with
`git restore --source=86ae567 -- daily-brief/server.js index.html script.js .github/workflows/pages.yml`
and leave the now-unused shared assets in place. This does not change generated
Summaries, app data, DBQ Processor, or the installed app.

## Prepared cloud change; no publication

Root `index.html` and `script.js` use the same renderer, scoped style and versioned
asset URLs. `.github/workflows/pages.yml` now copies both new shared assets into
the site. The vendor directory was already copied. There is no Firebase/schema/
patient-data change. Push to main triggers GitHub Pages publication, so do not
push or run the deployment workflow without explicit publication authorization.
