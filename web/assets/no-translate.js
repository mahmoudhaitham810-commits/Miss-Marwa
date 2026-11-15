/* =========================================================
   Exams must be read in English — block browser auto-translation.
   1) The page says translate="no" / class="notranslate" / <meta name="google" content="notranslate">
      (Chrome, Edge, Safari and Google Translate respect these).
   2) If a browser or extension translates anyway, this watcher notices
      (Chrome: html.translated-ltr/rtl + <font> tags · Edge: _msthash attributes · lang changed)
      and hides the exam behind a "turn off translation" screen until the page is back to the original.
   Loaded in <head> of the student exam pages, before anything else renders.
   ========================================================= */
(function () {
    'use strict';
    const html = document.documentElement;
    const LANG = html.getAttribute('lang') || 'en';
    html.setAttribute('translate', 'no');
    html.classList.add('notranslate');

    const isTranslated = () => {
        if (html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl')) return true;
        const lang = (html.getAttribute('lang') || '').toLowerCase();
        if (lang && !lang.startsWith(LANG.toLowerCase().slice(0, 2))) return true;
        const root = document.body;
        if (!root) return false;
        // Google Translate wraps translated text in <font style="vertical-align: inherit">
        if (root.querySelector('font[style*="vertical-align"]')) return true;
        // Microsoft / Edge translator marks translated nodes
        if (root.querySelector('[_msthash], [_msttexthash]') || html.hasAttribute('_msthash')) return true;
        if (document.querySelector('.goog-te-banner-frame, #goog-gt-tt, .skiptranslate iframe')) return true;
        return false;
    };

    let blocked = false, shield = null;
    function makeShield() {
        shield = document.createElement('div');
        shield.className = 'translate-shield notranslate';
        shield.setAttribute('translate', 'no');
        shield.setAttribute('role', 'alertdialog');
        shield.setAttribute('aria-live', 'assertive');
        shield.innerHTML = `
            <div class="ts-box">
                <div class="ts-ic" aria-hidden="true">文A</div>
                <h2>Turn off translation</h2>
                <p>This exam must be read in <b>English</b>. Your browser translated the page, so the exam is hidden.</p>
                <ol>
                    <li>Tap the translate bar / icon, or the menu <b>⋮</b>.</li>
                    <li>Choose <b>Show original</b> (or <b>English</b>) and turn off <b>Always translate</b>.</li>
                </ol>
                <p dir="rtl" lang="ar" class="ts-ar">الامتحان لازم يتقرا <b>بالإنجليزي</b>. المتصفح ترجم الصفحة، فالامتحان اتخفى.<br>اضغط على أيقونة الترجمة أو القائمة ⋮ واختار <b>عرض الأصل / English</b> ووقّف الترجمة التلقائية.</p>
                <p class="ts-small">The exam comes back by itself as soon as the page is in English again — your timer keeps running.</p>
            </div>`;
        document.body.appendChild(shield);
    }
    function setBlocked(on) {
        if (on === blocked) return;
        blocked = on;
        if (on) { if (!shield) makeShield(); document.body.classList.add('is-translated'); }
        else {
            document.body.classList.remove('is-translated');
            // Put the original English text back (the page re-renders the current question)
            if (typeof window.__onTranslationCleared === 'function') { try { window.__onTranslationCleared(); } catch (e) { } }
        }
        try { window.dispatchEvent(new CustomEvent('translation-change', { detail: { translated: on } })); } catch (e) { }
    }

    // The translator itself is on (page-level markers)
    const pageMarked = () => {
        if (html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl') || html.hasAttribute('_msthash')) return true;
        if (document.body && document.body.querySelector('[_msthash], [_msttexthash]')) return true; // Edge translator is active
        const lang = (html.getAttribute('lang') || '').toLowerCase();
        return !!lang && !lang.startsWith(LANG.toLowerCase().slice(0, 2));
    };
    let queued = false, repaired = 0;
    const check = () => {
        queued = false;
        if (!document.body) return;
        let t = isTranslated();
        // Translator switched off but translated text is left behind → redraw the original once, then re-check
        if (t && !pageMarked() && repaired < 3 && typeof window.__onTranslationCleared === 'function') {
            repaired++;
            try { window.__onTranslationCleared(); } catch (e) { }
            t = isTranslated();
        }
        if (!t) repaired = 0;
        setBlocked(t);
    };
    const soon = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };

    function start() {
        document.body.classList.add('notranslate');
        document.body.setAttribute('translate', 'no');
        new MutationObserver(soon).observe(html, { attributes: true, attributeFilter: ['class', 'lang', '_msthash'] });
        new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['_msthash', '_msttexthash'] });
        setInterval(check, 2000); // belt and braces for translators that don't touch the DOM tree we watch
        check();
    }
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

    window.NoTranslate = { isTranslated, get blocked() { return blocked; } };
})();
