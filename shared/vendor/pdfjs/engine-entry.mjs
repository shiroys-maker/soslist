import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
// A bundled main-thread worker also works in the Local app's file:// WebView.
globalThis.pdfjsWorker = { WorkerMessageHandler };
globalThis.sosPdfEngine = pdfjsLib;
