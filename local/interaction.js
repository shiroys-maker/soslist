// Local-only interaction policy. Opening an editor never waits for Firestore.
(() => {
    const pending = new Map();
    const label = document.createElement('div');
    label.id = 'interactionStatus';
    label.setAttribute('role', 'status');
    label.setAttribute('aria-live', 'polite');
    document.body.append(label);
    let clearTimer;
    function show(message) {
        clearTimeout(clearTimer);
        label.textContent = message;
        label.hidden = !message;
    }
    show('');
    function report() {
        if (pending.size) {
            show([...pending.values()].some(item => item.slow)
                ? '保存完了を確認できていません。通信回復を待っています。「再接続」を利用できます。重複送信を防ぐため保存は待機中です。'
                : '保存中…');
        }
    }
    window.sosInteraction = {
        async read(docId) {
            const data = displayedAppointments.get(docId);
            window.sosConnection?.check();
            // Keep the opening snapshot stable: later listener events only update the list.
            if (data) return { exists: true, data: () => data };
            // A details window may refer to a record outside the current list filter.
            // Only that fallback needs a server read; never leave it waiting forever.
            if (!pending.size) show('データを読み込んでいます…');
            let timer;
            try {
                const doc = await Promise.race([
                    db.collection('appointments').doc(docId).get({ source: 'server' }),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error('読み込みがタイムアウトしました。再接続後に開き直してください。')), 8000);
                    })
                ]);
                if (!doc.exists) throw new Error('予約が見つかりません。');
                if (!pending.size) show('');
                return doc;
            } catch (error) {
                if (!pending.size) show('データを取得できません。「再接続」後に開き直してください。');
                window.sosConnection?.check(true);
                throw error;
            } finally {
                clearTimeout(timer);
            }
        },
        isPending(key) { return pending.has(key); },
        async save(key, root, operation) {
            if (pending.has(key)) throw new Error('保存結果を確認中です。重複送信せずお待ちください。');
            const item = { slow: false };
            pending.set(key, item);
            const controls = root?.querySelectorAll ? [...root.querySelectorAll('button, input, textarea, select')] : root ? [root] : [];
            const states = controls.map(control => [control, control.disabled]);
            states.forEach(([control]) => { control.disabled = true; });
            root?.setAttribute?.('aria-busy', 'true');
            report();
            const timer = setTimeout(() => {
                item.slow = true;
                report();
                window.sosConnection?.check(true);
            }, 8000);
            try {
                // A timeout cannot cancel a Firestore write. Keep its lock until it settles.
                const result = await operation();
                show('保存しました。');
                return result;
            } catch (error) {
                show('保存できませんでした。入力内容を確認して、もう一度保存してください。');
                throw error;
            } finally {
                clearTimeout(timer);
                pending.delete(key);
                states.forEach(([control, disabled]) => { control.disabled = disabled; });
                root?.removeAttribute?.('aria-busy');
                if (pending.size) report();
                else clearTimer = setTimeout(() => show(''), 10000);
            }
        }
    };
    document.addEventListener('click', () => window.sosConnection?.check(), true);
    window.addEventListener('focus', () => window.sosConnection?.check());
})();
