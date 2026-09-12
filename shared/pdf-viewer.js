// PDF bytes stay between Firebase Storage and this app; the renderer is bundled locally.
(() => {
    const assetBase = new URL('vendor/pdfjs/', document.currentScript.src).href;
    const dialog = document.createElement('dialog');
    dialog.className = 'pdf-dialog';
    dialog.setAttribute('aria-labelledby', 'pdfDialogTitle');
    dialog.innerHTML = `
        <header class="pdf-header"><h2 id="pdfDialogTitle">PDF</h2><button type="button" class="pdf-close">閉じる</button></header>
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
    let enginePromise, loadingTask, pdf, renderTask, opener;
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
    function controls() {
        prev.disabled = !pdf || pageNumber <= 1;
        next.disabled = !pdf || pageNumber >= pdf.numPages;
        minus.disabled = !pdf || zoom <= 0.5;
        plus.disabled = !pdf || zoom >= 3;
        fit.disabled = !pdf;
        find('.pdf-page-count').textContent = pdf ? `${pageNumber} / ${pdf.numPages}` : '— / —';
    }
    function release() {
        session++; rendering++;
        clearTimeout(resizeTimer);
        renderTask?.cancel(); renderTask = null;
        const oldTask = loadingTask;
        loadingTask = null; pdf = null;
        if (oldTask) oldTask.destroy().catch(() => {});
        viewport.replaceChildren();
        status.textContent = '';
        controls();
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
        try {
            const [lib, url] = await Promise.all([engine(), resolveSource()]);
            if (current !== session || !dialog.open) return;
            loadingTask = lib.getDocument({ url, cMapUrl: assetBase + 'cmaps/', standardFontDataUrl: assetBase + 'standard_fonts/',
                wasmUrl: assetBase + 'wasm/', iccUrl: assetBase + 'iccs/', useWorkerFetch: false, isEvalSupported: false, verbosity: 0 });
            const loaded = await loadingTask.promise;
            if (current !== session || !dialog.open) return;
            pdf = loaded;
            await render();
        } catch (error) {
            if (current !== session || !dialog.open) return;
            status.textContent = error.pdfSourceError ? error.message : 'PDFを表示できませんでした。通信状態を確認して、もう一度開いてください。';
            controls();
        }
    }
    find('.pdf-close').addEventListener('click', close);
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
    window.sosPdfViewer = { open, close };
})();
