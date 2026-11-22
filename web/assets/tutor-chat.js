/* =====================================================================
   TutorChat — the students' "Miss Marwa AI Assistant" chat.
   Used by /assistant.html (students, once it's opened) AND /admin/tutor-preview.html (staff Preview),
   so staff test exactly what students will get.
   TutorChat.mount(rootEl, { as: 'MM-…' (Preview only), toast(msg, kind) })
   Needs /assets/ai-kit.js.
   ===================================================================== */
(function () {
    const { md, esc, composer } = window.AiKit;
    const AVATAR = '/assets/img/marwa-160.png';
    const GL = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
    const LEVEL = { excellent: 'ممتاز 🔥', good: 'جيد جداً 👌', average: 'متوسط 🙂', weak: 'محتاج شغل 💪' };
    const pc = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 10) / 10}%`);
    const lvl = (v) => v === null || v === undefined ? '' : v >= 85 ? 'excellent' : v >= 70 ? 'good' : v >= 50 ? 'average' : 'weak';
    const toMs = (v) => { const s = String(v || ''); return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || !/\d:\d/.test(s) ? s : s.replace(' ', 'T') + 'Z').getTime(); };
    function left(t) {
        const ms = toMs(t) - Date.now(); if (!(ms > 0)) return 'closed';
        const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
        return d >= 1 ? (d === 1 ? 'يوم' : d === 2 ? 'يومين' : `${d} أيام`) : h >= 1 ? (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`) : `${Math.max(1, Math.round(ms / 60000))} دقيقة`;
    }

    const CSS = `
    .tc { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; min-height: calc(100dvh - 140px); }
    .tc-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .tc-head img { width: 46px; height: 46px; border-radius: 50%; object-fit: cover; background: #fff; border: 2px solid var(--primary-soft, #e0e7ff); flex: none; }
    .tc-head .t { flex: 1; min-width: 0; }
    .tc-head strong { display: block; font-size: 16px; line-height: 1.2; }
    .tc-head small { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
    .tc-head .nb { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; font: inherit; font-size: 13px; font-weight: 700; padding: 8px 12px; cursor: pointer; flex: none; }
    .tc-msgs { flex: 1; display: flex; flex-direction: column; gap: 14px; padding: 8px 0 12px; }
    .tc-msg { display: flex; gap: 10px; align-items: flex-start; animation: tcin .35s cubic-bezier(.22,1,.36,1); }
    @keyframes tcin { from { opacity: 0; transform: translateY(6px); } }
    .tc-msg .av { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex: none; background: #fff; border: 1.5px solid var(--border); }
    /* AI reply = avatar + its own bubble right next to it (no gap across wide screens); Arabic stays right-aligned inside */
    .tc-msg .body { min-width: 0; flex: 0 1 auto; max-width: min(720px, calc(100% - 42px)); }
    .tc-msg .body:has(.tc-cards) { flex: 1 1 auto; }
    .tc-msg.me { justify-content: flex-end; }
    .tc-msg.me .col { display: flex; flex-direction: column; align-items: flex-end; max-width: 85%; }
    .tc-msg.me .bubble { background: var(--primary); color: #fff; border-radius: 18px 18px 6px 18px; padding: 10px 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; line-height: 1.55; }
    .tc-msg.me .shot { display: block; max-width: min(240px, 66vw); max-height: 240px; border-radius: 16px; margin-bottom: 6px; border: 1px solid var(--border); object-fit: cover; }
    .tc-md { font-size: 15px; line-height: 1.75; overflow-wrap: anywhere; width: fit-content; max-width: 100%; box-sizing: border-box; background: var(--surface); border: 1px solid var(--border); border-radius: 6px 18px 18px 18px; padding: 10px 14px; box-shadow: 0 4px 14px -10px rgba(15, 23, 42, .35); }
    .tc-md p { margin: 0 0 8px; } .tc-md p:last-child { margin-bottom: 0; }
    .tc-md ul, .tc-md ol { margin: 4px 0 8px; padding-inline-start: 22px; }
    .tc-md h4 { font-size: 15.5px; margin: 10px 0 4px; }
    .tc-md code { background: var(--surface-3, #eef2f7); border-radius: 6px; padding: 1px 5px; font-size: 13px; }
    .tc-md pre { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px; overflow-x: auto; direction: ltr; text-align: left; }
    .tc-md [dir="rtl"] { font-family: 'IBM Plex Sans Arabic', Inter, sans-serif; }
    .tc-meta { font-size: 11.5px; color: var(--muted); margin-top: 6px; padding-inline-start: 4px; }
    .tc-err { border: 1.5px solid color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 8%, var(--surface)); border-radius: 14px; padding: 10px 12px; font-size: 14px; }
    .tc-err button { margin-top: 8px; }
    .tc-dots span { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--primary); margin: 0 2px; animation: tcb 1.2s infinite ease-in-out; }
    .tc-dots span:nth-child(2) { animation-delay: .15s; } .tc-dots span:nth-child(3) { animation-delay: .3s; }
    @keyframes tcb { 0%, 80%, 100% { transform: translateY(0); opacity: .45; } 40% { transform: translateY(-6px); opacity: 1; } }
    .tc-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 10px; }
    .tc-card { border: 1px solid var(--border); background: var(--surface); border-radius: 18px; padding: 14px; min-width: 0; }
    .tc-card h5 { margin: 0 0 8px; font-size: 15px; }
    .tc-big { display: flex; align-items: center; gap: 12px; }
    .tc-big b { font-size: 30px; line-height: 1; }
    .tc-big small { display: block; color: var(--muted); font-size: 12.5px; }
    .tc-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
    .tc-stat { background: var(--surface-2); border-radius: 12px; padding: 8px 10px; min-width: 0; }
    .tc-stat small { display: block; color: var(--muted); font-size: 11px; font-weight: 700; }
    .tc-stat b { display: block; font-size: 17px; }
    .tc-res { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .tc-chip { display: inline-flex; flex-direction: column; padding: 5px 9px; border-radius: 10px; background: var(--surface-2); font-size: 11.5px; max-width: 100%; }
    .tc-chip b { font-size: 13px; } .tc-chip span { color: var(--muted); max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tc .excellent { color: var(--success); } .tc .good { color: var(--primary); } .tc .average { color: var(--warning); } .tc .weak { color: var(--danger); }
    .tc-row { display: flex; gap: 10px; align-items: center; padding: 8px 0; min-width: 0; }
    .tc-row + .tc-row { border-top: 1px solid var(--border); }
    .tc-row .e { font-size: 18px; flex: none; width: 24px; text-align: center; }
    .tc-row .tx { flex: 1; min-width: 0; font-size: 13.5px; }
    .tc-row .tx b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tc-row .tx small { color: var(--muted); }
    .tc-up { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--primary-soft); border-color: transparent; padding: 10px 12px; }
    .tc-up .tx { flex: 1 1 200px; font-size: 13.5px; line-height: 1.6; }
    .tc-up .pro { border: 0; border-radius: 999px; padding: 8px 12px; font: inherit; font-size: 12.5px; font-weight: 800; color: #fff; background: linear-gradient(135deg, var(--primary), #8b5cf6 60%, #ec4899); cursor: pointer; flex: none; }
    .tc-hello { text-align: center; padding: 8px 4px 0; }
    .tc-hello img { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; border: 3px solid var(--primary-soft, #e0e7ff); background: #fff; }
    .tc-hello h2 { margin: 8px 0 4px; font-size: 21px; }
    .tc-hello p { margin: 0 auto; color: var(--muted); max-width: 420px; font-size: 14px; }
    .tc-chips { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-top: 14px; text-align: start; }
    @media (min-width: 560px) { .tc-chips { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .tc-chips button { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 14px; padding: 11px 12px; font: inherit; font-size: 13.5px; text-align: start; cursor: pointer; }
    .tc-chips button:hover { border-color: var(--primary); }
    .tc-comp { position: sticky; bottom: calc(var(--bottomnav-h, 68px) + env(safe-area-inset-bottom, 0px) + 8px); z-index: 5; padding: 10px 0 6px; background: linear-gradient(to top, var(--canvas) 72%, transparent); }
    @media (min-width: 1024px) { .tc-comp { bottom: 0; padding-bottom: 16px; } }
    .tc-pad { padding-bottom: calc(var(--bottomnav-h, 68px) + env(safe-area-inset-bottom, 0px) + 8px); }
    @media (min-width: 1024px) { .tc-pad { padding-bottom: 0; } }
    .tc-hint { font-size: 11px; color: var(--muted); text-align: center; margin: 6px 0 0; background: transparent; }
    .tc-lock { text-align: center; padding: 40px 16px; }
    .tc-lock img { width: 90px; height: 90px; border-radius: 50%; }
    .tc-banner { border-radius: 14px; padding: 10px 12px; font-size: 13.5px; background: var(--warning-soft, #fff7ed); margin-bottom: 8px; }
    .tc-cards > *, .tc-row > * { min-width: 0; }
    /* study companion: next-step buttons + the lesson picker */
    .tc-solcard { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; border: 1.5px solid var(--primary); background: var(--surface); border-radius: 16px; padding: 12px 14px; margin-top: 8px; }
    .tc-solcard small { display: block; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
    .tc-next { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .tc-next button { border: 1px solid var(--primary); background: var(--primary-soft, #eef2ff); color: var(--primary); border-radius: 999px; padding: 7px 12px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    .tc-pick { border: 1px solid var(--border); background: var(--surface); border-radius: 18px; padding: 14px; }
    .tc-pick h5 { margin: 0 0 10px; font-size: 15px; }
    .tc-pick .u { font-size: 12.5px; font-weight: 800; color: var(--muted); margin: 10px 0 6px; }
    .tc-pick .ls { display: grid; gap: 6px; }
    .tc-pick .ls button { text-align: start; border: 1px solid var(--border); background: var(--canvas); color: var(--text); border-radius: 12px; padding: 9px 11px; font: inherit; font-size: 13.5px; cursor: pointer; }
    .tc-pick .ls button:hover { border-color: var(--primary); } .tc-pick .ls button b { color: var(--primary); }
    .tc-ask { font-size: 16px; font-weight: 800; margin: 12px 0 2px; color: var(--text); }
    @media (prefers-reduced-motion: reduce) { .tc-msg, .tc-dots span { animation: none; } }`;


    // the branded PDF maker (same as "Exams & summaries") — loaded only when a PDF is asked for
    let rendererP = null;
    const loadRenderer = () => window.StudioRender ? Promise.resolve() : (rendererP = rendererP || new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = '/admin/assets/studio-render.js?v=20261122f';
        s.onload = () => window.StudioRender ? res() : rej(new Error('PDF tool did not load'));
        s.onerror = () => { rendererP = null; s.remove(); rej(new Error('PDF tool did not load')); };
        document.head.appendChild(s);
    }));
    async function solutionsPdf(c, btn) {
        const label = btn.innerHTML; btn.disabled = true; btn.textContent = '…';
        try {
            await loadRenderer();
            const doc = { kind: 'solutions', grade: c.grade, content: c.content, title: c.content.title };
            await StudioRender.download(StudioRender.solutionsHtml(doc), c.content.title);
        } finally { btn.disabled = false; btn.innerHTML = label; }
    }
    const SOLS = {}; let solSeq = 0;
    function mount(root, opt) {
        opt = Object.assign({ as: null, toast: (m) => alert(m) }, opt || {});
        if (!document.getElementById('tc-css')) { const s = document.createElement('style'); s.id = 'tc-css'; s.textContent = CSS; document.head.appendChild(s); }
        const q = (a) => '/api/tutor?action=' + a + (opt.as ? '&as=' + encodeURIComponent(opt.as) : '');
        async function api(a, body) {
            const r = await fetch(q(a), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { const e = new Error(d.error || 'حصلت مشكلة'); e.status = r.status; e.data = d; throw e; }
            return d;
        }
        let ST = null, MSGS = [], threadId = null, sending = false, MINE = null, comp = null;

        root.innerHTML = `<div class="tc tc-pad"><div class="tc-head"><img src="${AVATAR}" alt=""><div class="t"><strong>Miss Marwa AI Assistant</strong><small id="tcSub">…</small></div><button class="nb" id="tcNew">+ New chat</button></div>
            <div id="tcBanner"></div><div class="tc-msgs" id="tcMsgs" aria-live="polite"></div>
            <div class="tc-comp"><div id="tcComp"></div><p class="tc-hint" id="tcHint">Mini Assistant ممكن يغلط — راجع المعلومة المهمة مع مس مروة 🙂</p></div></div>`;
        const $ = (id) => root.querySelector('#' + id);

        // ---------- cards (exact data from the platform) ----------
        const CARD = {
            me(c) {
                const s = c.summary, tr = c.trend === 'up' ? '📈 طالع' : c.trend === 'down' ? '📉 نازل شوية' : c.trend === 'steady' ? '➡️ ثابت' : '';
                return `<div class="tc-card tc-mecard"><h5>📊 مستواك</h5>
                    <div class="tc-big"><b class="${lvl(s.combinedPct)}">${pc(s.combinedPct)}</b><div><small>${s.level ? LEVEL[s.level] : 'لسه محتاجين امتحانات أكتر'}</small><small>${tr}</small></div></div>
                    <div class="tc-stats"><div class="tc-stat"><small>Center</small><b>${pc(s.centerPct)}</b></div><div class="tc-stat"><small>Online</small><b>${pc(s.onlinePct)}</b></div><div class="tc-stat"><small>Rank</small><b>${s.rank ? '#' + s.rank : '—'}</b><small>${s.rank ? 'of ' + s.gradeSize : ''}</small></div></div>
                    ${c.recent && c.recent.length ? `<div class="tc-res">${c.recent.map(r => `<span class="tc-chip"><b class="${lvl(r.pct)}">${pc(r.pct)}</b><span dir="auto">${esc(r.name)}</span></span>`).join('')}</div>` : ''}</div>`;
            },
            todo(c) {
                const rows = c.openExams.map(o => `<div class="tc-row"><span class="e">⏰</span><div class="tx"><b dir="auto">${esc(o.name)}</b><small>${o.status === 'in-progress' ? 'بدأته ولسه مخلصتوش' : 'باقي ' + left(o.expiresAt)}</small></div></div>`).join('');
                return `<div class="tc-card tc-todocard"><h5>📝 امتحانات مستنياك</h5>${rows || '<p style="margin:0">مفيش امتحانات مفتوحة دلوقتي 🎉</p>'}
                    ${c.missed && c.missed.length ? `<p style="margin:8px 0 0;font-size:13px;color:var(--muted)">فاتك: <span dir="auto">${c.missed.map(m => esc(m.name)).join('، ')}</span></p>` : ''}
                    ${c.openExams.length ? `<a class="btn btn-primary btn-sm" style="margin-top:10px" href="/exams.html">روح للامتحانات</a>` : ''}</div>`;
            },
            lessons(c) {
                const rows = c.lessons.slice(0, 5).map(l => `<div class="tc-row"><span class="e">${/video/i.test(l.category) ? '🎬' : '📄'}</span><div class="tx"><b dir="auto">${esc(l.title)}</b><small>${esc(l.category)} · ${esc(l.at)}</small></div></div>`).join('');
                return `<div class="tc-card tc-lescard"><h5>📚 آخر الدروس في ${esc(c.gradeLabel)}</h5>${rows || '<p style="margin:0">مفيش دروس جديدة لسه</p>'}${rows ? '<a class="btn btn-soft btn-sm" style="margin-top:10px" href="/lessons.html">افتح الدروس</a>' : ''}</div>`;
            },
            solutions: (c) => { const k = 's' + (++solSeq); SOLS[k] = c; return `<div class="tc-solcard" dir="rtl"><div><b dir="auto">📄 ${esc(c.content.title)}</b><small>${c.content.items.length} سؤال — كل سؤال وتحته حله بالتفصيل</small></div><button class="btn btn-primary btn-sm" data-sol="${k}">⬇️ نزّل الـ PDF</button></div>`; },
            next: (c) => `<div class="tc-next" dir="rtl"><button data-next="quiz" data-u="${c.unit}" data-l="${c.lesson}">🧪 يلا نحل أسئلة عليه</button><button data-next="explain" data-u="${c.unit}" data-l="${c.lesson}">🔍 اشرحلي جزء منه</button><button data-next="pick">📘 درس تاني</button></div>`,
            upgrade: (c) => `<div class="tc-card tc-up"><span class="tx" dir="rtl">${md(c.text).replace(/^<p[^>]*>|<\/p>$/g, '')}</span><button class="pro" data-pro>${proReady() ? '✨ اسأل Pro' : '✨ Pro · قريب'}</button></div>`
        };
        const cardsHTML = (cards) => cards && cards.length ? `<div class="tc-cards">${cards.map(c => (CARD[c.type] || (() => ''))(c)).join('')}</div>` : '';

        function msgHTML(m, i) {
            if (m.role === 'user') { const src = m.imgUrl || (m.imageId ? q('image') + '&id=' + m.imageId : ''); return `<div class="tc-msg me"><div class="col">${src ? `<img class="shot" src="${esc(src)}" alt="Photo">` : ''}<div class="bubble" dir="auto">${esc(m.text)}</div></div></div>`; }
            if (m.role === 'picker') return `<div class="tc-msg"><img class="av" src="${AVATAR}" alt=""><div class="body" style="flex:1 1 auto"><div class="tc-pick"><h5 dir="rtl">📘 تحب نلخص أنهي درس؟</h5>${m.units && m.units.length ? m.units.map(u => `<div class="u">Unit ${u.unit}${u.title ? ' · ' + esc(u.title) : ''}</div><div class="ls">${u.lessons.map(l => `<button data-sum="${u.unit}.${l.lesson}"><b>Lesson ${l.lesson}</b>${l.title ? ' · ' + esc(l.title) : ''}</button>`).join('')}</div>`).join('') : '<p class="muted" dir="rtl" style="margin:0">كتابك لسه بيتجهز 📚 — قريب جداً.</p>'}</div></div></div>`;
            if (m.role === 'typing') return `<div class="tc-msg"><img class="av" src="${AVATAR}" alt=""><div class="body"><span class="tc-dots"><span></span><span></span><span></span></span></div></div>`;
            if (m.role === 'error') return `<div class="tc-msg"><img class="av" src="${AVATAR}" alt=""><div class="body"><div class="tc-err" dir="auto">${esc(m.text)}${m.retry && i === MSGS.length - 1 ? '<br><button class="btn btn-soft btn-sm" data-retry>جرّب تاني</button>' : ''}</div>${cardsHTML(m.cards)}</div></div>`;
            const lastPro = i === MSGS.length - 1 && m.tier === 'pro' && !m.error && !(m.cards || []).length && String(m.text || '').length > 260;
            return `<div class="tc-msg"><img class="av" src="${AVATAR}" alt=""><div class="body"><div class="tc-md">${md(m.text)}</div>${cardsHTML(m.cards)}${lastPro ? `<div class="tc-next" dir="rtl"><button data-next="quiz">🧪 نحل أسئلة عليه</button><button data-next="explain">🔍 وضّحلي أكتر</button></div>` : ''}<div class="tc-meta">${esc(m.error ? 'من المنصة' : (m.brand || 'Mini Assistant'))}</div></div></div>`;
        }
        function welcome() {
            const f = ST && ST.student ? ST.student : {};
            const girl = f.gender === 'female';
            const chips = [['sum', '📘 لخصلي درس'], ['quiz', '🧪 يلا نحل أسئلة سوا'], ['explain', `🤓 اشرحلي حاجة ${girl ? 'مش فاهماها' : 'مش فاهمها'}`], ['me', '📊 عامل إيه في درجاتي؟']];
            return `<div class="tc-hello"><img src="${AVATAR}" alt=""><h2 dir="rtl">أهلاً يا ${esc(f.firstName || '')} 👋</h2>
                <p class="tc-ask" dir="rtl">هننجز إيه النهارده؟ 🎯</p>
                <p dir="rtl">أنا مساعد مس مروة — بذاكر معاك من كتابك 📖: ألخصلك درس، نحل أسئلة سوا، أشرحلك أي جزء، أو ابعتلي صورة سؤال 📷</p>
                <div class="tc-chips">${chips.map(([k, c]) => `<button data-go="${k}" dir="rtl">${esc(c)}</button>`).join('')}</div>
                <div id="tcMine">${MINE ? cardsHTML(MINE) : ''}</div></div>`;
        }
        function render(scroll = true) {
            $('tcMsgs').innerHTML = MSGS.length ? MSGS.map(msgHTML).join('') : welcome();
            if (scroll) requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        }
        function sub() {
            if (!ST) return;
            // (no counter line under the title — the user asked for it to be removed; limits are explained only when reached)
            $('tcSub').hidden = true;
            $('tcBanner').innerHTML = (ST.preview ? `<div class="tc-banner">👀 <b>Preview</b> — you're seeing exactly what <b>${esc(ST.student.firstName)}</b> would see. Chats here stay separate from the student's own and use separate daily counters.</div>` : '')
                + (ST.inExam ? `<div class="tc-banner">📝 إنت في امتحان دلوقتي — المساعد هيستناك لحد ما تخلّص 😉</div>` : '');
        }

        async function send(text, image, doc) {
            if (sending) return;
            sending = true; comp && comp.setBusy(true);
            MSGS.push({ role: 'user', text: (text || (doc ? '' : '📷')) + (doc ? `${text ? '\n' : ''}📄 ${doc.name}` : ''), imgUrl: image && image.url });
            MSGS.push({ role: 'typing' }); render();
            try {
                const r = await api('send', { threadId, text, tier: comp ? comp.tier : 'free', image: image ? { mime: image.mime, b64: image.b64 } : null, doc: doc ? { name: doc.name, pages: doc.pages, text: doc.text } : null });
                threadId = r.threadId;
                MSGS = MSGS.filter(m => m.role !== 'typing');
                const u = [...MSGS].reverse().find(m => m.role === 'user'); if (u && r.user) { u.text = r.user.text; u.imageId = r.user.imageId; }
                MSGS.push(r.reply);
                if (r.today && ST) { ST.today = r.today; sub(); }
            } catch (e) {
                const d = e.data || {};
                MSGS = MSGS.filter(m => m.role !== 'typing');
                if (d.threadId) threadId = d.threadId;
                if (d.today && ST) { ST.today = d.today; sub(); }
                const limit = ['DAILY_LIMIT', 'IMAGE_LIMIT', 'POOL_EMPTY', 'BONUS_CLOSED'].includes(d.code);
                const noRetry = ['EXAM_LOCK', 'PRO_LOCKED', 'STUDENT_OFF', 'STUDENT_CAP', 'FREE_CLOSED'].includes(d.code);
                if (!d.user && !limit) { /* not saved → let them resend */ }
                if (d.code === 'IMAGE_LIMIT' || d.code === 'DAILY_LIMIT' || (d.code === 'BONUS_CLOSED' && !d.threadId)) MSGS.pop();   // nothing was sent
                MSGS.push({ role: 'error', text: e.message, retry: !limit && !noRetry, last: { text, image, doc },
                    cards: limit ? [{ type: 'upgrade', text: d.code === 'IMAGE_LIMIT' ? `عايز تبعت صور أكتر وتاخد حل أدق؟ **Miss Marwa Assistant Pro** ${proReady() ? 'معاك 👇' : 'جاي قريب 🚀'}` : `عايز تسأل أكتر من كده؟ **Miss Marwa Assistant Pro** ${proReady() ? 'معاك 👇' : 'جاي قريب 🚀'}`, tier: 'pro' }] : null });
                if (d.code === 'EXAM_LOCK' && ST) { ST.inExam = true; sub(); }
            }
            sending = false; comp && comp.setBusy(false); render();
        }

        // ---------- study companion actions (no AI until the student picks something) ----------
        let UNITS = null;
        async function picker() {
            if (!proReady()) { opt.toast(proLockedMsg(), 'info'); return; }
            if (!UNITS) { try { UNITS = (await api('lessons')).units || []; } catch (e) { opt.toast(e.message, 'error'); return; } }
            MSGS = MSGS.filter(m => m.role !== 'picker'); MSGS.push({ role: 'picker', units: UNITS }); render();
        }
        async function summarize(unit, lesson) {
            if (sending) return;
            sending = true; comp && comp.setBusy(true);
            MSGS = MSGS.filter(m => m.role !== 'picker');
            const L = (UNITS || []).flatMap(u => u.lessons.map(l => ({ ...l, unit: u.unit }))).find(x => x.unit === unit && x.lesson === lesson) || {};
            MSGS.push({ role: 'user', text: `لخصلي Unit ${unit} · Lesson ${lesson}${L.title ? ': ' + L.title : ''} 📘` }); MSGS.push({ role: 'typing' }); render();
            try {
                const r = await api('lessonSummary', { threadId, unit, lesson });
                threadId = r.threadId; MSGS = MSGS.filter(m => m.role !== 'typing'); MSGS.push(r.reply);
            } catch (e) {
                const d = e.data || {}; if (d.threadId) threadId = d.threadId;
                MSGS = MSGS.filter(m => m.role !== 'typing'); MSGS.push({ role: 'error', text: e.message });
            }
            sending = false; comp && comp.setBusy(false); render();
        }
        const lessonName = (u, l) => { const x = (UNITS || []).find(v => v.unit === u); const y = x && x.lessons.find(v => v.lesson === l); return `Unit ${u} · Lesson ${l}${y && y.title ? ' (' + y.title + ')' : ''}`; };
        $('tcMsgs').addEventListener('click', (e) => {
            const sol = e.target.closest('[data-sol]');
            if (sol) { solutionsPdf(SOLS[sol.dataset.sol], sol).catch(err => opt.toast('ماعرفتش أنزّل الـ PDF — جرّب تاني (' + err.message + ')', 'error')); return; }
            const go = e.target.closest('[data-go]');
            if (go) {
                const k = go.dataset.go;
                if (k === 'sum') return picker();
                if (k === 'quiz') { comp && comp.fill('يلا نحل أسئلة سوا على '); return; }
                if (k === 'explain') { comp && comp.fill('اشرحلي '); return; }
                if (k === 'me') return send('عامل إيه في درجاتي؟', null);
            }
            const sm = e.target.closest('[data-sum]'); if (sm) { const [u, l] = sm.dataset.sum.split('.').map(Number); return summarize(u, l); }
            const nx = e.target.closest('[data-next]');
            if (nx) {
                const k = nx.dataset.next, u = +nx.dataset.u, l = +nx.dataset.l;
                if (k === 'pick') return picker();
                if (comp && comp.tier !== 'pro' && proReady()) { comp.setTier('pro'); hint(); }
                if (k === 'quiz') return send(u ? `يلا نحل أسئلة سوا على ${lessonName(u, l)} 🧪` : 'يلا نحل سؤالين سوا على الكلام ده 🧪', null);
                if (k === 'explain') { comp && comp.fill(u ? `اشرحلي أكتر في ${lessonName(u, l)} جزء ` : 'وضّحلي أكتر جزء '); return; }
            }
            const c = e.target.closest('[data-chip]'); if (c) { comp && comp.fill(c.dataset.chip.replace(/\s*[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?$/u, '')); return; }
            if (e.target.closest('[data-pro]')) {
                if (!proReady()) { opt.toast(proLockedMsg(), 'info'); return; }
                comp && comp.setTier('pro'); hint();
                const u = [...MSGS].reverse().find(m => m.role === 'user' && m.text && m.text !== '📷');      // ask the same question again on Pro
                if (u && !sending) send(u.text, null); else opt.toast('اتحولت لـ Miss Marwa Assistant Pro ✨ — اسأل سؤالك', 'success');
                return;
            }
            const r = e.target.closest('[data-retry]');
            if (r) { const last = [...MSGS].reverse().find(m => m.role === 'error'); MSGS = MSGS.filter(m => m !== last); const u = MSGS.pop(); if (u && u.role === 'user') send(last.last.text, last.last.image, last.last.doc); }
        });
        $('tcNew').addEventListener('click', async () => {
            try { const r = await api('new', {}); threadId = r.thread.id; MSGS = []; render(false); loadMine(); } catch (e) { opt.toast(e.message, 'error'); }
        });
        async function loadMine() { try { MINE = (await api('mine')).cards; const w = root.querySelector('#tcMine'); if (w) w.innerHTML = cardsHTML(MINE); } catch (e) { } }

        // ---------- Assistant Pro for this student ----------
        const proM = () => (ST && ST.models || []).find(m => m.tier === 'pro') || {};
        const proReady = () => !!proM().ready;
        const proLockedMsg = () => ({ STUDENT_OFF: 'Miss Marwa Assistant Pro جزء من الاشتراك ✨ — كلّم مس مروة عشان تفعّله.', STUDENT_CAP: 'خلص رصيد Pro بتاعك الشهر ده 🙏 — بيتجدد أول الشهر.' })[proM().code] || 'Miss Marwa Assistant Pro جاي قريب جداً 🚀';

        const hint = () => { const h = root.querySelector('#tcHint'); if (h && comp) h.textContent = comp.tier === 'pro' ? 'Miss Marwa Assistant Pro بيجاوب من كتابك 📖 — ولو حاجة مش واضحة اسأل مس مروة 🙂' : 'Mini Assistant ممكن يغلط — راجع المعلومة المهمة مع مس مروة 🙂'; };
        // ---------- start ----------
        (async () => {
            try { ST = await api('status'); }
            catch (e) {
                const d = e.data || {};
                if (d.code === 'NOT_OPEN') { try { sessionStorage.setItem('ai_nav', JSON.stringify({ open: false, at: Date.now() })); } catch (x) { } }   // the menu's "AI Assistant" goes back to "Soon" at once
                root.innerHTML = `<div class="tc-lock"><img src="${AVATAR}" alt=""><h2 dir="rtl" style="margin:10px 0 4px">${d.code === 'NOT_OPEN' ? 'مساعد مس مروة جاي قريب 🚀' : 'مش قادرين نفتح المساعد دلوقتي'}</h2><p class="muted" dir="rtl">${esc(d.code === 'NOT_OPEN' ? 'بنجهزه ليك على أكمل وجه — هيوصلك إشعار أول ما يفتح 🔔' : e.message)}</p>${d.code === 'NOT_OPEN' ? '<p class="muted" style="font-size:13px;margin-top:4px">Miss Marwa AI Assistant · Coming soon</p>' : ''}</div>`;
                return;
            }
            sub();
            comp = composer($('tcComp'), {
                models: ST.models.map(m => ({ tier: m.tier, name: m.name, ready: m.ready, locked: m.locked, note: m.tier === 'free' ? (m.ready ? 'Free · مجاني' : 'قريب 🚀') : (m.note || 'قريب جداً 🚀') })),
                tier: !ST.models[0].ready && proReady() ? 'pro' : 'free', placeholder: 'اكتب سؤالك… · Ask anything', maxLength: 2000, pdf: true, photoMax: 1152, photoQuality: 0.8, dropZone: root, voiceKey: 'tutor_voice', toast: opt.toast,
                onSend: ({ text, image, doc }) => send(text, image, doc),
                onTier: () => hint(),
                onLocked: (m) => opt.toast(m && m.tier === 'free' ? 'Mini Assistant جاي قريب 🚀' : proLockedMsg(), 'info'),
                beforeAttach: () => (comp && comp.tier === 'free' && ST.today.images >= ST.today.limits.images ? `مسموح بصورة واحدة في اليوم على Mini Assistant 📷 — ${proReady() ? 'حوّل لـ Miss Marwa Assistant Pro وابعت صور براحتك ✨' : 'Miss Marwa Assistant Pro جاي قريب 🚀'}` : true)
            });
            hint();
            try { const t = await api('thread'); threadId = t.thread ? t.thread.id : null; MSGS = t.messages || []; } catch (e) { }
            render(false); if (!MSGS.length) loadMine();
        })();
    }
    window.TutorChat = { mount };
})();
