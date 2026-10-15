# Summary Markdown Implementation Plan

**Goal:** Render existing Summary Markdown safely without changing generation, storage or patient data.
**Architecture:** Replace the two incomplete regex renderers with one locally vendored markdown-it adapter. Serve the same adapter and CSS from the loopback Summary server; cloud assets are prepared but not published.
**Tech stack:** Vanilla JavaScript, markdown-it 15.0.2, Node test runner, WKWebView.
**Spec:** Delegated user request in this task.

## Global constraints
- Preserve 86ae567 native details opening; do not touch DBQ Processor or patient files.
- HTML renders as literal text; only HTTP/HTTPS/mailto links; no automatic images or external services.
- Keep original source available for exact copying and readable plain text.
- Source work happens in this isolated clone; local installation must preserve any running editors.

## Review focus
- Encoded/control-character URLs, HTML/SVG/event handlers, reference links, image nesting.
- Long paragraphs, tables, nested lists, code, mixed Japanese and English.
- Original-source copy when clipboard access fails and rendered selection remains possible.
- Missing renderer degrades to text rather than executable content.
- Loopback and cloud use the same renderer without cloud publication.

### Task 1: Safe renderer and integrations
- [ ] Add a failing test through the actual generated popup script, using synthetic headings/lists/bold/links/tables.
- [ ] Vendor verified public package with license; add safe shared adapter and scoped CSS.
- [ ] Replace popup and cloud renderers; add plain-source/copy controls to popup with safe fallback.
- [ ] Run all Node suites and test ordinary markup, hostile URLs/HTML/images, source copying, long text and renderer failure.

### Task 2: Local delivery
- [ ] Test actual generated popup in an isolated browser/WKWebView with no patient services.
- [ ] Review final diff and preserve 86ae567 exact details behavior.
- [ ] Commit, apply only reviewed files to Book source, back up code through project management workflow.
- [ ] Because daily-brief server is external source, verify installed app remains 86ae567 and next Summary uses updated source without restarting app or discarding editors.
- [ ] Provide patch/bundle, rollback instructions and concise evidence; do not publish cloud.
