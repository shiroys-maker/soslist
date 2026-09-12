// Shared, presentation-only interactions. Database operations remain in each target.
(() => {
    const dateInput = document.getElementById('dateFilter');
    document.getElementById('todayDateButton')?.addEventListener('click', () => {
        dateInput.value = formatDateInTokyo(new Date());
        dateInput.dispatchEvent(new Event('change'));
    });

    const list = document.querySelector('.data-section');
    const fitList = () => {
        if (!list) return;
        const top = list.getBoundingClientRect().top;
        list.style.setProperty('--list-height', `${Math.max(260, window.innerHeight - top - 18)}px`);
    };
    const main = document.getElementById('main-app-container');
    if (window.ResizeObserver && main) new ResizeObserver(fitList).observe(main);
    window.addEventListener('resize', fitList);
    fitList();

    const controlKey = element => `${element.tagName}:${element.className.replace(/\b(is-active|pink|name-no-notes)\b/g, '').trim()}:${element.dataset.dest || ''}`;
    window.sosListUI = {
        captureFocus() {
            const active = document.activeElement;
            const row = active?.closest('[data-id]');
            if (!row || !list?.contains(active)) return null;
            return { id: row.dataset.id, mobile: row.classList.contains('appointment-card'), key: controlKey(active) };
        },
        restoreFocus(previous) {
            if (!previous) return;
            const rows = list.querySelectorAll(previous.mobile ? '.appointment-card' : 'tr[data-id]');
            const row = Array.from(rows).find(el => el.dataset.id === previous.id);
            const control = row && Array.from(row.querySelectorAll('button, summary')).find(el => el.getClientRects().length && controlKey(el) === previous.key);
            control?.focus({ preventScroll: true });
        }
    };

    // Give dialogs a keyboard entry point, contain Tab, and restore the opener.
    const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]';
    const visibleControls = modal => Array.from(modal.querySelectorAll(focusable)).filter(el => el.getClientRects().length);
    const openers = new WeakMap();
    document.querySelectorAll('.modal').forEach(modal => {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const title = modal.querySelector('h3');
        if (title) {
            if (!title.id) title.id = `${modal.id}-heading`;
            modal.setAttribute('aria-labelledby', title.id);
        }
        let wasOpen = false;
        new MutationObserver(() => {
            const isOpen = getComputedStyle(modal).display !== 'none';
            if (isOpen === wasOpen) return;
            wasOpen = isOpen;
            if (isOpen) {
                openers.set(modal, document.activeElement);
                (visibleControls(modal)[0] || modal).focus();
            } else {
                const opener = openers.get(modal);
                if (opener?.isConnected) opener.focus();
            }
        }).observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
        modal.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const controls = visibleControls(modal);
            const first = controls[0], last = controls[controls.length - 1];
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus();
            }
        });
    });
})();
