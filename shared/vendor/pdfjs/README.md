# Bundled PDF.js

PDF.js 6.3.289, Apache-2.0 (see LICENSE), from the official pdfjs-dist npm package.
The legacy build and its WorkerMessageHandler are bundled as a classic script so
SOSList Local's file:// WebView can use the same renderer as Cloud. The renderer
loads only when a PDF is opened. No third-party viewer receives a PDF URL or data.
cmaps, standard_fonts, wasm, and iccs are copied unmodified from that package;
their included license files are retained.

Rebuild with pdfjs-dist@6.3.289 and esbuild@0.28.2 installed in a temporary npm
project. Copy engine-entry.mjs there as engine.mjs, then run from that project:

```
./node_modules/.bin/esbuild engine.mjs --bundle --format=iife --platform=browser --target=safari16 --minify --outfile=pdf-engine.js '--external:node:*' --external:fs --external:canvas
```

Copy pdf-engine.js and the four resource directories into this directory.
