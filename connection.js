// Web/mobile viewer connection recovery. Logs contain no appointment data or error messages.
(() => {
    let connectionState = "";
    const key = 'soslist-connection-log-v1';
    let logs = [];
    try { logs = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
    if (!Array.isArray(logs)) logs = [];
    let active = false, generation = 0, authGeneration = 0;
    let deadline, retryTimer, attempts = 0, lastSuccess = null;
    const clearTimers = () => { clearTimeout(deadline); clearTimeout(retryTimer); deadline = null; retryTimer = null; };
    function log(event, code = '') {
        logs.push({ time: new Date().toISOString(), event, code });
        logs = logs.slice(-200);
        try { localStorage.setItem(key, JSON.stringify(logs)); } catch (_) {}
    }
    function setStatus(message) {
        connectionState = message + (lastSuccess ? `（最終受信 ${lastSuccess.toLocaleTimeString('ja-JP')}）` : '');
    }
    function retry(reason, code = '') {
        clearTimers();
        log(reason, code);
        if (!active) return;
        if (['permission-denied', 'unauthenticated', 'failed-precondition', 'invalid-argument'].includes(code)) {
            setStatus(`読み込みエラー: ${code}。ログイン状態を確認して再接続してください。`);
            return;
        }
        if (!navigator.onLine) { setStatus('オフラインです。接続の復帰を待っています。'); return; }
        // With no manual controls, continue at a low rate after the initial retries.
        const delay = attempts >= 5 ? 60000 : 1000 * 2 ** attempts++;
        setStatus(`接続を確認しています。${delay / 1000}秒後に再試行します。`);
        retryTimer = setTimeout(() => { if (active) setupRealtimeListener(); }, delay);
    }
    function reconnect() {
        if (!active) return;
        attempts = 0;
        log('manual-or-resume-reconnect');
        setupRealtimeListener();
    }
    window.sosConnection = {
        get status() { return connectionState; },
        begin() {
            clearTimers();
            const token = ++generation;
            setStatus('予約を読み込んでいます…');
            log('listen-start');
            deadline = setTimeout(() => retry('listen-timeout'), 15000);
            return token;
        },
        snapshot(token, snapshot) {
            if (!active || token !== generation) return false;
            if (snapshot.metadata.fromCache) {
                setStatus('保存済みデータを表示中です。サーバーへの接続を確認しています…');
                // A cache event after a live connection also needs a bounded recovery window.
                if (!deadline) deadline = setTimeout(() => retry('cache-timeout'), 15000);
            } else {
                clearTimers(); deadline = null;
                attempts = 0; lastSuccess = new Date();
                setStatus('接続済み'); log('server-snapshot');
            }
            return true;
        },
        error(token, error) {
            if (active && token === generation) retry('listen-error', error.code || 'unknown');
        },
        async start() {
            active = true; attempts = 0;
            const session = ++authGeneration;
            const initialDate = formatDateInputValue(new Date());
            dateFilter.value = initialDate;
            setStatus('開始日を確認しています…'); log('startup');
            let timer;
            try {
                const result = await Promise.race([
                    db.collection('appointments').where('appointmentDateTime', '<', new Date(`${initialDate}T00:00:00+09:00`))
                        .orderBy('appointmentDateTime', 'desc').limit(1).get(),
                    new Promise((_, reject) => { timer = setTimeout(() => reject({ code: 'startup-timeout' }), 8000); })
                ]);
                if (!active || session !== authGeneration) return;
                if (!result.empty && dateFilter.value === initialDate) {
                    const date = getCorrectedAppointmentDate(result.docs[0].data());
                    if (date) dateFilter.value = formatDateInTokyo(date);
                }
            } catch (error) { log('startup-fallback', error.code || 'unknown'); }
            finally { clearTimeout(timer); }
            if (active && session === authGeneration) setupRealtimeListener();
        },
        stop() { active = false; generation++; authGeneration++; clearTimers(); log('logout'); }
    };
    window.addEventListener('offline', () => { if (active) { clearTimers(); deadline = null; setStatus('オフラインです。接続の復帰を待っています。'); log('offline'); } });
    window.addEventListener('online', reconnect);
    window.addEventListener('pageshow', (event) => { if (event.persisted) reconnect(); });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && active && (!lastSuccess || Date.now() - lastSuccess.getTime() > 60000)) reconnect();
    });
})();
