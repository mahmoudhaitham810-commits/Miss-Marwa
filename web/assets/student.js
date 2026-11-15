/* =========================================================
   Science Academy — shared student helpers (window.App)
   Used by home, lessons, exams, exam, exam-results pages.
   Every data call goes to the same /api endpoints the old
   pages used, so the admin portal stays fully connected.
   ========================================================= */
(function () {
    'use strict';

    // ---------- Session guard ----------
    const params = new URLSearchParams(location.search);
    let session = null;
    try { session = JSON.parse(localStorage.getItem('student_session') || 'null'); } catch (e) { session = null; }
    // The old shared admin login (MM-ADMIN) no longer exists on the student side — drop it
    if (session && (session.role === 'admin' || session.grade === 'all' || String(session.id).toUpperCase() === 'MM-ADMIN')) {
        try { localStorage.removeItem('student_session'); } catch (e) { }
        session = null;
    }
    // Staff "Preview as student" (opened from the teacher portal). The server confirms the
    // staff sign-in below; without it the preview is closed straight away.
    if (params.get('staffPreview') === '1') { try { sessionStorage.setItem('staff_preview', '1'); } catch (e) { } }
    let staffPreview = false;
    try { staffPreview = !session && sessionStorage.getItem('staff_preview') === '1'; } catch (e) { }
    if (staffPreview) session = { id: 'PREVIEW', firstName: 'Preview', lastName: '', grade: 'all', role: 'admin' };
    if (!session || !session.id) {
        window.location.replace('/login.html');
        return;
    }
    if (staffPreview) {
        fetch('/api/admin-auth?action=me', { credentials: 'same-origin' })
            .then(r => r.json()).then(d => {
                if (!d || !d.authenticated) {
                    try { sessionStorage.removeItem('staff_preview'); } catch (e) { }
                    location.replace('/admin/login.html');
                }
            }).catch(() => { });
    }

    const GRADES = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
    const GRADES_AR = { prep1: 'أولى إعدادي', prep2: 'تانية إعدادي', prep3: 'تالتة إعدادي', sec1: 'أولى ثانوي' };
    const isAdmin = staffPreview;

    // Students always see their own grade. The admin (Miss Marwa) can preview any grade with ?grade=
    let grade = String(session.grade || '').toLowerCase();
    if (isAdmin) {
        grade = String(params.get('grade') || sessionStorage.getItem('preview_grade') || 'prep1').toLowerCase();
        if (!GRADES[grade]) grade = 'prep1';
        sessionStorage.setItem('preview_grade', grade);
    }

    // ---------- Small utilities ----------
    function esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ''));
    // dir="auto" lets Arabic titles render right-to-left inside the English layout
    const txt = (s) => `<span dir="auto">${esc(s)}</span>`;

    const ICONS = {
        plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
        mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
        inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
        book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
        clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
        help: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
        flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
        play: '<path d="M7 4v16l13-8z"/>',
        video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8z"/>',
        file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
        x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
        clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        chevronRight: '<path d="m9 18 6-6-6-6"/>',
        chevronLeft: '<path d="m15 18-6-6 6-6"/>',
        chevronDown: '<path d="m6 9 6 6 6-6"/>',
        arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
        arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
        bot: '<rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 14h.01"/><path d="M15 14h.01"/>',
        award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
        flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
        logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
        copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
        alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
        eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
        star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
        trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
        external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
        chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16v-3"/>',
        wifiOff: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="M12 20h.01"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
        moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
        send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
        hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>'
    };
    function icon(name, cls = '') {
        const fill = name === 'play' ? ' fill' : '';
        return `<svg class="icon ${cls}${fill}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    }

    async function api(path, options = {}) {
        const opts = { ...options };
        if (opts.body && typeof opts.body !== 'string') {
            opts.body = JSON.stringify(opts.body);
            opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        }
        let res;
        try {
            res = await fetch(path, opts);
        } catch (e) {
            const err = new Error('No internet connection. Check your network and try again.');
            err.network = true;
            throw err;
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && data.code === 'STUDENT_SESSION_REQUIRED' && !isAdmin) { sessionEnded(); }
        if (!res.ok) {
            const err = new Error(data.error || `Request failed (${res.status})`);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    // Links keep the preview grade for the admin only
    function url(page, extra = {}) {
        const q = new URLSearchParams(extra);
        if (isAdmin) q.set('grade', grade);
        const s = q.toString();
        return `/${page}${s ? '?' + s : ''}`;
    }

    // ---------- Time & score helpers ----------
    function timeLeft(iso) {
        const ms = new Date(iso).getTime() - Date.now();
        if (!isFinite(ms)) return '';
        if (ms <= 0) return 'Closed';
        const m = Math.floor(ms / 60000);
        const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
        if (d > 0) return `${d}d ${h}h left`;
        if (h > 0) return `${h}h ${mm}m left`;
        return `${Math.max(mm, 1)}m left`;
    }
    function fmtDate(iso, withTime = false) {
        const d = new Date(String(iso || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso)) || String(iso).includes('T') ? '' : 'Z'));
        if (isNaN(d)) return '';
        const opts = { day: 'numeric', month: 'short' };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
        return d.toLocaleString('en-GB', opts);
    }
    // Agreed colour rule: red under 50%, green for full mark or one below, blue otherwise
    function scoreTone(score, total) {
        const s = Number(score) || 0, t = Number(total) || 0;
        if (!t) return 'mid';
        if (s / t < 0.5) return 'bad';
        if (s >= t - 1) return 'good';
        return 'mid';
    }
    const TONE_COLOR = { good: 'var(--success)', bad: 'var(--danger)', mid: 'var(--primary)' };
    function ring(score, total, { size = '', label = '' } = {}) {
        const t = Number(total) || 0, s = Number(score) || 0;
        const pct = t ? Math.max(0, Math.min(1, s / t)) : 0;
        const tone = scoreTone(s, t);
        const C = 2 * Math.PI * 42;
        return `<div class="ring ${size}" data-pct="${pct}">
            <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="42" fill="none" stroke-width="9"/>
            <circle class="value" cx="50" cy="50" r="42" fill="none" style="stroke:${TONE_COLOR[tone]}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}"/></svg>
            <div class="label"><strong class="num">${s}<span style="font-size:.55em;color:var(--faint);font-weight:600">/${t}</span></strong>${label ? `<span>${esc(label)}</span>` : ''}</div>
        </div>`;
    }
    function animateRings(root = document) {
        root.querySelectorAll('.ring[data-pct]:not([data-done])').forEach(el => {
            el.dataset.done = '1';
            const c = el.querySelector('.value');
            const C = parseFloat(c.getAttribute('stroke-dasharray'));
            requestAnimationFrame(() => requestAnimationFrame(() => {
                c.style.strokeDashoffset = (C * (1 - parseFloat(el.dataset.pct))).toFixed(1);
            }));
        });
    }

    // ---------- Viewed content (same storage key as the old pages) ----------
    function viewedList() { try { return JSON.parse(localStorage.getItem('viewedMaterials') || '[]'); } catch (e) { return []; } }
    function isViewed(id) { return viewedList().includes(id); }
    function openLesson(item) {
        const uid = item.id || item.url;
        const list = viewedList();
        if (!list.includes(uid)) { list.push(uid); localStorage.setItem('viewedMaterials', JSON.stringify(list)); }
        try {
            localStorage.setItem('last_opened_' + session.id, JSON.stringify({
                id: item.id, title: item.title, url: item.url, category: item.category, notes: item.notes || '', at: Date.now()
            }));
        } catch (e) { /* storage full or blocked: not important */ }
        if (!isAdmin) {
            fetch('/api/lessons?action=view', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: session.id, contentId: item.id, contentType: item.category || 'unknown' }),
                keepalive: true
            }).catch(() => { });
        }
    }
    function lastOpened() {
        try { return JSON.parse(localStorage.getItem('last_opened_' + session.id) || 'null'); } catch (e) { return null; }
    }
    function safeUrl(u) {
        const s = String(u || '').trim();
        return /^https?:\/\//i.test(s) ? s : '#';
    }

    // ---------- Toast ----------
    function toast(message, type = 'info') {
        let box = document.querySelector('.toasts');
        if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.setAttribute('role', 'status');
        el.innerHTML = `${icon(type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info')}<span dir="auto">${esc(message)}</span>`;
        box.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 3200);
    }

    // ---------- Sheet (bottom sheet on phones, dialog on desktop) ----------
    function sheet({ iconName = 'info', tone = '', title = '', subtitle = '', html = '', actions = [], dismissible = true } = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        const toneStyle = tone === 'danger' ? 'background:var(--danger-soft);color:var(--danger)'
            : tone === 'accent' ? 'background:var(--accent-soft);color:var(--accent)'
                : tone === 'success' ? 'background:var(--success-soft);color:var(--success)' : '';
        overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="grabber"></div>
            <div class="sheet-head">
                <div class="badge-icon" style="${toneStyle}">${icon(iconName)}</div>
                <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
                ${dismissible ? `<button class="icon-btn close" aria-label="Close" data-close>${icon('x', 'sm')}</button>` : ''}
            </div>
            <div class="sheet-body">${html}</div>
            ${actions.length ? `<div class="sheet-actions">${actions.map((a, i) => a.href
            ? `<a class="btn ${a.cls || 'btn-primary'} btn-block" href="${esc(a.href)}" data-i="${i}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</a>`
            : `<button class="btn ${a.cls || 'btn-primary'} btn-block" data-i="${i}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
        </div>`;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => overlay.classList.add('open'));
        const close = () => {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
            document.removeEventListener('keydown', onKey);
            setTimeout(() => overlay.remove(), 220);
        };
        const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => {
            if (dismissible && (e.target === overlay || e.target.closest('[data-close]'))) { close(); return; }
            const btn = e.target.closest('[data-i]');
            if (btn) {
                const a = actions[Number(btn.dataset.i)];
                if (a && a.onClick) { if (!a.href) e.preventDefault(); a.onClick(close, btn); }
                else if (a && !a.href) close();
            }
        });
        return close;
    }

    function soon(feature) {
        sheet({
            iconName: 'sparkles', tone: 'accent',
            title: 'Coming soon',
            subtitle: feature ? `${feature} is on its way.` : 'This feature is on its way.',
            html: `<p class="muted" style="margin:0">We're building this right now. You'll get a notification as soon as it's ready.</p>`,
            actions: [{ label: 'Got it', cls: 'btn-soft' }]
        });
    }

    // ---------- Reveal animations ----------
    let io = null;
    function reveal(root = document) {
        const els = [...root.querySelectorAll('.reveal:not(.in):not([data-obs])')];
        if (!('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('in')); animateRings(root); return; }
        if (!io) {
            io = new IntersectionObserver((entries) => {
                entries.forEach(en => {
                    if (en.isIntersecting) {
                        en.target.classList.add('in');
                        animateRings(en.target);
                        io.unobserve(en.target);
                    }
                });
            }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
        }
        let i = 0;
        els.forEach(el => {
            el.dataset.obs = '1';
            if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', `${Math.min(i++, 8) * 60}ms`);
            io.observe(el);
        });
    }

    // ---------- Streak / check-in ----------
    let checkinPromise = null;
    function checkin() {
        if (checkinPromise) return checkinPromise;
        if (isAdmin) { checkinPromise = Promise.resolve({ currentStreak: 0, longestStreak: 0, badges: [] }); return checkinPromise; }
        checkinPromise = api('/api/auth?action=checkin', { method: 'POST', body: { studentId: session.id } })
            .then(d => {
                const info = { currentStreak: d.currentStreak || 0, longestStreak: d.longestStreak || 0, badges: d.badges || [] };
                try { sessionStorage.setItem('streak_cache', JSON.stringify(info)); } catch (e) { }
                return info;
            })
            .catch(() => {
                try { return JSON.parse(sessionStorage.getItem('streak_cache') || 'null') || { currentStreak: 0, longestStreak: 0, badges: [] }; }
                catch (e) { return { currentStreak: 0, longestStreak: 0, badges: [] }; }
            });
        return checkinPromise;
    }

    // Ask the server in the background whether this account still exists (deleted accounts are signed out)
    // The server decides who is signed in (HttpOnly cookie). If that session is gone — signed out,
    // password reset, account removed, or a sign-in from before sessions existed — sign in again.
    let ending = false;
    function sessionEnded(reason = 'session') {
        if (ending) return; ending = true;
        const code = session && session.id ? session.id : '';
        try { localStorage.removeItem('student_session'); } catch (e) { }
        location.replace(`/login.html?reason=${reason}` + (code ? '&code=' + encodeURIComponent(code) : ''));
    }
    function validate() {
        if (isAdmin) return;
        api('/api/auth?action=validate', { method: 'POST', body: { studentId: session.id } })
            .then(d => { if (d && d.valid === false) sessionEnded(d.code === 'DEVICE_LIMIT' ? 'devices' : 'session'); })
            .catch(() => { });
    }

    // ---------- Notifications (OneSignal) ----------
    function loadOneSignal() {
        window.OneSignalDeferred = window.OneSignalDeferred || [];
        if (!document.querySelector('script[data-onesignal]')) {
            const s = document.createElement('script');
            s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
            s.defer = true; s.dataset.onesignal = '1';
            document.head.appendChild(s);
        }
        OneSignalDeferred.push(async function (OneSignal) {
            try {
                await OneSignal.init({ appId: 'a5d058a6-b45e-46a5-aa86-014309b7c7d2', notifyButton: { enable: false } });
                OneSignal.Notifications.addEventListener('permissionChange', updateBell);
                // Tag the device with the grade so new-content pushes only reach the right students
                if (!isAdmin && session.grade) await OneSignal.User.addTag('grade', String(session.grade).toUpperCase());
                // so a reply from Miss Marwa can be pushed to this student only
                if (!isAdmin && session.id) await OneSignal.User.addTag('sid', String(session.id));
            } catch (e) { /* notifications are optional */ }
            updateBell();
        });
    }
    function notifPermission() { return typeof Notification !== 'undefined' ? Notification.permission : 'default'; }
    function updateBell() {
        document.querySelectorAll('[data-bell]').forEach(b => {
            const p = notifPermission();
            b.classList.toggle('on', p === 'granted');
            const dot = b.querySelector('.dot');
            if (dot) dot.classList.toggle('hidden', p === 'granted');
        });
    }
    function bellClick() {
        const p = notifPermission();
        if (p === 'granted') {
            sheet({ iconName: 'bell', tone: 'success', title: 'Notifications are on', subtitle: "You'll be notified about new lessons and exams.", actions: [{ label: 'Great', cls: 'btn-soft' }] });
            return;
        }
        if (p === 'denied') {
            sheet({
                iconName: 'bell', tone: 'danger', title: 'Notifications are blocked',
                html: `<p class="muted" style="margin:0">Tap the lock icon next to the website address, choose <b>Notifications → Allow</b>, then reload the page.</p>`,
                actions: [{ label: 'OK', cls: 'btn-soft' }]
            });
            return;
        }
        sheet({
            iconName: 'bell', title: 'Turn on notifications',
            subtitle: 'Never miss a new exam or lesson.',
            actions: [
                {
                    label: 'Turn on', icon: 'bell', onClick: (close) => {
                        close();
                        (window.OneSignalDeferred = window.OneSignalDeferred || []).push(async (OneSignal) => {
                            try { await OneSignal.Notifications.requestPermission(); } catch (e) { }
                            updateBell();
                        });
                    }
                },
                { label: 'Not now', cls: 'btn-ghost' }
            ]
        });
    }

    // ---------- Theme (light / dark) ----------
    // The <head> of every page applies the saved theme before first paint (no flash);
    // this just switches it and remembers the choice.
    function currentTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
    function setTheme(t) {
        const root = document.documentElement;
        root.classList.add('theme-anim');
        if (t === 'dark') root.dataset.theme = 'dark'; else delete root.dataset.theme;
        try { localStorage.setItem('theme', t); } catch (e) { }
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0B1220' : '#F4F7FC');
        document.querySelectorAll('[data-theme-state]').forEach(el => { el.textContent = t === 'dark' ? 'Dark' : 'Light'; });
        setTimeout(() => root.classList.remove('theme-anim'), 350);
    }
    function toggleTheme() { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }
    if (currentTheme() === 'dark') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0B1220');

    // ---------- Profile ----------
    function profile() {
        const full = `${session.firstName || ''} ${session.lastName || ''}`.trim();
        sheet({
            iconName: 'user', title: full || 'My account', subtitle: `${GRADES[grade] || ''} · ${GRADES_AR[grade] || ''}`,
            html: `
                <div class="id-card"><div><span>Student code</span><strong class="num">${esc(session.id)}</strong></div>
                    <button class="btn btn-sm btn-ghost" id="copyCode">${icon('copy', 'sm')}Copy</button></div>
                <p class="xs muted" style="margin:8px 2px 12px">You sign in with this code. Keep it safe.</p>
                <button class="list-btn" data-install>${icon('download')}Install the app<span class="end ar">حمّل التطبيق</span></button>
                <button class="list-btn" id="pfNotif">${icon('bell')}Notifications<span class="end" id="pfNotifState"></span></button>
                <a class="list-btn" href="${url('exam-results.html')}">${icon('chart')}My results<span class="end">${icon('chevronRight', 'sm')}</span></a>
                <button class="list-btn danger" id="pfLogout">${icon('logout')}Sign out</button>`
        });
        const state = document.getElementById('pfNotifState');
        if (state) state.textContent = { granted: 'On', denied: 'Blocked', default: 'Off' }[notifPermission()] || 'Off';
        document.getElementById('copyCode')?.addEventListener('click', () => {
            navigator.clipboard?.writeText(session.id).then(() => toast('Code copied', 'success')).catch(() => toast(session.id));
        });
        document.getElementById('pfNotif')?.addEventListener('click', () => { document.querySelector('.overlay [data-close]')?.click(); setTimeout(bellClick, 230); });
        document.getElementById('pfLogout')?.addEventListener('click', logout);
    }
    function logout() {
        sheet({
            iconName: 'logout', tone: 'danger', title: 'Sign out?', subtitle: 'You can sign back in any time with your student code.',
            actions: [
                {
                    label: 'Sign out', cls: 'btn-danger', onClick: () => {
                        (window.OneSignalDeferred || []).push?.(async (OneSignal) => { try { await OneSignal.User.removeTag('grade'); } catch (e) { } });
                        if (isAdmin) {
                            sessionStorage.removeItem('staff_preview');
                            sessionStorage.removeItem('preview_grade');
                            setTimeout(() => location.replace('/admin/'), 150);
                            return;
                        }
                        localStorage.removeItem('student_session');
                        sessionStorage.removeItem('preview_grade');
                        fetch('/api/auth?action=logout', { method: 'POST', keepalive: true }).catch(() => { });
                        setTimeout(() => location.replace('/index.html'), 150);
                    }
                },
                { label: 'Cancel', cls: 'btn-ghost' }
            ]
        });
    }

    // ---------- Shell ----------
    function shell({ active = 'home', title = '', notifications = true, bottomNav = true } = {}) {
        const first = session.firstName || 'Student';
        // Arabic first letters (like ا) look like a stray line in a tiny circle, so those get a person icon instead
        const ch = first.trim().charAt(0);
        const initial = /[A-Za-z]/.test(ch) ? esc(ch.toUpperCase()) : icon('user', 'sm');
        const navItems = [
            { key: 'home', label: 'Home', icon: 'home', href: url('home.html') },
            { key: 'lessons', label: 'Lessons', icon: 'book', href: url('lessons.html') },
            { key: 'exams', label: 'Exams', icon: 'clipboard', href: url('exams.html') },
            { key: 'results', label: 'Results', icon: 'chart', href: url('exam-results.html') },
            { key: 'assistant', label: 'AI Assistant', icon: 'bot', soon: true },
            { key: 'questions', label: 'Ask Miss Marwa', icon: 'help', href: url('questions.html') }
        ];
        const gradePicker = isAdmin
            ? `<select id="gradePick" class="chip primary" style="border:0;font:inherit;font-weight:600;cursor:pointer">${Object.keys(GRADES).map(g => `<option value="${g}" ${g === grade ? 'selected' : ''}>Preview: ${GRADES[g]}</option>`).join('')}</select>`
            : `<span class="chip primary">${GRADES[grade] || ''}<span class="ar" style="font-weight:500;opacity:.8">· ${GRADES_AR[grade] || ''}</span></span>`;

        const sidebar = `<aside class="sidebar" aria-label="Main navigation">
            <div>
                <a class="brand" href="${url('home.html')}"><img src="/assets/img/logo-96.png" alt="" width="44" height="44">
                    <div class="brand-text"><strong>Science Academy</strong><span>with Miss Marwa</span></div></a>
                <div class="side-grade">${gradePicker}</div>
                <nav class="side-nav">${navItems.map(n => n.soon
            ? `<button data-soon="${esc(n.label)}" class="${n.key === active ? 'active' : ''}">${icon(n.icon)}${n.label}<span class="soon-tag">Soon</span></button>`
            : `<a href="${n.href}" class="${n.key === active ? 'active' : ''}" ${n.key === active ? 'aria-current="page"' : ''} ${n.key === 'questions' ? 'data-ask-link' : ''}>${icon(n.icon)}${n.label}</a>`).join('')}</nav>
            </div>
            <button class="side-install" data-install>${icon('download', 'sm')}<span>Install the app<small class="ar">حمّل التطبيق</small></span></button>
            <div class="side-user"><div class="avatar">${initial}</div>
                <div class="who"><strong dir="auto">${esc(first)} ${esc(session.lastName || '')}</strong><span class="num">${esc(session.id)}</span></div>
                <button class="icon-btn" title="Sign out" aria-label="Sign out" data-logout>${icon('logout', 'sm')}</button></div>
        </aside>`;

        const topbar = `<header class="topbar">
            <a class="brand" href="${url('home.html')}"><img src="/assets/img/logo-96.png" alt="Science Academy" width="38" height="38">
                <div class="brand-text"><strong>Science Academy</strong><span>with Miss Marwa</span></div></a>
            <div class="page-title-desktop"></div>
            <div class="topbar-actions">
                <span class="streak-chip zero" id="streakChip" title="Daily streak">${icon('flame', 'sm')}<span class="num" id="streakNum">0</span></span>
                <button class="icon-btn topbar-install-icon" data-install aria-label="Install the app" title="Install the app · حمّل التطبيق">${icon('download')}</button>
                <button class="icon-btn theme-btn" data-theme-toggle aria-label="Switch light / dark mode" title="Light / dark mode">${icon('moon', 'moon')}${icon('sun', 'sun')}</button>
                ${notifications ? `<button class="icon-btn" data-bell aria-label="Notifications">${icon('bell')}<span class="dot hidden"></span></button>` : ''}
                <button class="avatar" data-profile aria-label="My account">${initial}</button>
            </div>
        </header>`;

        const bottom = `<nav class="bottomnav" aria-label="Main navigation">
            ${[navItems[0], navItems[1], navItems[2]].map(n => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${icon(n.icon)}<span>${n.label}</span></a>`).join('')}
            <a href="${url('questions.html')}" class="${active === 'questions' ? 'active' : ''}" data-ask-link>${icon('help')}<span>Questions</span></a>
            <button data-profile class="${active === 'profile' ? 'active' : ''}">${icon('user')}<span>Profile</span></button>
        </nav>`;

        document.body.insertAdjacentHTML('afterbegin', sidebar + topbar);
        if (bottomNav) document.body.insertAdjacentHTML('beforeend', bottom);
        else document.body.classList.add('no-bottomnav');
        document.title = `${title ? title + ' · ' : ''}Science Academy`;

        // Red badge on "Ask Miss Marwa" when the team replied
        let askSeq = 0;
        const askBadge = () => { const my = ++askSeq; return api('/api/ask?action=unread').then(d => {
            if (my !== askSeq) return;
            document.querySelectorAll('[data-ask-link] .nav-badge').forEach(b => b.remove());
            if (!d || !d.unread) return;
            document.querySelectorAll('[data-ask-link]').forEach(a => a.insertAdjacentHTML('beforeend', `<span class="nav-badge" aria-label="${d.unread} new replies">${d.unread}</span>`));
            window.dispatchEvent(new CustomEvent('ask-unread', { detail: d.unread }));
        }).catch(() => { }); };
        window.App.refreshAskBadge = askBadge;
        if (!isAdmin) askBadge();

        document.addEventListener('click', (e) => {
            const s = e.target.closest('[data-soon]');
            if (s) { e.preventDefault(); soon(s.dataset.soon); return; }
            if (e.target.closest('[data-profile]')) { profile(); return; }
            if (e.target.closest('[data-logout]')) { logout(); return; }
            if (e.target.closest('[data-bell]')) { bellClick(); return; }
            if (e.target.closest('[data-theme-toggle]')) { toggleTheme(); return; }
        });
        document.getElementById('gradePick')?.addEventListener('change', (e) => {
            sessionStorage.setItem('preview_grade', e.target.value);
            const q = new URLSearchParams(location.search); q.set('grade', e.target.value);
            location.search = q.toString();
        });

        const tb = document.querySelector('.topbar');
        const onScroll = () => tb.classList.toggle('scrolled', window.scrollY > 4);
        window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

        checkin().then(info => {
            const chip = document.getElementById('streakChip');
            document.getElementById('streakNum').textContent = info.currentStreak;
            chip.classList.toggle('zero', !info.currentStreak);
            chip.title = `${info.currentStreak}-day streak`;
        });
        validate();
        if (notifications) { loadOneSignal(); updateBell(); }
    }

    // Opening an exam starts the attempt on the server and it can't be reopened,
    // so we always confirm first.
    function confirmStart(exam) {
        const limit = exam.timeLimitMinutes ? `${exam.timeLimitMinutes} min` : 'No timer';
        sheet({
            iconName: 'clipboard', title: 'Ready to start?',
            subtitle: exam.title,
            html: `<div class="meta" style="margin-bottom:12px">
                    <span>${icon('help')}${exam.total} questions</span>
                    <span>${icon('clock')}${limit}</span>
                    <span>${icon('hourglass')}${timeLeft(exam.expiresAt)}</span></div>
                <div class="notice warning">${icon('alert')}<div><b>One attempt only.</b> Once you start, you can't leave and come back. Make sure your internet is stable and stay on the exam page until you submit.</div></div>`,
            actions: [
                { label: "I'm ready — start", icon: 'play', href: `/exam.html?id=${encodeURIComponent(exam.id)}` },
                { label: 'Not now', cls: 'btn-ghost' }
            ]
        });
    }

    // Install-as-app help uses the portal's own sheet + toast
    if (window.PWA) {
        PWA.showHelp = (title, html) => sheet({ iconName: 'download', title, subtitle: 'Open Science Academy straight from your home screen, full screen, like a normal app.', html, actions: [{ label: 'Got it', cls: 'btn-soft' }] });
        PWA.setNotify((msg) => toast(msg, 'success'));
    }
    window.App = {
        confirmStart, setTheme, toggleTheme, currentTheme,
        session, grade, isAdmin, GRADES, GRADES_AR,
        esc, txt, hasArabic, icon, api, url, safeUrl,
        timeLeft, fmtDate, scoreTone, ring, animateRings,
        isViewed, openLesson, lastOpened,
        toast, sheet, soon, reveal, checkin, shell, profile, logout, sessionEnded
    };
})();
