/* =========================================================
   Science Academy — staff portal shell (window.Admin)
   Shared by the new staff pages (grades, analytics, duplicates).
   Needs /assets/site.js loaded first (icons, toast, sheet, theme).
   ========================================================= */
(function () {
    'use strict';
    const { esc } = Site;

    const EXTRA = {
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
        arrowUp: '<path d="m18 15-6-6-6 6"/>',
        chevronRight: '<path d="m9 18 6-6-6-6"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
        link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
        video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
        arrowDown: '<path d="m6 9 6 6 6-6"/>',
        minus: '<path d="M5 12h14"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
        send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
        mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
        refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
        inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
        copy2: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
        party: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
        merge: '<path d="M8 6h10"/><path d="M6 12h9"/><path d="M11 18h7"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="18" r="1"/>'
    };
    if (window.Site && Site.ICONS) Object.keys(EXTRA).forEach(k => { if (!Site.ICONS[k]) Site.ICONS[k] = EXTRA[k]; }); // sheets + toasts know the staff icons too
    function icon(name, cls = '') {
        if (EXTRA[name]) return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${EXTRA[name]}</svg>`;
        return Site.icon(name, cls);
    }

    // Like Site.hydrateIcons, but also knows the staff-only icons (search, trash…)
    function hydrate(root = document) {
        root.querySelectorAll('[data-icon]').forEach(el => {
            el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.dataset.iconClass || ''));
            el.removeAttribute('data-icon');
        });
    }

    const GRADES = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
    const BRANCHES = { center: 'Center', private: 'Private' };
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
    };
    let STAFF = null, PERMS = [];
    // Features that are built but switched off for now. Parent report links: on hold (Nov 2026) —
    // set to true to show the "Parent link" / "Report links" buttons again.
    const FEATURES = { parentLinks: false };
    const feature = (k) => FEATURES[k] === true || store.get('feature_' + k, '') === '1';
    const can = (p) => PERMS.includes(p);

    // ---------- API with in-place re-login (unsaved work stays on screen) ----------
    let reloginPromise = null;
    async function api(path, { method, body } = {}) {
        const opts = { method: method || (body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} };
        if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        let res = await fetch(path, opts);
        if (res.status === 401) {
            await relogin();
            res = await fetch(path, opts);
        }
        let data = {};
        try { data = await res.json(); } catch (e) { }
        if (res.status === 403) { const err = new Error(data.error || 'This is for Miss Marwa only'); err.status = 403; throw err; }
        if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status})`); err.status = res.status; err.data = data; throw err; }
        return data;
    }
    function relogin() {
        if (reloginPromise) return reloginPromise;
        reloginPromise = new Promise((resolve) => {
            Site.sheet({
                iconName: 'lock', title: 'Session ended', subtitle: 'Sign in again — nothing on this page is lost.',
                html: `<div class="field"><label for="rlU">Username</label><div class="input"><input class="plain" id="rlU" autocapitalize="none" value="${esc(STAFF ? STAFF.username : '')}"></div></div>
                       <div class="field" style="margin:0"><label for="rlP">Password</label><div class="input"><input class="plain" id="rlP" type="password" autocomplete="current-password"></div></div>
                       <p class="small" id="rlErr" style="color:var(--danger);margin:8px 0 0"></p>`,
                actions: [{
                    label: 'Sign in', onClick: async (close) => {
                        const r = await fetch('/api/admin-auth?action=login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('rlU').value.trim().toLowerCase(), password: document.getElementById('rlP').value }) });
                        const d = await r.json().catch(() => ({}));
                        if (!d.success) { document.getElementById('rlErr').textContent = d.error || 'Sign in failed'; return; }
                        if (STAFF && d.staff.id !== STAFF.id) { location.reload(); return; }
                        close(); reloginPromise = null; resolve();
                    }
                }]
            });
            setTimeout(() => document.getElementById('rlP')?.focus(), 250);
        });
        return reloginPromise;
    }

    // ---------- Shell ----------
    function nav() {
        const teacher = STAFF && STAFF.role === 'teacher';
        return [
            { key: 'today', short: 'Today', label: 'Today', icon: 'home', href: '/admin/' },
            { key: 'students', short: 'Students', label: 'Students', icon: 'users', href: '/admin/students.html' },
            { key: 'content', label: 'Lessons & files', icon: 'book', href: '/admin/content.html' },
            { key: 'exams', label: 'Online exams', icon: 'clipboard', href: '/admin/exams.html' },
            { key: 'results', label: 'Online results', icon: 'checkCircle', href: '/admin/results.html' },
            { key: 'grades', short: 'Grades', label: 'Center grades', icon: 'edit', href: '/admin/grades.html' },
            { key: 'analytics', short: 'Analytics', label: 'Analytics', icon: 'trophy', href: '/admin/analytics.html' },
            { key: 'reports', label: 'Parent reports', icon: 'whatsapp', href: '/admin/reports.html' },
            { key: 'duplicates', label: 'Duplicate accounts', icon: 'merge', href: '/admin/duplicates.html' },
            { key: 'datacheck', label: 'Data check', icon: 'shield', href: '/admin/data-check.html' },
            { key: 'inbox', label: 'Questions · أسئلتي', icon: 'inbox', href: '/admin/inbox.html' },
            teacher ? { key: 'copilot', label: 'AI Co-Pilot', icon: 'sparkles', soon: true } : null,
            { key: 'settings', label: teacher ? 'Settings' : 'My password', icon: 'settings', href: '/admin/settings.html' }
        ].filter(Boolean);
    }
    function shell({ active, title }) {
        const items = nav();
        const avatar = STAFF.role === 'teacher' ? '/assets/img/marwa-160.png' : '/assets/img/logo-96.png';
        const link = (n) => n.soon
            ? `<button data-soon="${esc(n.label)}">${icon(n.icon)}${esc(n.label)}<span class="soon-tag">Soon</span></button>`
            : `<a href="${n.href}" class="${n.key === active ? 'active' : ''}" ${n.key === active ? 'aria-current="page"' : ''}>${icon(n.icon)}${esc(n.label)}</a>`;
        const sidebar = `<aside class="sidebar" aria-label="Staff navigation"><div>
                <a class="brand" href="/admin/"><img src="/assets/img/logo-96.png" alt="" width="44" height="44"><div class="brand-text"><strong>Science Academy</strong><span>Staff portal</span></div></a>
                <nav class="side-nav">${items.map(link).join('')}</nav></div>
            <button class="side-install" data-install>${icon('download', 'sm')}<span>Install the staff app<small>Phone, tablet or laptop</small></span></button>
            <div class="side-user"><img class="avatar" src="${avatar}" alt="" style="object-fit:cover;background:#fff">
                <div class="who"><strong dir="auto">${esc(STAFF.name)}</strong><span>${STAFF.role === 'teacher' ? 'Full access' : 'Assistant'}</span></div>
                <button class="icon-btn" title="Sign out" aria-label="Sign out" data-signout>${icon('logout', 'sm')}</button></div></aside>`;
        const topbar = `<header class="topbar">
                <a class="brand" href="/admin/"><img src="/assets/img/logo-96.png" alt="" width="38" height="38"><div class="brand-text"><strong>${esc(title)}</strong><span>Staff portal</span></div></a>
                <div class="page-title-desktop">${esc(title)}</div>
                <div class="topbar-actions">
                    <button class="btn btn-soft btn-sm topbar-install" data-install title="Install the staff app">${icon('download', 'sm')}<span>Install app</span></button>
                    <button class="icon-btn theme-btn" data-theme-toggle aria-label="Switch light / dark mode" title="Light / dark mode">${icon('moon', 'moon')}${icon('sun', 'sun')}</button>
                    <button class="icon-btn menu-trigger" aria-label="Menu" data-menu>${icon('menu')}</button>
                </div></header>`;
        const bottom = `<nav class="bottomnav" aria-label="Staff navigation">
                ${['today', 'students', 'grades', 'analytics'].map(k => items.find(i => i.key === k)).map(n => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${icon(n.icon)}<span>${esc(n.short)}</span></a>`).join('')}
                <button data-menu>${icon('menu')}<span>More</span></button></nav>`;
        document.body.insertAdjacentHTML('afterbegin', sidebar + topbar);
        document.body.insertAdjacentHTML('beforeend', bottom);
        document.title = `${title} · Science Academy Staff`;
        document.body.classList.add('role-' + STAFF.role);

        document.addEventListener('click', (e) => {
            const s = e.target.closest('[data-soon]');
            if (s) { e.preventDefault(); Site.sheet({ iconName: 'sparkles', title: s.dataset.soon, subtitle: 'Coming soon', html: '<p class="muted" style="margin:0">This part of the portal is being built and will appear here soon.</p>', actions: [{ label: 'OK', cls: 'btn-ghost' }] }); return; }
            if (e.target.closest('[data-signout]')) { signOut(); return; }
            if (e.target.closest('[data-menu]')) { menu(); return; }
        });
        const tb = document.querySelector('.topbar');
        const onScroll = () => tb.classList.toggle('scrolled', window.scrollY > 4);
        window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    }
    function menu() {
        Site.sheet({
            iconName: 'menu', title: STAFF.name, subtitle: STAFF.role === 'teacher' ? 'Miss Marwa · full access' : 'Assistant',
            html: `<div class="stack" style="gap:2px">${nav().map(n => n.soon
                ? `<button class="list-btn" data-soon="${esc(n.label)}">${icon(n.icon)}${esc(n.label)}<span class="end soon-tag">Soon</span></button>`
                : `<a class="list-btn" href="${n.href}">${icon(n.icon)}${esc(n.label)}</a>`).join('')}
                <button class="list-btn" data-install>${icon('download')}Install the staff app</button>
                <button class="list-btn" data-theme-toggle>${icon('moon')}Light / dark mode</button>
                <button class="list-btn danger" data-signout>${icon('logout')}Sign out</button></div>`
        });
    }
    async function signOut() {
        await fetch('/api/admin-auth?action=logout', { method: 'POST', credentials: 'same-origin' }).catch(() => { });
        ['mm_students_db', 'mm_lessons_db', 'honorBoardData'].forEach(k => { try { localStorage.removeItem(k); } catch (e) { } });
        location.replace('/admin/login.html');
    }

    async function boot({ active, title }) {
        let me = null;
        try { me = await (await fetch('/api/admin-auth?action=me', { credentials: 'same-origin' })).json(); } catch (e) { }
        if (!me || !me.authenticated) {
            location.replace('/admin/login.html?next=' + encodeURIComponent(location.pathname + location.search));
            return new Promise(() => { });
        }
        STAFF = me.staff; PERMS = me.permissions || [];
        shell({ active, title });
        hydrate(); // staff-only icons first (Site.init would fill them with blanks)
        Site.init();
        // Red badge on Questions when students are waiting for an answer
        if (can('inbox.reply')) api('/api/ask?action=counts').then(d => {
            if (!d || !d.total) return;
            document.querySelectorAll('a[href="/admin/inbox.html"]').forEach(el => el.insertAdjacentHTML('beforeend', `<span class="nav-badge" title="Waiting for an answer">${d.total}</span>`));
        }).catch(() => { });
        // Native <select>s become portal-styled pickers (after the page has filled them in)
        setTimeout(() => {
            document.querySelectorAll('select.pick').forEach(enhanceSelect);
            new MutationObserver((list) => list.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                if (n.matches('select.pick')) enhanceSelect(n); else n.querySelectorAll?.('select.pick').forEach(enhanceSelect);
            }))).observe(document.body, { childList: true, subtree: true });
        }, 0);
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('/OneSignalSDKWorker.js').catch(() => { });
        return STAFF;
    }

    // ---------- Small UI helpers ----------
    const fmtPct = (v, d = 0) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(d).replace(/\.0+$/, '')}%`);
    const levelOf = (p) => (p === null || p === undefined ? null : p >= 85 ? 'excellent' : p >= 70 ? 'good' : p >= 50 ? 'average' : 'weak');
    const LEVEL_LABEL = { excellent: 'Excellent', good: 'Good', average: 'Average', weak: 'Needs help' };
    function initials(s) {
        const ch = String(s.firstName || '').trim().charAt(0);
        return /[A-Za-z]/.test(ch) ? esc(ch.toUpperCase()) : esc(ch || '?');
    }
    function segmented(el, value, onChange) {
        el.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.value === value));
        el.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-value]'); if (!b) return;
            el.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
            onChange(b.dataset.value);
        });
    }
    function normalizeDigits(s) { return Site.normalizeDigits(String(s ?? '')); }
    function toMs(v) {
        if (!v) return NaN;
        const str = String(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00Z').getTime();
        return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) || !/\d:\d/.test(str) ? str : str.replace(' ', 'T') + 'Z').getTime();
    }
    function fmtDate(v, withTime = false) {
        const ms = toMs(v);
        if (isNaN(ms)) return v ? String(v) : '—';
        const d = new Date(ms);
        return withTime ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function timeLeft(v) {
        const ms = toMs(v) - Date.now();
        if (isNaN(ms)) return '';
        if (ms <= 0) return 'closed';
        const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3);
        return h >= 48 ? `${Math.floor(h / 24)} days left` : h >= 1 ? `${h}h ${m}m left` : `${m} min left`;
    }
    const PRE = (text) => `<pre dir="rtl" style="white-space:pre-wrap;font-family:var(--font-ar);background:var(--surface-2);padding:12px;border-radius:12px;margin:0;max-height:46vh;overflow:auto">${esc(text)}</pre>`;
    // ---------- WhatsApp sender ----------
    // Nothing is ever sent automatically: a person reads each message and presses Send in WhatsApp.
    // That human step is what keeps Miss Marwa's number safe — WhatsApp bans automated/bulk senders.
    const isPhone = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const WA_MODES = { app: 'WhatsApp app', web: 'WhatsApp Web', link: 'wa.me' };
    const waMode = () => { const m = store.get('wa_mode', ''); return WA_MODES[m] ? m : (isPhone() ? 'link' : 'app'); };
    function waNumber(phone) {
        let n = String(phone || '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0).replace(/\D/g, '');
        if (n.startsWith('0020')) n = n.slice(4);
        if (n.startsWith('20') && n.length === 12) n = n.slice(2);
        if (n.startsWith('0')) n = n.slice(1);
        return /^1\d{9}$/.test(n) ? '20' + n : null;
    }
    function waHref(phone, text, mode = waMode()) {
        const n = waNumber(phone); if (!n) return null;
        const t = encodeURIComponent(text || '');
        if (mode === 'app') return `whatsapp://send?phone=${n}&text=${t}`;          // opens WhatsApp Desktop / the phone app directly
        if (mode === 'web') return `https://web.whatsapp.com/send?phone=${n}&text=${t}`; // re-uses one WhatsApp Web tab
        return `https://wa.me/${n}?text=${t}`;
    }
    const waTarget = (mode) => mode === 'app' ? '' : 'target="wa_window"';
    // Open whatsapp://… in the installed app. The page itself stays where it is (the browser only hands the link over).
    function openWhatsAppApp(href) { try { (window.__waOpen || ((h) => { window.location.href = h; }))(href); } catch (e) { } } // __waOpen: test hook
    async function hashText(text) {
        try {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text).trim()));
            return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) { let h = 0; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(16).padStart(8, '0'); }
    }
    async function recentSent(ids) {
        try { return (await api('/api/messages?action=recent', { body: { studentIds: ids } })).entries || []; } catch (e) { return []; }
    }

    // One sheet for one message or a whole list: Enter = open in WhatsApp + next, → skip, ← back, Esc stop
    async function sender({ list, makeText, title = 'WhatsApp', kind = 'other' }) {
        list = (list || []).filter(Boolean);
        if (!list.length) return Site.toast('Nobody to message', 'info');
        const single = list.length === 1;
        const log = {}; // studentId → [{hash, by, at}]
        (await recentSent(list.map(s => s.studentId))).forEach(e => (log[e.studentId] ||= []).push(e));
        let skipSent = store.get('wa_skip_sent', '1') === '1';
        let i = 0, cur = null, opened = 0, skipped = 0;
        const close = Site.sheet({ iconName: 'whatsapp', title, subtitle: '', html: '<div id="waBody"><div class="skel" style="height:220px;border-radius:14px"></div></div>' });
        const overlay = [...document.querySelectorAll('.overlay')].pop();
        const body = () => overlay.querySelector('#waBody');
        const head = (t, sub) => { overlay.querySelector('.sheet-head h3').textContent = t; let p = overlay.querySelector('.sheet-head p'); if (!p) { p = document.createElement('p'); overlay.querySelector('.sheet-head h3').after(p); } p.textContent = sub; };

        async function build(idx) {
            const s = list[idx];
            let text = '';
            try { text = (await makeText(s)) || ''; } catch (e) { text = ''; Site.toast(e.message, 'error'); }
            const hash = text ? await hashText(text) : '';
            const prev = (log[s.studentId] || []).find(e => e.hash === hash);
            return { s, text, hash, prev, href: text ? waHref(s.parentPhone, text) : null };
        }
        async function show(dir = 1) {
            if (i >= list.length) return finish();
            if (i < 0) i = 0;
            body().innerHTML = '<div class="skel" style="height:220px;border-radius:14px"></div>';
            cur = await build(i);
            if (!single && dir > 0 && ((skipSent && cur.prev) || !cur.href)) { skipped++; i++; return show(1); } // nothing to do for this one
            const { s, text, prev, href } = cur, mode = waMode();
            head(single ? title : `${title} · ${i + 1} of ${list.length}`, `${s.firstName} ${s.lastName}${s.parentPhone ? ' · parent ' + s.parentPhone : ''}`);
            body().innerHTML = `
                ${prev ? `<div class="notice warning" style="margin-bottom:10px">${icon('info')}<div>This exact message was already opened by <b>${esc(prev.by || 'staff')}</b> on ${esc(fmtDate(prev.at, true))}.</div></div>` : ''}
                ${!s.parentPhone || !waNumber(s.parentPhone) ? `<div class="notice danger" style="margin-bottom:10px">${icon('alert')}<div>No valid parent phone saved — ${single ? 'add one on the Students page' : 'skipped'}.</div></div>` : ''}
                ${text ? PRE(text) : '<p class="muted">Nothing to send for this student.</p>'}
                <div class="wa-bar">
                    <div class="segmented wa-mode" role="tablist" aria-label="Open in">${Object.entries(WA_MODES).map(([k, v]) => `<button type="button" data-mode="${k}" class="${k === mode ? 'active' : ''}">${v}</button>`).join('')}</div>
                    ${single ? '' : `<label class="check small"><input type="checkbox" id="waSkip" ${skipSent ? 'checked' : ''}> Skip parents who already got this exact message</label>`}
                </div>
                <div class="sheet-actions" style="padding:0;margin-top:12px">
                    ${href ? `<a class="btn btn-wa btn-block" id="waGo" href="${esc(href)}" ${waTarget(mode)}>${icon('whatsapp')}${prev ? 'Open again in WhatsApp' : 'Open in WhatsApp'}${single ? '' : ' & next'} <kbd>Enter</kbd></a>` : ''}
                    ${single ? `<button class="btn btn-ghost btn-block" data-close>Close</button>` : `
                    <div class="wa-nav"><button class="btn btn-ghost" id="waBack" ${i === 0 ? 'disabled' : ''}>${icon('arrowLeft', 'sm')}Back</button>
                        <button class="btn btn-ghost" id="waSkipBtn">Skip ${icon('arrowRight', 'sm')}</button>
                        <button class="btn btn-ghost" data-close>Stop</button></div>`}
                </div>
                ${mode === 'app' && !isPhone() ? '<p class="small muted" style="margin:10px 0 0">Opens WhatsApp Desktop. The first time, your browser asks to allow it — tick "Always allow".</p>' : ''}`;
            body().querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { store.set('wa_mode', b.dataset.mode); show(0); }));
            body().querySelector('#waSkip')?.addEventListener('change', (e) => { skipSent = e.target.checked; store.set('wa_skip_sent', skipSent ? '1' : '0'); });
            body().querySelector('#waBack')?.addEventListener('click', () => { i--; show(-1); });
            body().querySelector('#waSkipBtn')?.addEventListener('click', () => { skipped++; i++; show(1); });
            body().querySelector('#waGo')?.addEventListener('click', (e) => {
                // Desktop app: hand the whatsapp:// link straight to Windows / macOS — no new tab, no wa.me page
                if (waMode() === 'app' && cur && cur.href && cur.href.startsWith('whatsapp:')) { e.preventDefault(); openWhatsAppApp(cur.href); }
                onOpened();
            });
        }
        function onOpened() {
            const c = cur; if (!c || !c.href) return;
            opened++;
            (log[c.s.studentId] ||= []).unshift({ hash: c.hash, by: STAFF && STAFF.name, at: new Date().toISOString() });
            api('/api/messages?action=log', { body: { studentId: c.s.studentId, kind, hash: c.hash } }).catch(() => { });
            if (single) setTimeout(close, 150);
            else { i++; setTimeout(() => show(1), 350); }
        }
        function finish() {
            document.removeEventListener('keydown', onKey, true);
            close();
            Site.toast(single ? 'Opened in WhatsApp' : `Done — ${opened} opened${skipped ? `, ${skipped} skipped` : ''} ✅`, 'success');
        }
        const onKey = (e) => {
            if (!document.body.contains(overlay)) { document.removeEventListener('keydown', onKey, true); return; }
            if (e.target.closest && e.target.closest('input, textarea')) return;
            if (e.key === 'Enter') { const a = body().querySelector('#waGo'); if (a) { e.preventDefault(); a.click(); } }
            else if (!single && e.key === 'ArrowRight') { e.preventDefault(); body().querySelector('#waSkipBtn')?.click(); }
            else if (!single && e.key === 'ArrowLeft') { e.preventDefault(); body().querySelector('#waBack:not([disabled])')?.click(); }
        };
        document.addEventListener('keydown', onKey, true);
        show(1);
    }
    // ---------- Reset a student's devices (max 2 per account) ----------
    async function devicesSheet(student, onDone) {
        let d; try { d = await api(`/api/students?action=devices&studentId=${encodeURIComponent(student.studentId)}`); } catch (e) { return Site.toast(e.message, 'error'); }
        Site.sheet({
            iconName: 'refresh', title: `Reset devices · تصفير الأجهزة`,
            subtitle: `${student.firstName} ${student.lastName} is signed in on ${d.devices.length} of ${d.max} devices. Resetting signs them out everywhere and frees both slots — they sign in again on the devices they use now.`,
            html: d.devices.length ? `<div class="hist-table">${d.devices.map(x => `<div class="hrow"><b>${esc(x.label || 'Device')}</b><span class="small muted">last seen ${esc(fmtDate(x.lastSeen, true))}</span></div>`).join('')}</div>` : '<p class="muted" style="margin:0">No devices registered.</p>',
            actions: [{ label: 'Reset devices', cls: 'btn-danger', onClick: async (close) => {
                try {
                    const r = await api('/api/students?action=reset-devices', { body: { studentId: student.studentId } });
                    close(); Site.toast(`Devices reset (${r.cleared} cleared) ✅`, 'success'); onDone && onDone();
                } catch (e) { Site.toast(e.message, 'error'); }
            } }, { label: 'Cancel', cls: 'btn-ghost' }]
        });
    }

    // Kept for the pages that call them
    const preview = (student, text, title, kind) => sender({ list: [student], makeText: () => text, title, kind });
    const queue = (list, makeText, { title = 'Send', kind = 'other' } = {}) => sender({ list, makeText, title, kind });
    function downloadCsv(name, rows) {
        const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    function gradeSelect(el, value, onChange, { all = false } = {}) {
        el.dataset.ui = 'pills';
        el.innerHTML = (all ? '<option value="all">All grades</option>' : '') + Object.entries(GRADES).map(([k, v]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${v}</option>`).join('');
        if (all && value === 'all') el.value = 'all';
        el.addEventListener('change', (e) => onChange(e.target.value));
    }

    // ---------- Custom pickers that replace the OS <select> look ----------
    // The real <select> stays in the page (hidden) and keeps the value + 'change' events,
    // so page code keeps using select.value / addEventListener('change') as before.
    function enhanceSelect(sel) {
        if (sel.dataset.enhanced) return;
        sel.dataset.enhanced = '1';
        const pills = sel.dataset.ui === 'pills';
        const wrap = document.createElement('div');
        wrap.className = pills ? 'segmented pill-pick' : 'dd';
        if (sel.style.cssText) wrap.style.cssText = sel.style.cssText;
        if (!pills) wrap.style.height = '';
        sel.after(wrap);
        sel.hidden = true; sel.tabIndex = -1;
        const label = sel.getAttribute('aria-label') || '';
        const opts = () => [...sel.options];
        const choose = (value) => {
            if (sel.value === value) { close && close(); return; }
            sel.value = value; sync();
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        };
        let menu = null, btn = null, close = null;
        function sync() {
            if (pills) {
                wrap.setAttribute('role', 'tablist'); wrap.setAttribute('aria-label', label);
                wrap.innerHTML = opts().map(o => `<button type="button" role="tab" data-value="${esc(o.value)}" class="${o.value === sel.value ? 'active' : ''}" aria-selected="${o.value === sel.value}" ${o.disabled || sel.disabled ? 'disabled' : ''}>${esc(o.textContent)}</button>`).join('');
                return;
            }
            const cur = sel.options[sel.selectedIndex];
            if (!btn) {
                wrap.insertAdjacentHTML('afterbegin', `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"><span class="dd-label"></span>${icon('arrowDown', 'sm')}</button>`);
                btn = wrap.firstElementChild;
                wrap.appendChild(sel); // the real select lives inside its picker
            }
            btn.querySelector('.dd-label').textContent = cur ? cur.textContent : '';
            btn.disabled = sel.disabled;
        }
        if (pills) {
            wrap.addEventListener('click', (e) => { const b = e.target.closest('button[data-value]'); if (b && !b.disabled) choose(b.dataset.value); });
        } else {
            const open = () => {
                if (menu || sel.disabled) return;
                menu = document.createElement('div');
                menu.className = 'dd-menu'; menu.setAttribute('role', 'listbox');
                menu.innerHTML = opts().map((o, i) => `<button type="button" role="option" data-opt="${i}" aria-selected="${o.value === sel.value}" class="${o.value === sel.value ? 'on' : ''}" ${o.disabled ? 'disabled' : ''}><span>${esc(o.textContent)}</span>${o.value === sel.value ? icon('check', 'sm') : ''}</button>`).join('');
                wrap.appendChild(menu);
                // open upwards when there's no room below
                const r = wrap.getBoundingClientRect();
                if (r.bottom + Math.min(menu.scrollHeight, 320) > innerHeight - 12 && r.top > innerHeight / 2) menu.classList.add('up');
                requestAnimationFrame(() => menu && menu.classList.add('open'));
                btn.setAttribute('aria-expanded', 'true');
                (menu.querySelector('.on') || menu.querySelector('button:not([disabled])'))?.focus({ preventScroll: true });
                setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
            };
            close = (focusBtn) => {
                if (!menu) return;
                menu.remove(); menu = null;
                btn.setAttribute('aria-expanded', 'false');
                document.removeEventListener('pointerdown', outside, true);
                if (focusBtn) btn.focus({ preventScroll: true });
            };
            const outside = (e) => { if (!wrap.contains(e.target)) close(); };
            wrap.addEventListener('click', (e) => {
                if (e.target.closest('.dd-btn')) { menu ? close() : open(); return; }
                const o = e.target.closest('.dd-menu [data-opt]');
                if (o && !o.disabled) { close(true); choose(sel.options[Number(o.dataset.opt)].value); }
            });
            wrap.addEventListener('keydown', (e) => {
                if (!menu) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && e.target.closest('.dd-btn')) { e.preventDefault(); open(); } return; }
                const items = [...menu.querySelectorAll('button:not([disabled])')];
                const i = items.indexOf(document.activeElement);
                if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
                else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
                else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
                else if (e.key === 'Tab') close();
            });
        }
        // Keep the picker in step when page code changes the select (new options, .value = …, disabled)
        const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        Object.defineProperty(sel, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); sync(); } });
        new MutationObserver(() => sync()).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
        sync();
    }

    window.Admin = {
        boot, api, icon, esc, can, store, GRADES, BRANCHES, fmtPct, levelOf, LEVEL_LABEL, initials, segmented, normalizeDigits,
        toMs, fmtDate, timeLeft, preview, queue, sender, devicesSheet, waHref, waNumber, feature, downloadCsv, gradeSelect, hydrate, enhanceSelect,
        get staff() { return STAFF; }
    };
})();
