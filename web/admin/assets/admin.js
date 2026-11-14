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
            { key: 'portal', short: 'Students', label: 'Students & exams', icon: 'users', href: '/admin/#students' },
            { key: 'results', label: 'Online results', icon: 'clipboard', href: '/admin/#results' },
            { key: 'grades', short: 'Grades', label: 'Center grades', icon: 'edit', href: '/admin/grades.html' },
            { key: 'analytics', short: 'Analytics', label: 'Analytics', icon: 'trophy', href: '/admin/analytics.html' },
            { key: 'reports', short: 'Reports', label: 'Parent reports', icon: 'whatsapp', href: '/admin/#reports' },
            { key: 'duplicates', label: 'Duplicate accounts', icon: 'merge', href: '/admin/duplicates.html' },
            { key: 'inbox', label: 'Questions · أسئلتي', icon: 'inbox', soon: true },
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
                ${['portal', 'grades', 'analytics', 'reports'].map(k => items.find(i => i.key === k)).map(n => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${icon(n.icon)}<span>${esc(n.short)}</span></a>`).join('')}
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

    window.Admin = {
        boot, api, icon, esc, can, store, GRADES, BRANCHES, fmtPct, levelOf, LEVEL_LABEL, initials, segmented, normalizeDigits,
        get staff() { return STAFF; }
    };
})();
