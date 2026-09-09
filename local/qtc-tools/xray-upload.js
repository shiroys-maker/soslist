/* Shared by the local QTC ImageReport page; no Firebase or patient metadata access. */
function createXrayUploader({ parseImages, toDataUrl, document, alert, loader }) {
    const uploadedFiles = [];
    let revision = 0;
    let queue = Promise.resolve();

    return async function handleImages(files) {
        const images = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (!images.length) {
            alert('画像ファイルをドロップしてください。');
            return;
        }
        if (uploadedFiles.length + images.length > 12) {
            alert('画像は最大12枚までです。');
            return;
        }
        uploadedFiles.push(...images);
        const snapshot = uploadedFiles.slice();
        const currentRevision = ++revision;
        loader.dataset.xrayBusy = 'true';
        loader.style.display = 'inline';

        // Keep previews in drop order even when FileReader completes out of order.
        const previews = images.map(file => {
            const image = document.createElement('img');
            image.className = 'xray-image';
            document.getElementById('img-container').insertBefore(image, document.getElementById('caption-box'));
            return toDataUrl(file).then(url => { image.src = url; });
        });
        // Handle early FileReader rejection while an earlier report is still running.
        const previewReady = Promise.all(previews).then(() => null, error => error);
        queue = queue.then(async () => {
            try {
                const previewError = await previewReady;
                if (previewError) throw previewError;
                const region = document.getElementById('out-region').innerText.trim() || 'CHEST XR';
                const report = await parseImages(snapshot, region);
                // An older report must not overwrite a newer set of uploaded images.
                if (currentRevision !== revision) return;
                if (typeof report?.findings !== 'string' || !report.findings.trim()
                    || typeof report?.impression !== 'string' || !report.impression.trim()) {
                    throw new Error('読影結果にFindingsまたはImpressionがありません。');
                }
                document.getElementById('out-findings').innerText = report.findings;
                document.getElementById('out-impression').innerText = report.impression;
            } catch (error) {
                if (currentRevision === revision) alert('画像解析エラー: ' + error.message);
            } finally {
                if (currentRevision === revision) {
                    loader.dataset.xrayBusy = 'false';
                    loader.style.display = 'none';
                }
            }
        });
        return queue;
    };
}
