# PDF downloads from the Cloud app

The PDF modal downloads bytes directly from Firebase Storage. The browser origin
must be present in the bucket's CORS configuration. Storage authentication/rules
are separate and must not be loosened to fix CORS.

`storage.cors.json` preserves the existing GitHub Pages entry and adds GET/HEAD
for `https://soslist.niraissc.jp`. Applied and read back on 2026-09-13.

Inspect the live configuration before applying future changes so other entries
are preserved:

```sh
gcloud storage buckets describe gs://sos-list-4d150.firebasestorage.app --format='json(cors_config)'
gcloud storage buckets update gs://sos-list-4d150.firebasestorage.app --cors-file=storage.cors.json
```

GitHub Pages deployment does not apply bucket settings. Verify an actual PDF in
the authenticated production app after changing CORS; an error response for a
nonexistent object is not sufficient to validate download response headers.
