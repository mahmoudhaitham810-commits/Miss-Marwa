/* =====================================================================
   MarwaBuddy — the Assistant Pro badge on the student pages (exam review + study summaries).
   20 Nov 2026: Miss Marwa's photo was replaced by a circular AI badge (inline SVG, navy + cyan, the site's colours)
   that PEEKS out of the corner of a card (spring pop-out + a speech bubble), then tucks back in, and peeks again
   a few seconds later — only for cards on screen, one at a time, so it catches the eye without blocking anything.
   • MarwaBuddy.badge(size)           the badge HTML (no images, no ids — safe to repeat)
   • MarwaBuddy.peek(card, { text, onOpen, label })   attach a peeking badge to a card; click (badge or bubble) → onOpen()
   • MarwaBuddy.chip(label, attrs)    small "badge + label" button
   • MarwaBuddy.panel(host)           inline answer: badge + bubble; .think() typing dots, .say(html), .error(text)
   • MarwaBuddy.pop(text, opts)       (kept for compatibility) floating card in the bottom corner
   CSS only (transform / opacity), "reduce motion" = no movement (badge stays, bubble on hover/focus).
   ===================================================================== */
(function () {
    const NAME = 'Assistant Pro';
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // AI spark + orbit (science) inside a glowing navy disc
    const ICON = `<svg class="aib-ic" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <ellipse class="aib-orbit" cx="16" cy="16" rx="12.5" ry="5.2" transform="rotate(-28 16 16)" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".55"/>
        <circle class="aib-e" cx="26.4" cy="10.4" r="1.7" fill="#5EEAD4"/>
        <path class="aib-star" d="M16 6.2c.9 4.9 2.9 6.9 7.8 7.8-4.9.9-6.9 2.9-7.8 7.8-.9-4.9-2.9-6.9-7.8-7.8 4.9-.9 6.9-2.9 7.8-7.8z" fill="currentColor"/>
        <path class="aib-mini" d="M24.5 20.5c.3 1.6 1 2.3 2.6 2.6-1.6.3-2.3 1-2.6 2.6-.3-1.6-1-2.3-2.6-2.6 1.6-.3 2.3-1 2.6-2.6z" fill="#A5F3FC"/>
    </svg>`;
    const badge = (size = 56) => `<span class="aib" style="--s:${size}px" aria-hidden="true">${ICON}</span>`;

    const CSS = `
    .aib { position: relative; display: inline-grid; place-items: center; flex: none; width: var(--s); height: var(--s); border-radius: 50%; color: #E0FBFF;
        background: radial-gradient(circle at 32% 28%, #1E4E8C 0%, #0F2A52 48%, #0B1630 100%);
        box-shadow: 0 0 0 2px rgba(34, 211, 238, .85), 0 0 0 calc(var(--s) * .07) rgba(34, 211, 238, .16), 0 8px 22px -6px rgba(8, 145, 178, .65); }
    .aib::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; box-shadow: 0 0 calc(var(--s) * .35) rgba(34, 211, 238, .45); opacity: .7; animation: aib-glow 2.8s ease-in-out infinite; pointer-events: none; }
    .aib-ic { width: 66%; height: 66%; overflow: visible; }
    .aib-star { transform-origin: 16px 14px; animation: aib-twinkle 2.4s ease-in-out infinite; }
    .aib-mini { transform-origin: 24.5px 23px; animation: aib-twinkle 2.4s ease-in-out .9s infinite; }
    .aib-e { transform-origin: 16px 16px; animation: aib-orbit 5s linear infinite; }

    /* ---- the peek ---- */
    .aip-host { position: relative; }
    .aip { position: absolute; z-index: 5; top: -16px; right: -10px; display: flex; align-items: center; gap: 8px; flex-direction: row-reverse;
        border: 0; padding: 0; background: none; cursor: pointer; font: inherit; -webkit-tap-highlight-color: transparent; pointer-events: none; }
    .aip .aib { pointer-events: auto; }                                                /* only the badge (and the bubble while shown) catch taps — never the card under it */
    .aip .aib { transform: translate(14px, 10px) scale(.46) rotate(-25deg); opacity: .0; transition: transform .7s cubic-bezier(.2, 1.6, .35, 1), opacity .35s ease; }
    .aip.rest .aib { opacity: .92; }                                                   /* tucked: a small badge peeking from the corner */
    .aip.out .aib { transform: none; opacity: 1; }
    .aip-bub { position: relative; max-width: min(240px, 62vw); padding: 9px 13px; border-radius: 16px 16px 4px 16px; direction: rtl; text-align: right;
        background: #0F2A52; color: #F0FDFF; font: 700 13.5px/1.5 "IBM Plex Sans Arabic", system-ui, sans-serif; white-space: normal;
        box-shadow: 0 0 0 1px rgba(34, 211, 238, .5), 0 14px 28px -12px rgba(2, 6, 23, .6);
        transform-origin: 100% 80%; transform: translateX(10px) scale(.6); opacity: 0; pointer-events: none; transition: transform .45s cubic-bezier(.2, 1.4, .4, 1), opacity .25s ease; }
    .aip.out .aip-bub { transform: none; opacity: 1; pointer-events: auto; transition-delay: .18s; }
    .aip.rest .aib { cursor: pointer; }
    .aip:focus-visible { outline: none; } .aip:focus-visible .aib { box-shadow: 0 0 0 3px #fff, 0 0 0 6px #22D3EE; }
    .aip.out:hover .aib { transform: scale(1.06); }
    @media (max-width: 480px) { .aip { right: -6px; } .aip-bub { font-size: 13px; } }

    /* ---- chip / panel / pop ---- */
    .mb-chip { display: inline-flex; align-items: center; gap: 8px; padding: 4px 14px 4px 4px; border-radius: 999px; border: 1px solid rgba(34, 211, 238, .45); background: linear-gradient(135deg, rgba(15, 42, 82, .06), rgba(34, 211, 238, .12));
        color: var(--text, #0F172A); font: 700 13.5px/1 "IBM Plex Sans Arabic", system-ui, sans-serif; cursor: pointer; direction: rtl; transition: transform .15s, box-shadow .15s; }
    .mb-chip:hover { transform: translateY(-1px); box-shadow: 0 6px 16px -10px rgba(8, 145, 178, .8); }
    .mb-chip.ghost { background: transparent; border-color: var(--border, #E2E8F0); color: var(--text-2, #334155); padding: 8px 14px; }
    .mb-chip[disabled] { opacity: .6; cursor: progress; }
    .mb-bub { position: relative; background: var(--surface, #fff); color: var(--text, #0F172A); border: 1px solid var(--border, #E2E8F0); border-radius: 18px 18px 4px 18px;
        padding: 12px 14px 10px; box-shadow: 0 18px 40px -18px rgba(15, 23, 42, .45); font: 600 15px/1.6 "IBM Plex Sans Arabic", system-ui, sans-serif; animation: mb-bub .45s .18s cubic-bezier(.2, 1.3, .4, 1) both; }
    .mb-bub .mb-who { display: block; font-size: 11.5px; font-weight: 800; color: #0891B2; margin-bottom: 2px; letter-spacing: .01em; }
    [data-theme="dark"] .mb-bub .mb-who { color: #22D3EE; }
    .mb-panel { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; direction: rtl; }
    .mb-panel.talking .aib { animation: mb-talk .9s ease-in-out infinite; }
    .mb-panel.said .aib { animation: mb-in .5s cubic-bezier(.2, 1.4, .4, 1) both; }
    .mb-panel .mb-bub { flex: 1; min-width: 0; border-radius: 18px 4px 18px 18px; font-weight: 500; font-size: 15px; animation: mb-bub .35s cubic-bezier(.2, 1.3, .4, 1) both; }
    .mb-panel .mb-bub p { margin: 0 0 6px; } .mb-panel .mb-bub p:last-child { margin: 0; }
    .mb-panel .mb-bub ul, .mb-panel .mb-bub ol { margin: 4px 0 6px; padding-inline-start: 20px; }
    .mb-panel .mb-bub h4 { margin: 8px 0 4px; font-size: 15px; }
    .mb-panel .mb-err { color: var(--notice-danger-text, #B91C1C); }
    .mb-panel .mb-foot { display: block; margin-top: 8px; font-size: 11.5px; color: var(--muted, #64748B); font-weight: 600; }
    .mb-dots { display: inline-flex; gap: 5px; padding: 6px 2px; } .mb-dots i { width: 7px; height: 7px; border-radius: 50%; background: #22D3EE; animation: mb-dot 1s ease-in-out infinite; }
    .mb-dots i:nth-child(2) { animation-delay: .15s; } .mb-dots i:nth-child(3) { animation-delay: .3s; }
    .mb-pop { position: fixed; z-index: 1500; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); max-width: min(360px, calc(100vw - 32px)); display: flex; align-items: flex-end; gap: 10px; direction: rtl; }
    @media (max-width: 1023px) { .mb-pop { bottom: calc(84px + env(safe-area-inset-bottom)); } }
    .mb-pop .aib { animation: mb-in .55s cubic-bezier(.2, 1.4, .4, 1) both; }
    .mb-pop .mb-x { position: absolute; top: -10px; left: -10px; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border, #E2E8F0); background: var(--surface, #fff); color: var(--muted, #64748B); cursor: pointer; display: grid; place-items: center; }
    .mb-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .mb-acts button { border: 1px solid var(--border, #E2E8F0); background: var(--surface-2, #F1F5F9); color: var(--text, #0F172A); font: 600 13px/1 inherit; font-family: inherit; padding: 8px 12px; border-radius: 999px; cursor: pointer; }
    .mb-acts button.p { background: #0F2A52; border-color: transparent; color: #fff; }

    @keyframes aib-glow { 0%, 100% { opacity: .35; } 50% { opacity: .9; } }
    @keyframes aib-twinkle { 0%, 100% { transform: scale(1) rotate(0); } 45% { transform: scale(.82) rotate(12deg); } 60% { transform: scale(1.08) rotate(0); } }
    @keyframes aib-orbit { from { transform: rotate(0); } to { transform: rotate(360deg); } }
    @keyframes mb-in { 0% { opacity: 0; transform: translateY(20px) scale(.6) rotate(-10deg); } 70% { opacity: 1; transform: translateY(-3px) scale(1.06); } 100% { opacity: 1; transform: none; } }
    @keyframes mb-bub { from { opacity: 0; transform: translateY(8px) scale(.92); } to { opacity: 1; transform: none; } }
    @keyframes mb-talk { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.05); } }
    @keyframes mb-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
    @media (prefers-reduced-motion: reduce) {
        .aib::after, .aib-star, .aib-mini, .aib-e, .mb-bub, .mb-panel .aib, .mb-dots i, .mb-pop .aib { animation: none !important; }
        .aip .aib, .aip.rest .aib { transform: scale(.7); opacity: 1; transition: none; }
        .aip-bub { transition: none; }
        .aip:hover .aip-bub, .aip:focus-visible .aip-bub { transform: none; opacity: 1; pointer-events: auto; }
    }
    `;
    function css() { if (document.getElementById('mb-css')) return; const s = document.createElement('style'); s.id = 'mb-css'; s.textContent = CSS; document.head.appendChild(s); }
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

    // ---------- peek scheduler: only cards on screen, one out at a time, round robin ----------
    const PEEKS = new Set(), visible = new Set();
    let io = null, timer = null, turn = 0, outNow = null;
    const OUT_MS = 4200, GAP_MS = 2600;
    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            for (const p of [...PEEKS]) if (!p.el.isConnected) { PEEKS.delete(p); visible.delete(p); }
            if (document.hidden || reduced()) return schedule(GAP_MS);
            const list = [...visible].filter(p => p.el.isConnected);
            if (!list.length) return schedule(1200);
            const p = list[turn++ % list.length];
            outNow = p; p.el.classList.add('out'); p.el.setAttribute('aria-expanded', 'true');
            timer = setTimeout(() => { if (outNow === p) { p.el.classList.remove('out'); p.el.setAttribute('aria-expanded', 'false'); outNow = null; } schedule(GAP_MS + Math.round(Math.random() * 1600)); }, OUT_MS);
        }, delay);
    }
    function peek(card, { text, onOpen, label = '' } = {}) {
        css();
        if (!card) return null;
        const old = card.querySelector(':scope > .aip'); if (old) old.remove();
        card.classList.add('aip-host');
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'aip rest'; el.setAttribute('aria-label', label || text); el.setAttribute('aria-expanded', 'false');
        el.innerHTML = `${badge(48)}<span class="aip-bub" dir="rtl">${esc(text)}</span>`;
        el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('out'); if (onOpen) onOpen(); });
        card.appendChild(el);
        const p = { el, card };
        PEEKS.add(p);
        if (!io && 'IntersectionObserver' in window) io = new IntersectionObserver((ents) => ents.forEach(en => { const q = [...PEEKS].find(x => x.card === en.target); if (!q) return; if (en.isIntersecting && en.intersectionRatio > .6) visible.add(q); else { visible.delete(q); q.el.classList.remove('out'); } }), { threshold: [0, .6, 1] });
        if (io) io.observe(card); else visible.add(p);
        if (!timer) schedule(900);
        return p;
    }

    let current = null;
    function pop(text, { actions = [], key = null, delay = 500 } = {}) {
        css();
        try { if (key && sessionStorage.getItem('mb_' + key)) return null; } catch (e) { }
        if (current) current.close(true);
        const el = document.createElement('div');
        el.className = 'mb-pop'; el.setAttribute('role', 'status');
        el.innerHTML = `${badge(60)}<div class="mb-bub"><button class="mb-x" aria-label="إغلاق" type="button">✕</button><span class="mb-who">${NAME}</span><span class="mb-txt">${esc(text)}</span>
            ${actions.length ? `<div class="mb-acts">${actions.map((a, i) => `<button type="button" class="${a.primary ? 'p' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
        const close = (now) => { if (!el.isConnected) return; el.remove(); if (current && current.el === el) current = null; };
        el.addEventListener('click', (e) => {
            if (e.target.closest('.mb-x')) return close();
            const b = e.target.closest('[data-i]'); if (!b) return;
            const a = actions[Number(b.dataset.i)]; close(); if (a && a.onClick) a.onClick();
        });
        setTimeout(() => document.body.appendChild(el), delay);
        try { if (key) sessionStorage.setItem('mb_' + key, '1'); } catch (e) { }
        current = { el, close };
        return current;
    }
    function chip(label, attrs = '', { ghost = false, icon = true } = {}) {
        css();
        return `<button type="button" class="mb-chip${ghost ? ' ghost' : ''}" ${attrs}>${icon ? badge(28) : ''}<span>${esc(label)}</span></button>`;
    }
    function panel(host) {
        css();
        const el = document.createElement('div');
        el.className = 'mb-panel';
        el.innerHTML = `${badge(40)}<div class="mb-bub" aria-live="polite"></div>`;
        host.appendChild(el);
        const bub = el.querySelector('.mb-bub');
        return {
            el,
            think(txt = 'لحظة بجهزلك الشرح…') { el.className = 'mb-panel talking'; bub.innerHTML = `<span class="mb-who">${NAME}</span><span class="mb-dots"><i></i><i></i><i></i></span> <span class="small muted">${esc(txt)}</span>`; },
            say(html, foot = '') { el.className = 'mb-panel said'; bub.innerHTML = `<span class="mb-who">${NAME} ✨</span>${html}${foot ? `<span class="mb-foot">${esc(foot)}</span>` : ''}`; },
            error(txt) { el.className = 'mb-panel said'; bub.innerHTML = `<span class="mb-who">${NAME}</span><p class="mb-err" dir="rtl">${esc(txt)}</p>`; },
            remove() { el.remove(); }
        };
    }
    window.MarwaBuddy = { badge, peek, pop, chip, panel, NAME };
})();
