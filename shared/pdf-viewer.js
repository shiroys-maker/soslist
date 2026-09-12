// PDF bytes stay between Firebase Storage and this app; the renderer is bundled locally.
(() => {
    const assetBase = new URL('vendor/pdfjs/', document.currentScript.src).href;
    const dialog = document.createElement('dialog');
    dialog.className = 'pdf-dialog';
    dialog.setAttribute('aria-labelledby', 'pdfDialogTitle');
    dialog.innerHTML = `
        <header class="pdf-header"><h2 id="pdfDialogTitle">PDF</h2><div class="pdf-header-actions"><button type="button" class="pdf-print">印刷</button><button type="button" class="pdf-close">閉じる</button></div></header>
        <div class="pdf-toolbar" aria-label="PDF操作">
            <button type="button" class="pdf-prev" aria-label="前のページ">◀</button>
            <span class="pdf-page-count" aria-live="polite"></span>
            <button type="button" class="pdf-next" aria-label="次のページ">▶</button>
            <button type="button" class="pdf-minus" aria-label="PDFを縮小">−</button>
            <button type="button" class="pdf-fit">幅に合わせる</button>
            <button type="button" class="pdf-plus" aria-label="PDFを拡大">＋</button>
        </div>
        <p class="pdf-status" role="status"></p>
        <div class="pdf-viewport" tabindex="0" aria-label="PDFページ"></div>`;
    document.body.append(dialog);
    const find = selector => dialog.querySelector(selector);
    const viewport = find('.pdf-viewport'), status = find('.pdf-status');
    const prev = find('.pdf-prev'), next = find('.pdf-next');
    const minus = find('.pdf-minus'), plus = find('.pdf-plus'), fit = find('.pdf-fit');
    const printButton = find('.pdf-print');
    // WKWebView uses a separate native print path; this control is for Cloud browsers.
    printButton.hidden = !!window.webkit?.messageHandlers?.loadPdfBytes;
    let printJob;
    let enginePromise, readyPromise, warmupScheduled = false;
    let loadingTask, pdf, renderTask, opener, downloadRequest, nativeDownload;
    let session = 0, rendering = 0, pageNumber = 1, zoom = 1, resizeTimer;

    function engine() {
        if (!enginePromise) enginePromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = assetBase + 'pdf-engine.js';
            script.onload = () => resolve(window.sosPdfEngine);
            script.onerror = () => { script.remove(); enginePromise = null; reject(new Error('PDF表示機能を読み込めませんでした。もう一度お試しください。')); };
            document.head.append(script);
        });
        return enginePromise;
    }
    function prepare() {
        if (!readyPromise) readyPromise = engine().then(async lib => {
            const worker = lib.PDFWorker.create({ verbosity: 0 });
            try { await worker.promise; }
            catch (error) { worker.destroy(); throw error; }
            return { lib, worker };
        }).catch(error => { readyPromise = null; throw error; });
        return readyPromise;
    }
    function warmup() {
        if (warmupScheduled) return;
        warmupScheduled = true;
        // Prepare only the bundled renderer. Never prefetch appointment PDFs.
        const run = () => prepare().catch(() => { warmupScheduled = false; });
        if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 1000 });
        else setTimeout(run, 0);
    }
    function download(url) {
        const native = window.webkit?.messageHandlers?.loadPdfBytes;
        if (native) return new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            nativeDownload = { requestId, resolve, reject };
            native.postMessage({ requestId, url });
        });
        // Passing bytes keeps PDF.js from issuing separate cross-origin range fetches.
        return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            downloadRequest = request;
            request.open('GET', url);
            request.responseType = 'arraybuffer';
            request.timeout = 60000;
            request.onload = () => {
                if (downloadRequest === request) downloadRequest = null;
                if (request.status >= 200 && request.status < 300 && request.response?.byteLength) resolve(new Uint8Array(request.response));
                else reject(new Error('PDF download failed'));
            };
            request.onerror = request.ontimeout = request.onabort = () => reject(new Error('PDF download interrupted'));
            request.send();
        });
    }
    window.sosPdfNativeResult = ({ requestId, data, error }) => {
        if (!nativeDownload || nativeDownload.requestId !== requestId) return;
        const pending = nativeDownload; nativeDownload = null;
        if (error) { pending.reject(new Error('PDF download failed')); return; }
        try { pending.resolve(Uint8Array.from(atob(data), character => character.charCodeAt(0))); }
        catch (error) { pending.reject(error); }
    };
    function controls() {
        const busy = !pdf || !!printJob;
        prev.disabled = busy || pageNumber <= 1;
        next.disabled = busy || pageNumber >= pdf.numPages;
        minus.disabled = busy || zoom <= 0.5;
        plus.disabled = busy || zoom >= 3;
        fit.disabled = busy;
        printButton.disabled = busy;
        find('.pdf-page-count').textContent = pdf ? `${pageNumber} / ${pdf.numPages}` : '— / —';
    }
    function release() {
        session++; rendering++;
        clearPrint();
        clearTimeout(resizeTimer);
        downloadRequest?.abort(); downloadRequest = null;
        if (nativeDownload) {
            window.webkit?.messageHandlers?.cancelPdfDownload?.postMessage({ requestId: nativeDownload.requestId });
            nativeDownload.reject(new Error('PDF download cancelled')); nativeDownload = null;
        }
        renderTask?.cancel(); renderTask = null;
        const oldTask = loadingTask;
        loadingTask = null; pdf = null;
        if (oldTask) oldTask.destroy().catch(() => {});
        viewport.replaceChildren();
        status.textContent = '';
        controls();
    }
    function clearPrint() {
        if (!printJob) return;
        printJob.renderTask?.cancel();
        printJob.frame.remove();
        printJob.urls.forEach(url => URL.revokeObjectURL(url));
        printJob = null;
    }
    async function print() {
        if (!pdf || printJob) return;
        const current = session, documentToPrint = pdf;
        const frame = document.createElement('iframe');
        frame.className = 'pdf-print-frame';
        frame.title = 'PDF印刷';
        dialog.append(frame);
        const job = printJob = { frame, urls: [], renderTask: null };
        controls();
        const active = () => session === current && printJob === job;
        try {
            const printDocument = frame.contentDocument;
            printDocument.open();
            printDocument.write('<!doctype html><html><head><title>PDF</title><style>html,body{margin:0;padding:0}img{display:block;width:100%;height:100%}.page{break-after:page;overflow:hidden}.page:last-child{break-after:auto}@page{margin:0}</style></head><body></body></html>');
            printDocument.close();
            for (let number = 1; number <= documentToPrint.numPages; number++) {
                status.textContent = `印刷を準備しています… ${number} / ${documentToPrint.numPages}`;
                const page = await documentToPrint.getPage(number);
                if (!active()) return;
                const size = page.getViewport({ scale: 1 });
                const scale = Math.min(150 / 72, Math.sqrt(12000000 / (size.width * size.height)));
                const canvas = document.createElement('canvas');
                const view = page.getViewport({ scale });
                canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
                job.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: view, intent: 'print', background: 'white' });
                await job.renderTask.promise;
                job.renderTask = null;
                if (!active()) return;
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                canvas.width = canvas.height = 0;
                if (!active()) return;
                if (!blob) throw new Error('Print page failed');
                const url = URL.createObjectURL(blob); job.urls.push(url);
                const style = printDocument.createElement('style');
                style.textContent = `@page pdf${number}{size:${size.width}pt ${size.height}pt}`;
                printDocument.head.append(style);
                const sheet = printDocument.createElement('div');
                sheet.className = 'page';
                sheet.style.cssText = `page:pdf${number};width:${size.width}pt;height:${size.height}pt`;
                const img = printDocument.createElement('img');
                img.src = url; sheet.append(img); printDocument.body.append(sheet);
                await img.decode();
                if (!active()) return;
            }
            status.textContent = '';
            frame.contentWindow.addEventListener('afterprint', () => {
                if (!active()) return;
                setTimeout(() => {
                    if (!active()) return;
                    clearPrint(); controls(); printButton.focus();
                }, 0);
            }, { once: true });
            frame.contentWindow.focus();
            frame.contentWindow.print();
        } catch (error) {
            if (!active()) return;
            clearPrint(); controls();
            status.textContent = '印刷の準備に失敗しました。もう一度「印刷」を押してください。';
        }
    }
    function close() {
        release();
        if (dialog.open) dialog.close();
        document.body.classList.remove('pdf-open');
        if (opener?.isConnected) opener.focus({ preventScroll: true });
    }
    async function render() {
        if (!pdf || !dialog.open) return;
        const currentSession = session, currentRender = ++rendering;
        renderTask?.cancel(); renderTask = null;
        viewport.replaceChildren();
        status.textContent = 'ページを表示しています…';
        controls();
        try {
            const page = await pdf.getPage(pageNumber);
            if (currentSession !== session || currentRender !== rendering) return;
            const natural = page.getViewport({ scale: 1 });
            const scale = Math.max(0.1, (viewport.clientWidth - 16) / natural.width) * zoom;
            const size = page.getViewport({ scale });
            // Keep zoom sharp while bounding the canvas allocation on mobile devices.
            const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12000000 / (size.width * size.height)));
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(size.width * ratio); canvas.height = Math.ceil(size.height * ratio);
            canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`;
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', `PDF ${pageNumber}ページ`);
            const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: size, transform: [ratio, 0, 0, ratio, 0, 0] });
            renderTask = task;
            await task.promise;
            if (currentSession !== session || currentRender !== rendering) return;
            renderTask = null;
            viewport.replaceChildren(canvas); viewport.scrollTop = 0; viewport.scrollLeft = 0;
            status.textContent = '';
        } catch (error) {
            if (currentSession !== session || currentRender !== rendering || error.name === 'RenderingCancelledException') return;
            status.textContent = 'このページを表示できませんでした。ページを切り替えるか、PDFを開き直してください。';
        }
    }
    async function open(resolveSource) {
        const nextOpener = document.activeElement;
        release(); opener = nextOpener;
        const current = session;
        pageNumber = 1; zoom = 1;
        if (!dialog.open) dialog.showModal();
        document.body.classList.add('pdf-open');
        find('.pdf-close').focus();
        status.textContent = 'PDFを読み込んでいます…';
        const started = performance.now(), timings = {};
        delete dialog.dataset.loadTimings;
        try {
            // Download immediately after resolving the source, even on a cold renderer.
            const [{ lib, worker }, data] = await Promise.all([
                prepare().then(ready => { timings.rendererReady = Math.round(performance.now() - started); return ready; }),
                (async () => {
                    const url = await resolveSource();
                    if (current !== session || !dialog.open) return;
                    timings.sourceReady = Math.round(performance.now() - started);
                    status.textContent = 'PDFを取得しています…';
                    const bytes = await download(url);
                    timings.downloaded = Math.round(performance.now() - started);
                    return bytes;
                })()
            ]);
            if (current !== session || !dialog.open) return;
            status.textContent = 'PDFを表示しています…';
            loadingTask = lib.getDocument({ data, worker, cMapUrl: assetBase + 'cmaps/', standardFontDataUrl: assetBase + 'standard_fonts/',
                wasmUrl: assetBase + 'wasm/', iccUrl: assetBase + 'iccs/', useWorkerFetch: false, isEvalSupported: false, verbosity: 0 });
            const loaded = await loadingTask.promise;
            if (current !== session || !dialog.open) return;
            pdf = loaded;
            timings.parsed = Math.round(performance.now() - started);
            await render();
            if (current === session && dialog.open) {
                timings.displayed = Math.round(performance.now() - started);
                // Numeric diagnostics only: no document identifiers, URLs or PDF contents.
                dialog.dataset.loadTimings = JSON.stringify(timings);
            }
        } catch (error) {
            if (current !== session || !dialog.open) return;
            release();
            status.textContent = error.pdfSourceError ? error.message : 'PDFを表示できませんでした。通信状態を確認して、もう一度開いてください。';
            controls();
        }
    }
    find('.pdf-close').addEventListener('click', close);
    printButton.addEventListener('click', print);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    prev.addEventListener('click', () => { if (pdf && pageNumber > 1) { pageNumber--; render(); } });
    next.addEventListener('click', () => { if (pdf && pageNumber < pdf.numPages) { pageNumber++; render(); } });
    minus.addEventListener('click', () => { zoom = Math.max(0.5, zoom - 0.25); render(); });
    plus.addEventListener('click', () => { zoom = Math.min(3, zoom + 0.25); render(); });
    fit.addEventListener('click', () => { zoom = 1; render(); });
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        if (dialog.open) resizeTimer = setTimeout(render, 120);
    });
    window.sosPdfViewer = { open, close, warmup };
})();
