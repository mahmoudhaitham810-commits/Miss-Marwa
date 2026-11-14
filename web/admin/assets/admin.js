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
            { key: 'inbox', label: 'Questions · أسئلتي', icon: 'inbox', soon: true },
            teacher ? { key: 'copilot', label: 'AI Co-Pilot', icon: 'sparkles', soon: true } : null,
            { key: 'settings', label: teacher ? 'Settings' : 'My password', icon: 'settings', href: '/admin/settings.html' },
            { key: 'classic', label: 'Classic portal', icon: 'layout', href: '/admin/classic.html' }
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
            <div class="side-user"><img class="avatar" src="${avatar}" alt="" style="object-fit:cover;background:#fff">
                <div class="who"><strong dir="auto">${esc(STAFF.name)}</strong><span>${STAFF.role === 'teacher' ? 'Full access' : 'Assistant'}</span></div>
                <button class="icon-btn" title="Sign out" aria-label="Sign out" data-signout>${icon('logout', 'sm')}</button></div></aside>`;
        const topbar = `<header class="topbar">
                <a class="brand" href="/admin/"><img src="/assets/img/logo-96.png" alt="" width="38" height="38"><div class="brand-text"><strong>${esc(title)}</strong><span>Staff portal</span></div></a>
                <div class="page-title-desktop">${esc(title)}</div>
                <div class="topbar-actions">
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
        Site.init();
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
    // One WhatsApp message: preview it, then open WhatsApp
    function preview(student, text, title) {
        const href = window.ParentMessages ? ParentMessages.waLink(student.parentPhone, text) : null;
        Site.sheet({
            iconName: 'whatsapp', title, subtitle: student.parentPhone ? `Parent: ${student.parentPhone}` : 'No parent phone saved',
            html: PRE(text),
            actions: href ? [{ label: 'Open WhatsApp', icon: 'whatsapp', cls: 'btn-wa', href, external: true }, { label: 'Close', cls: 'btn-ghost' }] : [{ label: 'Close', cls: 'btn-ghost' }]
        });
    }
    // Many messages, one after another (each opened by a tap, so nothing is blocked)
    function queue(list, makeText, { title = 'Send', key = '' } = {}) {
        let sent = {};
        try { sent = JSON.parse(sessionStorage.getItem('sent_' + key) || '{}'); } catch (e) { }
        let i = Math.max(0, list.findIndex(s => !sent[s.studentId]));
        if (!list.length) return Site.toast('Nobody to message', 'info');
        const show = async () => {
            const s = list[i];
            if (!s) { Site.toast('All messages opened ✅', 'success'); return; }
            let text;
            try { text = await makeText(s); } catch (e) { Site.toast(e.message, 'error'); return; }
            const href = s.parentPhone && text ? ParentMessages.waLink(s.parentPhone, text) : null;
            Site.sheet({
                iconName: 'whatsapp', title: `${title} · ${i + 1} of ${list.length}`,
                subtitle: `${s.firstName} ${s.lastName}${s.parentPhone ? ' · ' + s.parentPhone : ' · no parent phone — skip'}${sent[s.studentId] ? ' · already opened' : ''}`,
                html: text ? PRE(text) : '<p class="muted">Nothing to send for this student.</p>',
                actions: [
                    ...(href ? [{ label: 'Open WhatsApp', icon: 'whatsapp', cls: 'btn-wa', href, external: true, onClick: () => { sent[s.studentId] = 1; try { sessionStorage.setItem('sent_' + key, JSON.stringify(sent)); } catch (e) { } } }] : []),
                    { label: i + 1 < list.length ? 'Next student' : 'Finish', cls: 'btn-primary', onClick: (close) => { close(); i++; setTimeout(show, 240); } },
                    { label: 'Stop', cls: 'btn-ghost' }
                ]
            });
        };
        show();
    }
    function downloadCsv(name, rows) {
        const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }
    function gradeSelect(el, value, onChange, { all = false } = {}) {
        el.innerHTML = (all ? '<option value="all">All grades</option>' : '') + Object.entries(GRADES).map(([k, v]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${v}</option>`).join('');
        if (all && value === 'all') el.value = 'all';
        el.addEventListener('change', (e) => onChange(e.target.value));
    }

    window.Admin = {
        boot, api, icon, esc, can, store, GRADES, BRANCHES, fmtPct, levelOf, LEVEL_LABEL, initials, segmented, normalizeDigits,
        toMs, fmtDate, timeLeft, preview, queue, downloadCsv, gradeSelect, hydrate,
        get staff() { return STAFF; }
    };
})();
