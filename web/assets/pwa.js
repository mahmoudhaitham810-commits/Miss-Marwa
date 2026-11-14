/* =========================================================
   Install as an app (PWA) — shared by the public site, the student
   portal and the staff portal. Each part has its own manifest:
     /manifest.json               → "Science Academy" (students)
     /admin/admin-manifest.json   → "Science Academy Staff"
   Any element with [data-install] becomes an install button. It's
   hidden automatically when the page is already running as the app.
   window.PWA
   ========================================================= */
(function () {
    'use strict';
    let deferred = null;
    const root = document.documentElement;
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isSamsung = /SamsungBrowser/i.test(ua);
    const isFirefox = /firefox|fxios/i.test(ua);
    const isEdge = /edg\//i.test(ua);
    const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
    const isStaff = () => location.pathname.startsWith('/admin');
    const appName = () => (isStaff() ? 'Science Academy Staff' : 'Science Academy');

    function update() {
        root.classList.toggle('pwa-installed', standalone());
        root.classList.toggle('pwa-ready', !!deferred);
    }
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; update(); });
    window.addEventListener('appinstalled', () => { deferred = null; update(); notify(`${appName()} is installed — open it from your home screen or apps.`); });
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
    async function install({ showHelp } = {}) {
        if (standalone()) { notify('You are already using the app 👍'); return 'installed'; }
        if (deferred) {
            const p = deferred; deferred = null; update();
            p.prompt();
            try { const { outcome } = await p.userChoice; return outcome; } catch (e) { return 'dismissed'; }
        }
        const html = `<ol class="install-steps">${steps().map(s => `<li>${s}</li>`).join('')}</ol>`;
        if (showHelp) showHelp(`Install ${appName()}`, html);
        else alert(steps().map(s => s.replace(/<[^>]+>/g, '')).join('\n'));
        return 'help';
    }

    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-install]');
        if (!b || b.dataset.installManual !== undefined) return;
        e.preventDefault();
        install({ showHelp: window.PWA.showHelp });
    });

    window.PWA = {
        install, steps, standalone, isIOS,
        get ready() { return !!deferred; },
        showHelp: null,                      // set by each part of the site to use its own sheet
        setNotify(fn) { notify = fn; }
    };
})();
