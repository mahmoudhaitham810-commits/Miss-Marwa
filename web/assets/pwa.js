/* =========================================================
   Install as an app (PWA) — shared by the public site, the student
   portal and the staff portal. Each part has its own manifest:
     /manifest.json               → "Science Academy" (students)
     /admin/admin-manifest.json   → "Science Academy Staff"
     /parent.webmanifest          → "Science Academy Parents"
   Any element with [data-install] becomes an install button. It's
   hidden automatically when the page is already running as the app.
   window.PWA
   ========================================================= */
(function () {
    'use strict';
    // The page <head> already stores the browser's install offer in window.__deferredInstallPrompt
    // (it can fire before this file loads). This file only reads and clears it.
    const getPrompt = () => window.__deferredInstallPrompt || null;
    const clearPrompt = () => { window.__deferredInstallPrompt = null; };
    const root = document.documentElement;
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isSamsung = /SamsungBrowser/i.test(ua);
    const isFirefox = /firefox|fxios/i.test(ua);
    const isEdge = /edg\//i.test(ua);
    const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
    const isStaff = () => location.pathname.startsWith('/admin');
    const isParent = () => location.pathname.startsWith('/parent');
    const appName = () => (isStaff() ? 'Science Academy Staff' : isParent() ? 'Science Academy Parents' : 'Science Academy');

    function update() {
        root.classList.toggle('pwa-installed', standalone());
        root.classList.toggle('pwa-ready', !!getPrompt());
    }
    // Same listener as in <head>, for any page that doesn't have the early one
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__deferredInstallPrompt = e; update(); offerArrived(); });
    // Chrome only sends its one-tap offer after a tap + ~30 s on the site. If someone pressed "Install" before that,
    // the help sheet stays open and turns into a one-tap button the moment the offer arrives.
    let pendingTap = 0;
    function offerArrived() {
        document.querySelectorAll('[data-install-now-box]').forEach(b => { b.hidden = false; });
        document.querySelectorAll('[data-install-wait]').forEach(b => { b.hidden = true; });
        const ua = navigator.userActivation;
        if (pendingTap && Date.now() - pendingTap < 4500 && (!ua || ua.isActive)) {
            pendingTap = 0;
            const box = document.querySelector('[data-install-now-box]'), ov = box && box.closest('.overlay');
            if (ov) { const x = ov.querySelector('[data-close]'); if (x) x.click(); }       // the help sheet isn't needed any more
            install({ showHelp: window.PWA && window.PWA.showHelp });
        }
    }
    window.addEventListener('appinstalled', () => { clearPrompt(); update(); notify(`${appName()} is installed — open it from your home screen or apps.`); });
    try { matchMedia('(display-mode: standalone)').addEventListener('change', update); } catch (e) { }
    update();

    // The site's single service worker (notifications + the offline page). Registering the same
    // file again is harmless; it keeps install working on pages that don't load OneSignal.
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('/OneSignalSDKWorker.js').catch(() => { }));
    }

    // Step-by-step help for browsers without a one-tap install
    function steps() {
        const name = appName();
        if (isParent()) {                                                     // parents: Arabic
            if (isIOS) return [`اضغط زرار <b>المشاركة</b> <span aria-hidden="true">(□↑)</span> تحت في Safari.`, `انزل واختار <b>إضافة إلى الشاشة الرئيسية</b> (Add to Home Screen).`, `اضغط <b>إضافة</b> — هتلاقي «ولي الأمر» على الشاشة الرئيسية.`];
            if (isSamsung) return [`اضغط القائمة <b>≡</b> تحت.`, `اختار <b>إضافة الصفحة إلى</b> ← <b>الشاشة الرئيسية</b>.`];
            if (isAndroid) return [`اضغط قائمة المتصفح <b>⋮</b> (فوق على اليمين).`, `اختار <b>تثبيت التطبيق</b> أو <b>إضافة إلى الشاشة الرئيسية</b>.`, `اضغط <b>تثبيت</b>.`];
            return [`اضغط علامة التثبيت <span aria-hidden="true">⊕</span> في آخر شريط العنوان، أو من القائمة <b>⋮</b> اختار <b>تثبيت</b>.`, `اضغط <b>تثبيت</b> — البوابة هتفتح في نافذة لوحدها.`];
        }
        if (isIOS) {
            const notSafari = /crios|fxios|edgios/i.test(ua);
            return [
                notSafari ? `Tap the <b>Share</b> button (top or bottom of the screen).` : `Tap the <b>Share</b> button at the bottom of Safari <span aria-hidden="true">(□↑)</span>.`,
                `Scroll down and choose <b>Add to Home Screen</b>.`,
                `Tap <b>Add</b> — "${name}" appears on your home screen.`
            ];
        }
        if (isSamsung) return [`Tap the menu <b>≡</b> at the bottom.`, `Choose <b>Add page to</b> → <b>Home screen</b>.`];
        if (isAndroid) return [`Tap the browser menu <b>⋮</b> (top right).`, `Choose <b>Install app</b> or <b>Add to Home screen</b>.`, `Tap <b>Install</b>.`];
        if (isFirefox) return [`Firefox on computers can't install web apps.`, `Open this page in <b>Chrome</b> or <b>Edge</b>, then click <b>Install app</b> again.`];
        return [
            `Click the install icon <span aria-hidden="true">⊕</span> at the right end of the address bar,`,
            `or open the menu <b>${isEdge ? '…' : '⋮'}</b> → <b>${isEdge ? 'Apps → Install this site as an app' : 'Cast, save and share → Install page as app'}</b>.`,
            `Click <b>Install</b> — "${name}" opens in its own window and gets a desktop / Start-menu icon.`
        ];
    }

    let notify = (msg) => { try { (window.Site && Site.toast) ? Site.toast(msg, 'success') : null; } catch (e) { } };

    // showHelp(title, html) lets each part of the site use its own sheet design
    const chromiumAndroid = () => isAndroid && !isFirefox && !isIOS;
    async function install({ showHelp } = {}) {
        if (standalone()) { notify(isParent() ? 'إنت فاتح التطبيق بالفعل 👍' : 'You are already using the app 👍'); return 'installed'; }
        let p = getPrompt();
        if (!p && chromiumAndroid()) {                                        // the offer sometimes lands a moment late
            const tap = pendingTap = Date.now();
            await new Promise(r => setTimeout(r, 900));
            if (pendingTap !== tap) return 'prompted';                         // the offer arrived meanwhile and was shown
            p = getPrompt();
            if (p) pendingTap = 0;
        }
        if (p) {
            // Called straight from the click, so the browser shows its own one-click install dialog
            try { p.prompt(); } catch (e) { clearPrompt(); update(); return showSteps(showHelp); }
            clearPrompt(); update(); // an offer can be used once; the browser sends a new one if they say "not now"
            try { const { outcome } = await p.userChoice; return outcome; } catch (e) { return 'dismissed'; }
        }
        return showSteps(showHelp);
    }
    function showSteps(showHelp) {
        const ar = isParent(), live = chromiumAndroid() || (!isIOS && !isFirefox && !isAndroid);
        const now = live ? `<div data-install-now-box hidden style="margin-bottom:12px"><button type="button" class="btn btn-primary btn-block" data-install-now>${ar ? '📲 ثبّت الآن بضغطة واحدة' : '📲 Install now — one tap'}</button></div>
            <p data-install-wait class="small muted" style="margin:0 0 10px">${ar ? '⏳ المتصفح بيجهّز التثبيت بضغطة واحدة — خلّي الصفحة مفتوحة ثواني وهيظهر زرار «ثبّت الآن»، أو ثبّت يدويًا:' : '⏳ Your browser is getting the one-tap install ready — keep this open a few seconds, or install by hand:'}</p>` : '';
        const note = ar && isAndroid ? `<p class="small muted" style="margin:10px 0 0">لو تطبيق الطالب «Science Academy» متثبّت على نفس الموبايل، كروم بيعتبر البوابة جزء منه ومش بيعرض التثبيت — استخدم الخطوات اللي فوق، أو افتح البوابة من موبايل حضرتك.</p>` : '';
        const html = `${now}<ol class="install-steps">${steps().map(s => `<li>${s}</li>`).join('')}</ol>${note}`;
        if (showHelp) showHelp(ar ? 'ثبّت بوابة ولي الأمر' : `Install ${appName()}`, html);
        if (getPrompt()) offerArrived();
        else alert(steps().map(s => s.replace(/<[^>]+>/g, '')).join('\n'));
        return 'help';
    }

    document.addEventListener('click', (e) => {
        const n = e.target.closest && e.target.closest('[data-install-now]');
        if (n) {
            e.preventDefault();
            const p = getPrompt(); if (!p) return;
            try { p.prompt(); } catch (err) { return; }
            clearPrompt(); update();
            const ov = n.closest('.overlay'); if (ov) { const x = ov.querySelector('[data-close]'); if (x) x.click(); }
            return;
        }
        const b = e.target.closest && e.target.closest('[data-install]');
        if (!b || b.dataset.installManual !== undefined) return;
        e.preventDefault();
        install({ showHelp: window.PWA.showHelp });
    });

    window.PWA = {
        install, steps, standalone, isIOS,
        get ready() { return !!getPrompt(); },
        showHelp: null,                      // set by each part of the site to use its own sheet
        setNotify(fn) { notify = fn; }
    };
})();
