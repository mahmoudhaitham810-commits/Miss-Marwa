/* =====================================================================
   TutorChat — the students' "Miss Marwa AI Assistant" chat.
   Used by /assistant.html (students, once it's opened) AND /admin/tutor-preview.html (staff Preview),
   so staff test exactly what students will get.
   TutorChat.mount(rootEl, { as: 'MM-…' (Preview only), toast(msg, kind) })
   Needs /assets/ai-kit.js and /assets/ai-robot.js (the robot, the introduction, the guide, the credits meter).
   ===================================================================== */
(function () {
    const { md, esc, composer } = window.AiKit;
    const AVATAR = '/assets/img/marwa-160.png';
    const R = window.AiRobot;
    // the robot's face in a navy disc — Pro (cyan) or Mini (teal); the photo only if ai-robot.js didn't load
    const robot = (tier, size, cls) => R ? `<span class="${cls} tc-bot${tier === 'free' ? ' mini' : ''}" style="--s:${size}px" aria-hidden="true">${R.head(Math.round(size * .74), tier === 'free' ? 'mini' : 'pro')}</span>` : `<img class="${cls}" src="${AVATAR}" alt="">`;
    // 27 Nov 2026 (Mahmoud): the robot only in the header next to the name — every reply shows Miss Marwa's photo, as if she answers herself
    const bot = (tier, size, cls = 'av') => cls === 'av' ? `<img class="av" src="${AVATAR}" alt="">` : robot(tier, size, cls);
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
    .tc-bot { display: inline-grid; place-items: center; flex: none; width: var(--s); height: var(--s); border-radius: 50%; padding: 0 !important; border: 0 !important;
        background: radial-gradient(circle at 32% 28%, #1E4E8C 0%, #0F2A52 50%, #0B1630 100%) !important; box-shadow: 0 0 0 1.5px rgba(34, 211, 238, .75), 0 6px 14px -8px rgba(8, 145, 178, .7); }
    .tc-bot.mini { box-shadow: 0 0 0 1.5px rgba(139, 92, 246, .7), 0 6px 14px -8px rgba(109, 40, 217, .6); }
    .tc-msg .tc-bot { width: 34px; height: 34px; }
    .tc-hello .air, .tc-lock .air { margin: 0 auto; }
    .tc-head .gb { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; font: inherit; font-size: 13px; font-weight: 700; padding: 8px 11px; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 6px; }
    .tc-head .gb:hover, .tc-head .nb:hover { border-color: var(--primary); }
    .tc-trial { display: flex; align-items: center; gap: 10px; border-radius: 14px; padding: 9px 12px; margin-bottom: 8px; font-size: 13px; color: #E6F6FF; background: linear-gradient(135deg, #0F2A52, #163B70); }
    .tc-trial b { color: #67E8F9; } .tc-trial > span { flex: 1; min-width: 0; line-height: 1.45; } .tc-trial small { display: block; font-size: 12.5px; color: #CFE3F5; text-align: start; }
    .tc-trial .air { flex: none; }
    @media (max-width: 520px) { .tc-head .gb span { display: none; } .tc-head .gb { padding: 8px 9px; } .tc-head strong { font-size: 15px; } }
    .tc-trial button { border: 1px solid rgba(103, 232, 249, .45); background: transparent; color: #E6F6FF; border-radius: 99px; padding: 5px 10px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; flex: none; }
    .tc-subcard { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 10px; padding: 12px 14px; border-radius: 16px; color: #E6F6FF; background: radial-gradient(120% 160% at 0% 0%, #1B3A6E, #0B1A36 60%); }
    .tc-subcard .tx { flex: 1 1 200px; font-size: 13.5px; line-height: 1.6; } .tc-subcard b { color: #fff; }
    .tc-subcard button { border: 0; border-radius: 12px; padding: 9px 14px; font: inherit; font-size: 13px; font-weight: 800; color: #071128; background: linear-gradient(135deg, #67E8F9, #A5F3FC); cursor: pointer; }
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
    .tc-meta { font-size: 11.5px; color: var(--muted); margin-top: 6px; padding-inline-start: 4px; display: flex; align-items: center; gap: 6px; }
    /* copy — like the big AI apps: always on the latest answer, on hover for the others (always on phones) */
    .tc-cp { border: 0; background: transparent; color: var(--muted); width: 30px; height: 30px; border-radius: 9px; display: inline-grid; place-items: center; cursor: pointer; opacity: 0; transition: opacity .15s, background .15s; }
    .tc-cp:hover { background: var(--surface-2, #f1f5f9); color: var(--text); } .tc-cp.ok { color: var(--success, #16a34a); opacity: 1; }
    .tc-msg:hover .tc-cp, .tc-msg.last .tc-cp, .tc-cp:focus-visible { opacity: 1; }
    @media (hover: none) { .tc-cp { opacity: 1; } }
    .tc-msg.me .col { position: relative; } .tc-msg.me .tc-cp { align-self: flex-end; margin-top: 2px; }
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
        const s = document.createElement('script'); s.src = '/admin/assets/studio-render.js?v=20261122h';
        s.onload = () => window.StudioRender ? res() : rej(new Error('PDF tool did not load'));
        s.onerror = () => { rendererP = null; s.remove(); rej(new Error('PDF tool did not load')); };
        document.head.appendChild(s);
    }));
    async function summaryPdf(c, btn) {   // the studio's summary template (term boxes, G.R, arrows, tables) → the branded PDF
        const label = btn.innerHTML; btn.disabled = true; btn.textContent = '…';
        try {
            await loadRenderer();
            const doc = { kind: 'summary', grade: c.grade, content: c.content, title: c.title };
            await StudioRender.download(StudioRender.summaryHtml(doc), c.title, { mark: c.by !== 'marwa' });   // her own summary: no AI mark
        } finally { btn.disabled = false; btn.innerHTML = label; }
    }
    async function solutionsPdf(c, btn) {
        const label = btn.innerHTML; btn.disabled = true; btn.textContent = '…';
        try {
            await loadRenderer();
            const doc = { kind: 'solutions', grade: c.grade, content: c.content, title: c.content.title };
            await StudioRender.download(StudioRender.solutionsHtml(doc), c.content.title, { mark: true });   // students: always the AI mark
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

        root.innerHTML = `<div class="tc tc-pad"><div class="tc-head">${bot('pro', 46, 'hb')}<div class="t"><strong>Miss Marwa AI Assistant</strong><small id="tcSub">…</small></div><button class="gb" id="tcGuide" title="Guide & limits" aria-label="Guide and limits"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16.5v-5M12 7.8v.2"/></svg><span>Guide</span></button><button class="nb" id="tcNew">+ New chat</button></div>
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
            // 28 Nov: the full lesson summary in Miss Marwa's style → the studio's PDF (her own when she made one)
            lessonpdf: (c) => { const k = 'l' + (++solSeq); SOLS[k] = c; const L = (c.content.lessons || [])[0] || { blocks: [] }, B = L.blocks || [], n = (t) => B.filter(b => b.t === t).length;
                return `<div class="tc-solcard tc-sumcard" dir="rtl"><div><b dir="auto">📄 ${esc(c.title)}</b><small>${c.by === 'marwa' ? 'ملخص مس مروة نفسها ✨ · ' : 'بأسلوب مس مروة · '}${n('term')} تعريف · ${n('reason')} G.R · ${n('section')} أجزاء</small></div><button class="btn btn-primary btn-sm" data-lsum="${k}">⬇️ نزّل الـ PDF</button></div>`; },
            next: (c) => `<div class="tc-next" dir="rtl"><button data-next="quiz" data-u="${c.unit}" data-l="${c.lesson}">🧪 يلا نحل أسئلة عليه</button><button data-next="pdf" data-u="${c.unit}" data-l="${c.lesson}">📄 الملخص الكامل PDF</button><button data-next="explain" data-u="${c.unit}" data-l="${c.lesson}">🔍 اشرحلي جزء منه</button><button data-next="pick">📘 درس تاني</button></div>`,
            upgrade: (c) => `<div class="tc-card tc-up"><span class="tx" dir="rtl">${md(c.text).replace(/^<p[^>]*>|<\/p>$/g, '')}</span><button class="pro" data-pro>${proReady() ? '✨ اسأل Pro' : '✨ Pro · قريب'}</button></div>`
        };
        const cardsHTML = (cards) => cards && cards.length ? `<div class="tc-cards">${cards.map(c => (CARD[c.type] || (() => ''))(c)).join('')}</div>` : '';

        function msgHTML(m, i) {
            if (m.role === 'user') { const src = m.imgUrl || (m.imageId ? q('image') + '&id=' + m.imageId : ''); return `<div class="tc-msg me"><div class="col">${src ? `<img class="shot" src="${esc(src)}" alt="Photo">` : ''}<div class="bubble" dir="auto">${esc(m.text)}</div><button class="tc-cp" data-cp="${i}" title="Copy" aria-label="Copy"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg></button></div></div>`; }
            if (m.role === 'picker') return `<div class="tc-msg">${bot('pro', 34)}<div class="body" style="flex:1 1 auto"><div class="tc-pick"><h5 dir="rtl">📘 تحب نلخص أنهي درس؟</h5>${m.units && m.units.length ? m.units.map(u => `<div class="u">Unit ${u.unit}${u.title ? ' · ' + esc(u.title) : ''}</div><div class="ls">${u.lessons.map(l => `<button data-sum="${u.unit}.${l.lesson}"><b>Lesson ${l.lesson}</b>${l.title ? ' · ' + esc(l.title) : ''}</button>`).join('')}</div>`).join('') : '<p class="muted" dir="rtl" style="margin:0">كتابك لسه بيتجهز 📚 — قريب جداً.</p>'}</div></div></div>`;
            if (m.role === 'typing') return `<div class="tc-msg">${bot(comp ? comp.tier : 'pro', 34)}<div class="body"><span class="tc-dots"><span></span><span></span><span></span></span></div></div>`;
            if (m.role === 'error') return `<div class="tc-msg">${bot(m.tier || 'pro', 34)}<div class="body"><div class="tc-err" dir="auto">${esc(m.text)}${m.retry && i === MSGS.length - 1 ? '<br><button class="btn btn-soft btn-sm" data-retry>جرّب تاني</button>' : ''}</div>${m.sub ? `<div class="tc-subcard" dir="rtl"><span class="tx">${m.sub === 'STUDENT_CAP' ? '<b>رصيد الشهر خلص</b> — بيتجدد أول الشهر الجاي. وMini Assistant المجاني لسه معاك.' : (/^SUB_/.test(m.sub) ? '<b>عايز تكمّل مع Assistant Pro؟</b> جدّد اشتراكك وكمّل مذاكرة معايا ✨ — وMini Assistant المجاني لسه معاك.' : '<b>عايز تكمّل مع Assistant Pro؟</b> اشترك وكمّل مذاكرة معايا ✨ — وMini Assistant المجاني لسه معاك.')}</span><button type="button" data-subscribe="${esc(m.sub)}">${m.sub === 'STUDENT_CAP' ? 'Details' : /^SUB_/.test(m.sub) ? 'Renew' : 'Subscribe'}</button></div>` : ''}${cardsHTML(m.cards)}</div></div>`;
            const isLast = i === MSGS.length - 1;
            const lastPro = isLast && m.tier === 'pro' && !m.error && !(m.cards || []).length && String(m.text || '').length > 260;
            const isSum = /Remember for the exam|🗺️/i.test(String(m.text || ''));
            return `<div class="tc-msg${isLast ? ' last' : ''}">${bot(m.tier || 'pro', 34)}<div class="body"><div class="tc-md">${md(m.text)}</div>${cardsHTML(m.cards)}${lastPro ? `<div class="tc-next" dir="rtl"><button data-next="quiz">🧪 نحل أسئلة عليه</button>${isSum ? '<button data-next="pdf">📄 الملخص الكامل PDF</button>' : ''}<button data-next="explain">🔍 وضّحلي أكتر</button></div>` : ''}<div class="tc-meta"><button class="tc-cp" data-cp="${i}" title="Copy" aria-label="Copy"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg></button><span>${esc(m.error ? 'من المنصة' : (m.brand || 'Mini Assistant'))}</span></div></div></div>`;
        }
        function welcome() {
            const f = ST && ST.student ? ST.student : {};
            const girl = f.gender === 'female';
            const chips = [['sum', '📘 لخصلي درس'], ['quiz', '🧪 يلا نحل أسئلة سوا'], ['explain', `🤓 اشرحلي حاجة ${girl ? 'مش فاهماها' : 'مش فاهمها'}`], ['me', '📊 عامل إيه في درجاتي؟']];
            return `<div class="tc-hello">${R ? R.svg({ size: 92 }) : `<img src="${AVATAR}" alt="">`}<h2 dir="rtl">أهلاً يا ${esc(f.firstName || '')} 👋</h2>
                <p class="tc-ask" dir="rtl">هننجز إيه النهارده؟ 🎯</p>
                <p dir="rtl">أنا مساعد مس مروة — بذاكر معاك من كتابك 📖: ألخصلك درس، نحل أسئلة سوا، أشرحلك أي جزء، أو ابعتلي صورة سؤال 📷</p>
                <div class="tc-chips">${chips.map(([k, c]) => `<button data-go="${k}" dir="rtl">${esc(c)}</button>`).join('')}</div>
</div>`;   // no level / grades cards here (22 Nov) — the student asks, the AI answers
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
                + (ST.inExam ? `<div class="tc-banner">📝 إنت في امتحان دلوقتي — المساعد هيستناك لحد ما تخلّص 😉</div>` : '')
                + trialBanner() + (R && ST.credits ? R.meter(ST.credits) : '');
        }
        // the trial notice (students without a subscription, while the trial runs)
        function trialBanner() {
            const c = ST.credits, t = ST.launch && ST.launch.trial;
            if (ST.preview || !R || !t || ST.subscribed) return '';
            if (c && c.mode === 'trial') return `<div class="tc-trial">${R.head(26)}<span><b>Free trial</b> · ${esc(R.dayEn(t.start))} → ${esc(R.dayEn(t.end))}${c.budget > 0 && c.left / c.budget <= .5 ? '' : `<small>${R.n1(c.left)} of ${R.n1(c.budget)} free credits left · <span dir="rtl">فترة تجريبية مجانية</span></small>`}</span><button type="button" data-subnow>Subscribe</button></div>`;
            return '';
        }
        const setCredits = (c) => { if (ST && c !== undefined) { ST.credits = c; const p = proM(); if (c && p) p.leftPct = c.budget > 0 ? Math.round(c.left / c.budget * 100) : null; sub(); } };
        const SUBS = ['TRIAL_CAP', 'TRIAL_OVER', 'STUDENT_CAP', 'STUDENT_OFF', 'SUB_CAP', 'SUB_EXPIRED'];
        function lockPro(code) {   // Pro just stopped for them (credits / trial) → the composer shows it locked
            const p = proM(); if (!p || !code) return;
            Object.assign(p, { ready: false, locked: true, code });
            if (comp && comp.setModels) comp.setModels(ST.models.map(modelOpt));
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
                if (r.credits !== undefined) setCredits(r.credits);
                if (r.daily && ST) ST.daily = r.daily;
                if (r.daily) { const left = [['images', 'صور'], ['pdfIn', 'ملفات PDF'], ['pdfOut', 'PDF تعملهم']].filter(([k]) => r.daily[k].max > 0 && r.daily[k].used > 0 && r.daily[k].max - r.daily[k].used <= 1)
                    .map(([k, n]) => `${r.daily[k].max - r.daily[k].used === 0 ? 'خلصت' : 'باقيلك 1'} ${n}`); if (left.length) opt.toast(`النهارده: ${left.join(' · ')} — بيرجعوا بكره ✨`, 'info'); }
            } catch (e) {
                const d = e.data || {};
                MSGS = MSGS.filter(m => m.role !== 'typing');
                if (d.threadId) threadId = d.threadId;
                if (d.today && ST) { ST.today = d.today; sub(); }
                const limit = ['DAILY_LIMIT', 'IMAGE_LIMIT', 'POOL_EMPTY', 'BONUS_CLOSED'].includes(d.code);
                const noRetry = ['FILE_LIMIT', 'EXAM_LOCK', 'PRO_LOCKED', 'STUDENT_OFF', 'STUDENT_CAP', 'TRIAL_CAP', 'TRIAL_OVER', 'SUB_CAP', 'SUB_EXPIRED', 'FREE_CLOSED'].includes(d.code);
                if (SUBS.includes(d.code)) { lockPro(d.code); if (ST && ST.credits && d.code !== 'STUDENT_OFF') setCredits(Object.assign({}, ST.credits, { left: 0 })); }
                if (!d.user && !limit) { /* not saved → let them resend */ }
                if (d.code === 'IMAGE_LIMIT' || d.code === 'DAILY_LIMIT' || d.code === 'FILE_LIMIT' || (d.code === 'BONUS_CLOSED' && !d.threadId)) MSGS.pop();   // nothing was sent
                MSGS.push({ role: 'error', text: e.message, retry: !limit && !noRetry, last: { text, image, doc }, sub: SUBS.includes(d.code) && !(ST && ST.preview) ? d.code : null, tier: comp ? comp.tier : 'pro',
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
                MSGS = MSGS.filter(m => m.role !== 'typing'); MSGS.push({ role: 'error', text: e.message, sub: SUBS.includes(d.code) && !(ST && ST.preview) ? d.code : null });
                if (SUBS.includes(d.code)) lockPro(d.code);
            }
            sending = false; comp && comp.setBusy(false); render();
        }
        const lessonName = (u, l) => { const x = (UNITS || []).find(v => v.unit === u); const y = x && x.lessons.find(v => v.lesson === l); return `Unit ${u} · Lesson ${l}${y && y.title ? ' (' + y.title + ')' : ''}`; };
        $('tcMsgs').addEventListener('click', (e) => {
            const sb = e.target.closest('[data-subscribe]');
            if (sb) { if (R) R.subscribe({ code: sb.dataset.subscribe }); return; }
            const cp = e.target.closest('[data-cp]');
            if (cp) {
                const m = MSGS[+cp.dataset.cp]; if (!m) return;
                const plain = String(m.text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,4}\s*/gm, '').trim();
                const done = () => { cp.classList.add('ok'); cp.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'; setTimeout(() => { cp.classList.remove('ok'); cp.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>'; }, 1600); };
                (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(plain) : Promise.reject()).then(done).catch(() => {
                    const ta = document.createElement('textarea'); ta.value = plain; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
                    try { document.execCommand('copy'); done(); } catch (x) { } ta.remove();
                });
                return;
            }
            const sol = e.target.closest('[data-sol]');
            if (sol) { solutionsPdf(SOLS[sol.dataset.sol], sol).catch(err => opt.toast('ماعرفتش أنزّل الـ PDF — جرّب تاني (' + err.message + ')', 'error')); return; }
            const ls = e.target.closest('[data-lsum]');
            if (ls) { summaryPdf(SOLS[ls.dataset.lsum], ls).catch(err => opt.toast('ماعرفتش أنزّل الـ PDF — جرّب تاني (' + err.message + ')', 'error')); return; }
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
                if (k === 'pdf') return send(u ? `اعملي ملخص Unit ${u} Lesson ${l} كامل PDF 📄` : 'اعملي ملخص الدرس ده كامل PDF 📄', null);
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
        $('tcBanner').addEventListener('click', (e) => { if (e.target.closest('[data-guide]')) openGuide(); else if (e.target.closest('[data-subnow]') && R) R.subscribe({}); });
        $('tcGuide').addEventListener('click', () => openGuide());
        function openGuide() {
            if (!R) { opt.toast('حمّل الصفحة تاني 🙏', 'info'); return; }
            if (!ST) return;
            R.guide({ status: ST, daily: ST.daily || null, onIntro: () => openIntro(false) });
        }
        function openIntro(first) {
            if (!R || !ST) return;
            R.intro({ trial: ST.launch && ST.launch.trial ? Object.assign({}, ST.launch.trial, { credits: (ST.credits && ST.credits.mode === 'trial' ? ST.credits.budget : ST.launch.trial.credits) }) : null, subscribed: ST.subscribed,
                onClose: () => { if (first) markSeen('intro'); } });
        }
        function markSeen(what) {
            if (ST && ST.seen) ST.seen[what] = true;
            if (ST && ST.preview) { try { localStorage.setItem('tc_seen_' + what + '_preview', '1'); } catch (x) { } return; }
            api('seen', { what }).catch(() => { });
        }
        $('tcNew').addEventListener('click', async () => {
            try { const r = await api('new', {}); threadId = r.thread.id; MSGS = []; render(false); } catch (e) { opt.toast(e.message, 'error'); }
        });
        async function loadMine() { try { MINE = (await api('mine')).cards; const w = root.querySelector('#tcMine'); if (w) w.innerHTML = cardsHTML(MINE); } catch (e) { } }

        // ---------- Assistant Pro for this student ----------
        const proM = () => (ST && ST.models || []).find(m => m.tier === 'pro') || {};
        const proReady = () => !!proM().ready;
        const proLockedMsg = () => ({ STUDENT_OFF: 'Miss Marwa Assistant Pro جزء من الاشتراك ✨ — كلّم مس مروة عشان تفعّله.', STUDENT_CAP: 'خلص رصيد Pro بتاعك الشهر ده 🙏 — بيتجدد أول الشهر.', TRIAL_CAP: 'خلص رصيد الفترة التجريبية 🙏 — اشترك عشان تكمّل مع Pro ✨', TRIAL_OVER: 'الفترة التجريبية خلصت 🙏 — اشترك عشان تكمّل مع Pro ✨', SUB_CAP: 'خلص رصيد اشتراكك 🙏 — جدّده عشان تكمّل ✨', SUB_EXPIRED: 'اشتراكك خلص 🙏 — جدّده عشان تكمّل ✨' })[proM().code] || 'Miss Marwa Assistant Pro جاي قريب جداً 🚀';
        const modelOpt = (m) => ({ tier: m.tier, name: m.name, ready: m.ready, locked: m.locked, note: m.tier === 'free' ? (m.ready ? 'Free · مجاني' : 'قريب 🚀') : (m.note || 'قريب جداً 🚀') });

        const hint = () => { const h = root.querySelector('#tcHint'); if (h && comp) h.textContent = comp.tier === 'pro' ? 'Miss Marwa Assistant Pro بيجاوب من كتابك 📖 — ولو حاجة مش واضحة اسأل مس مروة 🙂' : 'Mini Assistant ممكن يغلط — راجع المعلومة المهمة مع مس مروة 🙂'; };
        // ---------- start ----------
        (async () => {
            try { ST = await api('status'); }
            catch (e) {
                const d = e.data || {};
                if (d.code === 'NOT_OPEN') { try { sessionStorage.setItem('ai_nav', JSON.stringify({ open: false, at: Date.now() })); } catch (x) { } }   // the menu's "AI Assistant" goes back to "Soon" at once
                root.innerHTML = `<div class="tc-lock">${R ? R.svg({ size: 96 }) : `<img src="${AVATAR}" alt="">`}<h2 dir="rtl" style="margin:10px 0 4px">${d.code === 'NOT_OPEN' ? 'مساعد مس مروة جاي قريب 🚀' : 'مش قادرين نفتح المساعد دلوقتي'}</h2><p class="muted" dir="rtl">${esc(d.code === 'NOT_OPEN' ? 'بنجهزه ليك على أكمل وجه — هيوصلك إشعار أول ما يفتح 🔔' : e.message)}</p>${d.code === 'NOT_OPEN' ? '<p class="muted" style="font-size:13px;margin-top:4px">Miss Marwa AI Assistant · Coming soon</p>' : ''}</div>`;
                return;
            }
            sub();
            comp = composer($('tcComp'), {
                models: ST.models.map(modelOpt),
                tier: !ST.models[0].ready && proReady() ? 'pro' : 'free', placeholder: 'اكتب سؤالك… · Ask anything', maxLength: 2000, pdf: true, photoMax: 1152, photoQuality: 0.8, dropZone: root, voiceKey: 'tutor_voice', toast: opt.toast,
                onSend: ({ text, image, doc }) => send(text, image, doc),
                onTier: () => hint(),
                onLocked: (m) => { if (m && m.tier !== 'free' && SUBS.includes(proM().code) && R && !ST.preview) R.subscribe({ code: proM().code }); else opt.toast(m && m.tier === 'free' ? 'Mini Assistant جاي قريب 🚀' : proLockedMsg(), 'info'); },
                beforeAttach: () => (comp && comp.tier === 'free' && ST.today.images >= ST.today.limits.images ? `مسموح بصورة واحدة في اليوم على Mini Assistant 📷 — ${proReady() ? 'حوّل لـ Miss Marwa Assistant Pro وابعت صور براحتك ✨' : 'Miss Marwa Assistant Pro جاي قريب 🚀'}` : true)
            });
            hint();
            // the introduction — the first time only (any device); "Guide" opens it again
            //   (staff Preview: never by itself — "Guide" → "Show the introduction again" shows it)
            if (R && ST.seen && !ST.preview && !ST.seen.intro) setTimeout(() => openIntro(true), 450);
            try { const t = await api('thread'); threadId = t.thread ? t.thread.id : null; MSGS = t.messages || []; } catch (e) { }
            render(false);
        })();
    }
    window.TutorChat = { mount };
})();
