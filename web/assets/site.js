/* =========================================================
   Science Academy — public pages helper (window.Site)
   Landing, login and sign-up. No login required here.
   ========================================================= */
(function () {
    'use strict';

    const CONTACT = {
        whatsapp: '201003021917',
        whatsappDisplay: '0100 302 1917',
        facebook: 'https://www.facebook.com/profile.php?id=61588022231167'
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

    function esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    const waLink = (text) => `https://wa.me/${CONTACT.whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}`;

    const ICONS = {
        arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
        arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
        check: '<path d="M20 6 9 17l-5-5"/>',
        checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
        x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
        plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
        menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
        moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
        book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
        clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
        play: '<path d="M7 4v16l13-8z"/>',
        file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
        flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
        bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
        chart: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16v-3"/>',
        award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
        clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
        eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        idCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M14 10h4"/><path d="M14 14h4"/>',
        phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
        sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
        bot: '<rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 14h.01"/><path d="M15 14h.01"/>',
        help: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
        graduation: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
        flask: '<path d="M9 3h6"/><path d="M10 3v6.5L4.6 18.2A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-2.8L14 9.5V3"/><path d="M7.5 15h9"/>',
        atom: '<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
        dna: '<path d="M4 2c0 6 16 6 16 12s-16 6-16 8"/><path d="M20 2c0 6-16 6-16 12s16 6 16 8"/><path d="M7 5h10"/><path d="M7 19h10"/><path d="M9 9h6"/><path d="M9 15h6"/>',
        microscope: '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
        building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
        home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
        mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
        copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
        target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
        whatsapp: '<path d="M3 21l1.65-4.8A8.5 8.5 0 1 1 8 19.5L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8a4 4 0 0 1-2.1-2.1l.8-1-1-2L9 9.5z"/>',
        facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
        logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
        layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>'
    };
    function icon(name, cls = '') {
        const fill = name === 'play' ? ' fill' : '';
        return `<svg class="icon ${cls}${fill}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    }
    function hydrateIcons(root = document) {
        root.querySelectorAll('[data-icon]').forEach(el => {
            el.insertAdjacentHTML(el.dataset.iconPos === 'end' ? 'beforeend' : 'afterbegin', icon(el.dataset.icon, el.dataset.iconClass || ''));
            el.removeAttribute('data-icon');
        });
    }

    // ---------- Session ----------
    function getSession() {
        try {
            const s = JSON.parse(localStorage.getItem('student_session') || 'null');
            if (s && (s.role === 'admin' || s.grade === 'all' || String(s.id).toUpperCase() === 'MM-ADMIN')) { localStorage.removeItem('student_session'); return null; }
            return s && s.id ? s : null;
        } catch (e) { return null; }
    }
    function saveSession(student) { localStorage.setItem('student_session', JSON.stringify(student)); }
    function homeUrl(s) { return '/home.html'; }

    // ---------- Theme ----------
    function currentTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
    function setTheme(t) {
        const root = document.documentElement;
        root.classList.add('theme-anim');
        if (t === 'dark') root.dataset.theme = 'dark'; else delete root.dataset.theme;
        try { localStorage.setItem('theme', t); } catch (e) { }
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0B1220' : '#F4F7FC');
        setTimeout(() => root.classList.remove('theme-anim'), 350);
        window.dispatchEvent(new Event('themechange'));
    }
    if (currentTheme() === 'dark') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0B1220');

    // ---------- Toast + sheet (same look as the student app) ----------
    function toast(message, type = 'info') {
        let box = document.querySelector('.toasts');
        if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.style.bottom = '24px'; document.body.appendChild(box); }
        const el = document.createElement('div');
        el.className = `toast ${type}`; el.setAttribute('role', 'status');
        el.innerHTML = `${icon(type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info')}<span dir="auto">${esc(message)}</span>`;
        box.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 3200);
    }
    function sheet({ iconName = 'info', title = '', subtitle = '', html = '', actions = [] } = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
            <div class="grabber"></div>
            <div class="sheet-head"><div class="badge-icon">${icon(iconName)}</div>
                <div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
                <button class="icon-btn close" aria-label="Close" data-close>${icon('x', 'sm')}</button></div>
            <div class="sheet-body">${html}</div>
            ${actions.length ? `<div class="sheet-actions">${actions.map((a, i) => a.href
            ? `<a class="btn ${a.cls || 'btn-primary'} btn-block" href="${esc(a.href)}" ${a.external ? 'target="_blank" rel="noopener"' : ''} data-i="${i}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</a>`
            : `<button class="btn ${a.cls || 'btn-primary'} btn-block" data-i="${i}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
        </div>`;
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => overlay.classList.add('open'));
        const close = () => { overlay.classList.remove('open'); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); setTimeout(() => overlay.remove(), 220); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-close]')) { close(); return; }
            const b = e.target.closest('[data-i]'); if (!b) return;
            const a = actions[Number(b.dataset.i)];
            if (a && a.onClick) { if (!a.href) e.preventDefault(); a.onClick(close); }
            else if (a && !a.href) close();
            else if (a && a.href && a.external) setTimeout(close, 100);
        });
        return close;
    }

    // ---------- Reveal on scroll ----------
    let io = null;
    function reveal(root = document) {
        const els = [...root.querySelectorAll('.reveal:not([data-obs])')];
        if (reduced || !('IntersectionObserver' in window)) { els.forEach(el => { el.classList.add('in'); onShown(el); }); return; }
        io = io || new IntersectionObserver((entries) => {
            entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); onShown(en.target); io.unobserve(en.target); } });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        // stagger siblings that share a parent
        const groups = new Map();
        els.forEach(el => {
            el.dataset.obs = '1';
            const g = groups.get(el.parentElement) || 0;
            if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', `${Math.min(g, 6) * 90}ms`);
            groups.set(el.parentElement, g + 1);
            io.observe(el);
        });
    }
    function onShown(el) {
        el.querySelectorAll('[data-count]').forEach(countUp);
        if (el.matches('[data-count]')) countUp(el);
        el.querySelectorAll('.ring[data-pct]').forEach(r => {
            const c = r.querySelector('.value'); if (!c || r.dataset.done) return; r.dataset.done = 1;
            const C = parseFloat(c.getAttribute('stroke-dasharray'));
            requestAnimationFrame(() => requestAnimationFrame(() => { c.style.strokeDashoffset = (C * (1 - parseFloat(r.dataset.pct))).toFixed(1); }));
        });
    }
    function countUp(el) {
        if (el.dataset.counted) return; el.dataset.counted = 1;
        const target = Number(el.dataset.count), suffix = el.dataset.suffix || '';
        const fmt = (n) => Math.round(n).toLocaleString('en-US') + suffix;
        if (reduced) { el.textContent = fmt(target); return; }
        const dur = 1600, t0 = performance.now();
        const step = (t) => {
            const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
            el.textContent = fmt(target * e);
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    // ---------- Molecule particles (canvas) ----------
    // Calm dots linked by thin lines; the cursor gently pulls nearby dots.
    function particles(canvas, { density = 1, color = null, lineAlpha = 0.18, light = false } = {}) {
        if (!canvas || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        let w = 0, h = 0, dpr = 1, pts = [], raf = 0, visible = true, mouse = { x: -9999, y: -9999 };
        const pickColor = () => color || (light ? '255,255,255' : (currentTheme() === 'dark' ? '134,160,255' : '47,91,234'));
        let rgb = pickColor();
        function resize() {
            const r = canvas.getBoundingClientRect();
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = r.width; h = r.height;
            canvas.width = w * dpr; canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const count = Math.round(Math.min(110, (w * h) / 14000) * density);
            pts = Array.from({ length: count }, () => ({
                x: Math.random() * w, y: Math.random() * h,
                vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28,
                r: Math.random() * 1.8 + .8
            }));
            if (reduced) draw();
        }
        function draw() {
            ctx.clearRect(0, 0, w, h);
            const maxD = Math.min(150, w / 6);
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                if (!reduced) {
                    const dx = mouse.x - p.x, dy = mouse.y - p.y, d = Math.hypot(dx, dy);
                    if (d < 160) { p.x += dx * .006; p.y += dy * .006; }
                    p.x += p.vx; p.y += p.vy;
                    if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
                    if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
                }
                for (let j = i + 1; j < pts.length; j++) {
                    const q = pts[j], d = Math.hypot(p.x - q.x, p.y - q.y);
                    if (d < maxD) {
                        ctx.strokeStyle = `rgba(${rgb},${(1 - d / maxD) * lineAlpha})`;
                        ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
                    }
                }
                ctx.fillStyle = `rgba(${rgb},${light ? .7 : .55})`;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            }
        }
        function loop() { if (visible && !document.hidden) draw(); raf = requestAnimationFrame(loop); }
        resize();
        window.addEventListener('resize', () => { clearTimeout(canvas._rt); canvas._rt = setTimeout(resize, 150); });
        window.addEventListener('themechange', () => { rgb = pickColor(); if (reduced) draw(); });
        const host = canvas.parentElement;
        host.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
        host.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
        if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(canvas);
        if (!reduced) loop();
    }

    // ---------- Pointer effects ----------
    function pointerFx() {
        if (!finePointer || reduced) return;
        // Spotlight follows the cursor inside .spot cards
        document.addEventListener('pointermove', (e) => {
            const card = e.target.closest?.('.spot');
            if (!card) return;
            const r = card.getBoundingClientRect();
            card.style.setProperty('--mx', `${e.clientX - r.left}px`);
            card.style.setProperty('--my', `${e.clientY - r.top}px`);
        }, { passive: true });
        // Gentle 3D tilt
        document.querySelectorAll('.tilt').forEach(el => {
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
                el.style.transform = `perspective(900px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateY(-4px)`;
            });
            el.addEventListener('pointerleave', () => { el.style.transform = ''; });
        });
        // Magnetic buttons
        document.querySelectorAll('.magnetic').forEach(el => {
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                el.style.transform = `translate(${((e.clientX - r.left) / r.width - .5) * 10}px, ${((e.clientY - r.top) / r.height - .5) * 8}px)`;
            });
            el.addEventListener('pointerleave', () => { el.style.transform = ''; });
        });
    }

    // ---------- Header / progress / menu ----------
    function chrome() {
        const header = document.querySelector('.site-header');
        const bar = document.querySelector('.scroll-progress');
        const fab = document.querySelector('.wa-fab');
        let ticking = false;
        const onScroll = () => {
            if (ticking) return; ticking = true;
            requestAnimationFrame(() => {
                const y = window.scrollY, max = document.documentElement.scrollHeight - innerHeight;
                header?.classList.toggle('scrolled', y > 10);
                if (bar) bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
                fab?.classList.toggle('show', y > innerHeight * .6);
                document.querySelectorAll('[data-scroll-line]').forEach(el => {
                    const r = el.getBoundingClientRect();
                    const p = Math.max(0, Math.min(1, (innerHeight * .85 - r.top) / (innerHeight * .5)));
                    el.style.setProperty('--p', p.toFixed(3));
                });
                ticking = false;
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

        const menuBtn = document.querySelector('.menu-btn'), menu = document.querySelector('.mobile-menu');
        if (menuBtn && menu) {
            menuBtn.addEventListener('click', () => {
                const open = menu.classList.toggle('open');
                menuBtn.setAttribute('aria-expanded', open);
                menuBtn.innerHTML = icon(open ? 'x' : 'menu');
            });
            menu.addEventListener('click', (e) => { if (e.target.closest('a')) { menu.classList.remove('open'); menuBtn.innerHTML = icon('menu'); } });
        }
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-theme-toggle]')) setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
            if (e.target.closest('[data-install]')) install();
        });
    }

    // ---------- Install as app (PWA) ----------
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
    async function install() {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            try { await deferredPrompt.userChoice; } catch (e) { }
            deferredPrompt = null;
            return;
        }
        if (matchMedia('(display-mode: standalone)').matches) { toast('The app is already installed', 'success'); return; }
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        sheet({
            iconName: 'download', title: 'Install the app',
            subtitle: 'Open Science Academy straight from your home screen.',
            html: ios
                ? `<ol class="muted" style="margin:0;padding-left:20px;line-height:1.9"><li>Tap the <b>Share</b> button at the bottom of Safari.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol>`
                : `<ol class="muted" style="margin:0;padding-left:20px;line-height:1.9"><li>Open the browser menu (⋮).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>`,
            actions: [{ label: 'Got it', cls: 'btn-soft' }]
        });
    }
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('/OneSignalSDKWorker.js').catch(() => { }));
    }

    // ---------- Arabic digits → English digits (students often type ٠١٢٣) ----------
    function normalizeDigits(s) {
        return String(s || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
    }

    function forgotPassword() {
        sheet({
            iconName: 'lock', title: 'Forgot your password?',
            subtitle: 'Miss Marwa can reset it for you.',
            html: `<p class="muted" style="margin:0">Send a WhatsApp message with your <b>name</b> and <b>student code</b>. You'll get a new password quickly.</p>`,
            actions: [
                { label: 'Message on WhatsApp', icon: 'whatsapp', cls: 'btn-wa', href: waLink('Hello Miss Marwa, I forgot my Science Academy password. My name: … My student code: MM-'), external: true },
                { label: 'Close', cls: 'btn-ghost' }
            ]
        });
    }

    function init() {
        hydrateIcons();
        chrome();
        reveal();
        pointerFx();
    }

    window.Site = {
        CONTACT, waLink, esc, icon, hydrateIcons, getSession, saveSession, homeUrl,
        setTheme, currentTheme, toast, sheet, reveal, particles, normalizeDigits, forgotPassword, install, init, reduced, finePointer
    };
})();
