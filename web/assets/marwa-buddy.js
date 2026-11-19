/* =====================================================================
   MarwaBuddy — Miss Marwa's avatar that "calls out" to the student (exam review + study summaries).
   Replaces the bee-mascot idea (19 Nov 2026): her own photo avatar + an Arabic speech bubble.
   • MarwaBuddy.pop(text, { actions: [{ label, primary, onClick }], key })  floating card, bottom corner;
       pops in, bobs gently, closes with ✕ / Esc / an action. `key` → shown once per page visit.
   • MarwaBuddy.chip(label, attrs)   small "avatar + label" button for a question / summary card
   • MarwaBuddy.panel()              inline answer panel: avatar + bubble; .think() → typing dots, .say(html), .error(text)
   CSS only (transform / opacity) — smooth on cheap phones; "reduce motion" turns the movement off.
   ===================================================================== */
(function () {
    const AV = '/assets/img/marwa-160.png';
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const CSS = `
    .mb-pop { position: fixed; z-index: 1500; right: 16px; left: auto; bottom: calc(16px + env(safe-area-inset-bottom)); max-width: min(360px, calc(100vw - 32px));
        display: flex; align-items: flex-end; gap: 10px; direction: rtl; pointer-events: none; }
    .mb-pop > * { pointer-events: auto; }
    @media (max-width: 1023px) { .mb-pop { bottom: calc(84px + env(safe-area-inset-bottom)); } }    /* above the phone tab bar */
    .mb-av { flex: none; width: 64px; height: 64px; border-radius: 50%; background: #fff; box-shadow: 0 10px 24px -8px rgba(15, 23, 42, .45), 0 0 0 3px var(--surface, #fff); object-fit: cover; }
    .mb-pop .mb-av { transform-origin: 50% 100%; animation: mb-in .55s cubic-bezier(.2, 1.4, .4, 1) both, mb-bob 3.2s ease-in-out .7s infinite; }
    .mb-bub { position: relative; background: var(--surface, #fff); color: var(--text, #0F172A); border: 1px solid var(--border, #E2E8F0); border-radius: 18px 18px 4px 18px;
        padding: 12px 14px 10px; box-shadow: 0 18px 40px -18px rgba(15, 23, 42, .45); font: 600 15px/1.6 "IBM Plex Sans Arabic", system-ui, sans-serif; animation: mb-bub .45s .18s cubic-bezier(.2, 1.3, .4, 1) both; }
    .mb-pop .mb-bub .mb-x { position: absolute; top: -10px; left: -10px; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--border, #E2E8F0); background: var(--surface, #fff); color: var(--muted, #64748B); cursor: pointer; display: grid; place-items: center; font-size: 15px; line-height: 1; }
    .mb-bub .mb-who { display: block; font-size: 11.5px; font-weight: 700; color: var(--primary, #2F5BEA); margin-bottom: 2px; }
    .mb-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .mb-acts button { border: 1px solid var(--border, #E2E8F0); background: var(--surface-2, #F1F5F9); color: var(--text, #0F172A); font: 600 13px/1 inherit; font-family: inherit; padding: 8px 12px; border-radius: 999px; cursor: pointer; }
    .mb-acts button.p { background: var(--primary, #2F5BEA); border-color: transparent; color: #fff; }
    .mb-pop.out .mb-av, .mb-pop.out .mb-bub { animation: mb-out .25s ease-in both; }
    /* chip on a card */
    .mb-chip { display: inline-flex; align-items: center; gap: 8px; padding: 4px 14px 4px 4px; border-radius: 999px; border: 1px solid var(--primary-line, #C7D7FE); background: var(--primary-soft, #EEF2FF);
        color: var(--primary, #2F5BEA); font: 700 13.5px/1 "IBM Plex Sans Arabic", system-ui, sans-serif; cursor: pointer; direction: rtl; transition: transform .15s, box-shadow .15s; }
    .mb-chip:hover { transform: translateY(-1px); box-shadow: 0 6px 16px -10px rgba(47, 91, 234, .7); }
    .mb-chip img { width: 30px; height: 30px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2px #fff; }
    .mb-chip.wave img { animation: mb-wave 2.6s ease-in-out infinite; transform-origin: 50% 90%; }
    .mb-chip.ghost { background: transparent; border-color: var(--border, #E2E8F0); color: var(--text-2, #334155); padding: 8px 14px; }
    .mb-chip[disabled] { opacity: .6; cursor: progress; }
    /* inline answer panel */
    .mb-panel { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; direction: rtl; }
    .mb-panel .mb-av { width: 44px; height: 44px; box-shadow: 0 6px 14px -6px rgba(15, 23, 42, .4), 0 0 0 2px var(--surface, #fff); }
    .mb-panel.talking .mb-av { animation: mb-talk .9s ease-in-out infinite; }
    .mb-panel.said .mb-av { animation: mb-in .5s cubic-bezier(.2, 1.4, .4, 1) both; }
    .mb-panel .mb-bub { flex: 1; min-width: 0; border-radius: 18px 4px 18px 18px; font-weight: 500; font-size: 15px; animation: mb-bub .35s cubic-bezier(.2, 1.3, .4, 1) both; }
    .mb-panel .mb-bub p { margin: 0 0 6px; } .mb-panel .mb-bub p:last-child { margin: 0; }
    .mb-panel .mb-bub ul, .mb-panel .mb-bub ol { margin: 4px 0 6px; padding-inline-start: 20px; }
    .mb-panel .mb-bub h4 { margin: 8px 0 4px; font-size: 15px; }
    .mb-panel .mb-err { color: var(--notice-danger-text, #B91C1C); }
    .mb-panel .mb-foot { display: block; margin-top: 8px; font-size: 11.5px; color: var(--muted, #64748B); font-weight: 600; }
    .mb-dots { display: inline-flex; gap: 5px; padding: 6px 2px; } .mb-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted, #94A3B8); animation: mb-dot 1s ease-in-out infinite; }
    .mb-dots i:nth-child(2) { animation-delay: .15s; } .mb-dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes mb-in { 0% { opacity: 0; transform: translateY(26px) scale(.6) rotate(-8deg); } 70% { opacity: 1; transform: translateY(-4px) scale(1.06) rotate(3deg); } 100% { opacity: 1; transform: none; } }
    @keyframes mb-bob { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-5px) rotate(-3deg); } }
    @keyframes mb-bub { from { opacity: 0; transform: translateY(8px) scale(.92); } to { opacity: 1; transform: none; } }
    @keyframes mb-out { to { opacity: 0; transform: translateY(14px) scale(.9); } }
    @keyframes mb-wave { 0%, 60%, 100% { transform: rotate(0); } 70% { transform: rotate(-12deg); } 80% { transform: rotate(10deg); } 90% { transform: rotate(-6deg); } }
    @keyframes mb-talk { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.04); } }
    @keyframes mb-dot { 0%, 100% { opacity: .3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
    @media (prefers-reduced-motion: reduce) { .mb-pop .mb-av, .mb-bub, .mb-chip.wave img, .mb-panel .mb-av, .mb-dots i, .mb-pop.out .mb-av, .mb-pop.out .mb-bub { animation: none !important; } }
    `;
    function css() { if (document.getElementById('mb-css')) return; const s = document.createElement('style'); s.id = 'mb-css'; s.textContent = CSS; document.head.appendChild(s); }

    let current = null;
    function pop(text, { actions = [], key = null, delay = 500 } = {}) {
        css();
        try { if (key && sessionStorage.getItem('mb_' + key)) return null; } catch (e) { }
        if (current) current.close(true);
        const el = document.createElement('div');
        el.className = 'mb-pop'; el.setAttribute('role', 'status');
        el.innerHTML = `<img class="mb-av" src="${AV}" alt="مس مروة" width="64" height="64">
            <div class="mb-bub"><button class="mb-x" aria-label="إغلاق" type="button">✕</button><span class="mb-who">مس مروة</span><span class="mb-txt">${esc(text)}</span>
            ${actions.length ? `<div class="mb-acts">${actions.map((a, i) => `<button type="button" class="${a.primary ? 'p' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
        const close = (now) => {
            if (!el.isConnected) return;
            document.removeEventListener('keydown', onKey);
            if (now) el.remove(); else { el.classList.add('out'); setTimeout(() => el.remove(), 260); }
            if (current && current.el === el) current = null;
        };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        el.addEventListener('click', (e) => {
            if (e.target.closest('.mb-x')) return close();
            const b = e.target.closest('[data-i]'); if (!b) return;
            const a = actions[Number(b.dataset.i)]; close(); if (a && a.onClick) a.onClick();
        });
        setTimeout(() => { document.body.appendChild(el); document.addEventListener('keydown', onKey); }, delay);
        try { if (key) sessionStorage.setItem('mb_' + key, '1'); } catch (e) { }
        current = { el, close };
        return current;
    }
    function chip(label, attrs = '', { wave = false, ghost = false, icon = true } = {}) {
        css();
        return `<button type="button" class="mb-chip${wave ? ' wave' : ''}${ghost ? ' ghost' : ''}" ${attrs}>${icon ? `<img src="${AV}" alt="" width="30" height="30" loading="lazy">` : ''}<span>${esc(label)}</span></button>`;
    }
    function panel(host) {
        css();
        const el = document.createElement('div');
        el.className = 'mb-panel';
        el.innerHTML = `<img class="mb-av" src="${AV}" alt="مس مروة" width="44" height="44"><div class="mb-bub" aria-live="polite"></div>`;
        host.appendChild(el);
        const bub = el.querySelector('.mb-bub');
        return {
            el,
            think(txt = 'لحظة بجهزلك الشرح…') { el.className = 'mb-panel talking'; bub.innerHTML = `<span class="mb-who">مس مروة</span><span class="mb-dots"><i></i><i></i><i></i></span> <span class="small muted">${esc(txt)}</span>`; },
            say(html, foot = '') { el.className = 'mb-panel said'; bub.innerHTML = `<span class="mb-who">مس مروة</span>${html}${foot ? `<span class="mb-foot">${esc(foot)}</span>` : ''}`; },
            error(txt) { el.className = 'mb-panel said'; bub.innerHTML = `<span class="mb-who">مس مروة</span><p class="mb-err" dir="rtl">${esc(txt)}</p>`; },
            remove() { el.remove(); }
        };
    }
    window.MarwaBuddy = { pop, chip, panel, AVATAR: AV };
})();
