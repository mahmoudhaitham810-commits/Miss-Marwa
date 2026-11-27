/* =====================================================================
   AiRobot — the face of Miss Marwa Assistant Pro on the student pages (27 Nov 2026, launch).
   One robot, drawn in SVG (no images), the same everywhere:
   • AiRobot.svg({ size, variant: 'pro'|'mini', wave })   the full robot (head + body)
   • AiRobot.head(size)                                     just the head (badges, launcher)
   • AiRobot.intro({ trial, onClose })                      first visit to the assistant: who it is, what it does, Pro vs Mini
   • AiRobot.guide({ status, onIntro, onSubscribe })        "Guide & limits" sheet (credits, Mini today, files, tips)
   • AiRobot.welcome({ trial, firstName, onStart, onClose }) the one-time launch welcome
   • AiRobot.subscribe({ code })                            the "subscribe" sheet (trial over / credits used up)
   • AiRobot.teacher({ text, sub, action })                 Miss Marwa's photo card with a speech bubble (HTML)
   • AiRobot.launcher({ href, lines })                      the small robot in the corner of every student page
   Motion: in and out within a second (transform / opacity only); "reduce motion" → no movement.
   ===================================================================== */
(function () {
    if (window.AiRobot) return;
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
    let uid = 0;
    const AR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DAYS_AR = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
    // "2026-11-28" → "Sat 28 Nov" (a calendar day, no time zone games)
    const dayEn = (d) => { const [y, m, x] = String(d || '').split('-').map(Number); if (!y) return ''; const w = new Date(Date.UTC(y, m - 1, x)).getUTCDay(); return `${DAYS[w]} ${x} ${AR[m - 1]}`; };
    const dayAr = (d) => { const [y, m, x] = String(d || '').split('-').map(Number); if (!y) return ''; return DAYS_AR[new Date(Date.UTC(y, m - 1, x)).getUTCDay()]; };
    const n1 = (v) => { const n = Math.round((Number(v) || 0) * 10) / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); };

    // ---------- the robot ----------
    // ceramic white shell, dark glass visor, cyan eyes that blink, an antenna light; the chest carries the Pro spark
    function svg({ size = 160, variant = 'pro', wave = false, cls = '' } = {}) {
        const i = ++uid, mini = variant === 'mini';
        const eye = mini ? '#5EEAD4' : '#22D3EE', acc = mini ? '#8B5CF6' : '#22D3EE';
        return `<svg class="air ${mini ? 'air-mini' : 'air-pro'} ${wave ? 'air-wave' : ''} ${cls}" viewBox="0 0 120 150" width="${size}" height="${Math.round(size * 1.25)}" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id="airS${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D6E0F0"/></linearGradient>
                <linearGradient id="airV${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16294D"/><stop offset="1" stop-color="#070F22"/></linearGradient>
                <radialGradient id="airG${i}"><stop offset="0" stop-color="${eye}" stop-opacity=".9"/><stop offset="1" stop-color="${eye}" stop-opacity="0"/></radialGradient>
            </defs>
            <ellipse class="air-shadow" cx="60" cy="144" rx="30" ry="4" fill="#0B1630" opacity=".18"/>
            <g class="air-float">
                <g class="air-ant"><line x1="60" y1="24" x2="60" y2="11" stroke="#9FB0CC" stroke-width="3" stroke-linecap="round"/>
                    <circle cx="60" cy="9" r="9" fill="url(#airG${i})" class="air-glow"/><circle cx="60" cy="9" r="4.2" fill="${acc}"/></g>
                <g class="air-arm-l"><path d="M28 98c-9 4-13 13-12 24" fill="none" stroke="url(#airS${i})" stroke-width="10" stroke-linecap="round"/><circle cx="16.5" cy="123" r="5.5" fill="#E6ECF6" stroke="#B8C6DC"/></g>
                <g class="air-arm-r"><path d="M92 98c9 4 13 13 12 24" fill="none" stroke="url(#airS${i})" stroke-width="10" stroke-linecap="round"/><circle cx="103.5" cy="123" r="5.5" fill="#E6ECF6" stroke="#B8C6DC"/></g>
                <rect x="30" y="86" width="60" height="50" rx="22" fill="url(#airS${i})" stroke="#C3CFE2"/>
                <circle cx="60" cy="110" r="11.5" fill="url(#airV${i})"/>
                ${mini ? `<text x="60" y="114" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="800" fill="${eye}">mini</text>`
                : `<path class="air-spark" d="M60 101.5c.8 4.4 2.6 6.2 7 7-4.4.8-6.2 2.6-7 7-.8-4.4-2.6-6.2-7-7 4.4-.8 6.2-2.6 7-7z" fill="${eye}"/>`}
                <rect x="53" y="80" width="14" height="9" rx="3" fill="#9FB0CC"/>
                <circle cx="21" cy="53" r="7" fill="#16294D" stroke="${acc}" stroke-width="1.5"/><circle cx="99" cy="53" r="7" fill="#16294D" stroke="${acc}" stroke-width="1.5"/>
                <rect x="22" y="22" width="76" height="62" rx="24" fill="url(#airS${i})" stroke="#C3CFE2"/>
                <rect x="30" y="35" width="60" height="34" rx="15" fill="url(#airV${i})"/>
                <path d="M36 40c6-3 14-4 22-4" stroke="#FFFFFF" stroke-opacity=".18" stroke-width="2.4" stroke-linecap="round" fill="none"/>
                <g class="air-eyes"><ellipse cx="47" cy="52" rx="5.4" ry="7" fill="${eye}"/><ellipse cx="73" cy="52" rx="5.4" ry="7" fill="${eye}"/></g>
                <circle cx="47" cy="52" r="12" fill="url(#airG${i})" opacity=".55"/><circle cx="73" cy="52" r="12" fill="url(#airG${i})" opacity=".55"/>
                <path d="M53 62.5q7 4 14 0" stroke="${eye}" stroke-width="2" stroke-linecap="round" fill="none" opacity=".75"/>
            </g>
        </svg>`;
    }
    // the head alone, for round badges (fills its box)
    function head(size = 32, variant = 'pro') {
        const i = ++uid, eye = variant === 'mini' ? '#5EEAD4' : '#22D3EE';
        return `<svg class="air air-head" viewBox="16 4 88 84" width="${size}" height="${size}" aria-hidden="true" focusable="false">
            <defs><linearGradient id="airHs${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D6E0F0"/></linearGradient></defs>
            <line x1="60" y1="24" x2="60" y2="13" stroke="#BFD0E8" stroke-width="3.4" stroke-linecap="round"/><circle class="air-glow" cx="60" cy="10.5" r="5" fill="${eye}"/>
            <circle cx="21" cy="53" r="7" fill="#16294D" stroke="${eye}" stroke-width="1.6"/><circle cx="99" cy="53" r="7" fill="#16294D" stroke="${eye}" stroke-width="1.6"/>
            <rect x="22" y="22" width="76" height="62" rx="24" fill="url(#airHs${i})"/>
            <rect x="30" y="35" width="60" height="34" rx="15" fill="#0B1630"/>
            <g class="air-eyes"><ellipse cx="47" cy="52" rx="5.6" ry="7.2" fill="${eye}"/><ellipse cx="73" cy="52" rx="5.6" ry="7.2" fill="${eye}"/></g>
            <path d="M53 62.5q7 4 14 0" stroke="${eye}" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".8"/>
        </svg>`;
    }

    const CSS = `
    .air { display: block; overflow: visible; }
    .air .air-float { animation: air-float 4.2s ease-in-out infinite; }
    .air .air-shadow { transform-origin: 60px 144px; animation: air-shadow 4.2s ease-in-out infinite; }
    .air .air-eyes { transform-box: fill-box; transform-origin: center; animation: air-blink 5.2s infinite; }
    .air .air-glow { animation: air-pulse 2.4s ease-in-out infinite; }
    .air .air-spark { transform-box: fill-box; transform-origin: center; animation: air-twinkle 2.6s ease-in-out infinite; }
    .air.air-wave .air-arm-r { transform-box: view-box; transform-origin: 92px 98px; animation: air-wave 1.6s ease-in-out 2; }
    .air-head .air-eyes { animation-duration: 4.6s; }
    @keyframes air-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    @keyframes air-shadow { 0%, 100% { transform: scaleX(1); opacity: .18; } 50% { transform: scaleX(.86); opacity: .1; } }
    @keyframes air-blink { 0%, 90%, 100% { transform: scaleY(1); } 93% { transform: scaleY(.12); } 96% { transform: scaleY(1); } }
    @keyframes air-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
    @keyframes air-twinkle { 0%, 100% { transform: scale(1) rotate(0); } 50% { transform: scale(.8) rotate(20deg); } }
    @keyframes air-wave { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(-58deg); } 55% { transform: rotate(-38deg); } 80% { transform: rotate(-58deg); } }

    /* ---------- dialogs (intro / guide / subscribe) ---------- */
    .ard-back { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 16px; background: rgba(4, 9, 22, .62); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        opacity: 0; transition: opacity .32s ease; }
    .ard-back.in { opacity: 1; }
    .ard { position: relative; width: min(720px, 100%); max-height: min(92dvh, 760px); overflow: auto; border-radius: 26px; background: var(--surface, #fff); color: var(--text, #0F172A);
        box-shadow: 0 40px 90px -30px rgba(2, 6, 23, .7), 0 0 0 1px rgba(148, 163, 184, .18); transform: translateY(16px) scale(.97); opacity: 0;
        transition: transform .5s cubic-bezier(.16, 1, .3, 1), opacity .32s ease; font-family: Inter, "IBM Plex Sans Arabic", system-ui, sans-serif; }
    .ard-back.in .ard { transform: none; opacity: 1; }
    .ard.sm { width: min(520px, 100%); }
    .ard-x { position: absolute; top: 12px; right: 12px; z-index: 3; width: 36px; height: 36px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, .12); color: #E2E8F0; cursor: pointer; font-size: 18px; line-height: 1; display: grid; place-items: center; }
    .ard-x:hover { background: rgba(255, 255, 255, .22); }
    .ard-x.l { background: var(--surface-2, #F1F5F9); color: var(--muted, #64748B); }
    .ard [dir="rtl"], .ard .ar { font-family: "IBM Plex Sans Arabic", Inter, system-ui, sans-serif; }

    /* the stage: dark glass with the robot standing next to what it says */
    .ard-stage { position: relative; display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 18px; align-items: center; padding: 26px 26px 22px; color: #E6F6FF; overflow: hidden;
        background: radial-gradient(120% 140% at 0% 0%, #1B3A6E 0%, #0B1A36 45%, #060D1F 100%); border-radius: 26px 26px 0 0; }
    .ard-stage::before { content: ''; position: absolute; width: 300px; height: 300px; left: -70px; top: -60px; border-radius: 50%; background: radial-gradient(circle, rgba(34, 211, 238, .28), transparent 65%); pointer-events: none; }
    .ard-stage::after { content: ''; position: absolute; inset: 0; background-image: radial-gradient(rgba(148, 197, 255, .14) 1px, transparent 1.4px); background-size: 22px 22px; mask-image: linear-gradient(90deg, transparent, #000 40%, transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 40%, transparent); pointer-events: none; opacity: .5; }
    .ard-stage > * { position: relative; z-index: 1; }
    .ard-bot { justify-self: center; }
    .ard-say { position: relative; background: rgba(255, 255, 255, .07); border: 1px solid rgba(148, 197, 255, .22); border-radius: 20px 20px 20px 6px; padding: 16px 18px; backdrop-filter: blur(4px); }
    .ard-say::before { content: ''; position: absolute; left: -9px; bottom: 18px; width: 16px; height: 16px; background: inherit; border-left: 1px solid rgba(148, 197, 255, .22); border-bottom: 1px solid rgba(148, 197, 255, .22); transform: rotate(45deg); border-radius: 0 0 0 4px; }
    .ard-kick { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #67E8F9; }
    .ard-say h2 { margin: 6px 0 6px; font-size: clamp(21px, 3.4vw, 27px); line-height: 1.2; letter-spacing: -.01em; color: #fff; }
    .ard-say p { margin: 0; font-size: 15px; line-height: 1.75; color: #CFE3F5; }
    .ard-say p + p { margin-top: 6px; }
    .ard-body { padding: 20px 26px 8px; }
    .ard-steps { display: flex; gap: 6px; justify-content: center; padding: 14px 0 2px; }
    .ard-steps i { width: 7px; height: 7px; border-radius: 99px; background: var(--border, #E2E8F0); transition: width .35s cubic-bezier(.16, 1, .3, 1), background .35s; }
    .ard-steps i.on { width: 22px; background: var(--primary, #2F5BEA); }
    .ard-foot { position: sticky; bottom: 0; z-index: 2; background: var(--surface, #fff); display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 14px 26px 22px; flex-wrap: wrap; }
    .ard-btn { border: 0; border-radius: 14px; padding: 12px 18px; font: inherit; font-size: 14.5px; font-weight: 700; cursor: pointer; transition: transform .15s, box-shadow .2s, background .2s; }
    .ard-btn.p { color: #fff; background: linear-gradient(135deg, #0F2A52, #1D4ED8 70%, #0891B2); box-shadow: 0 12px 26px -14px rgba(29, 78, 216, .9); }
    .ard-btn.p:hover { transform: translateY(-1px); }
    .ard-btn.g { background: var(--surface-2, #F1F5F9); color: var(--text, #0F172A); }
    .ard-pane { animation: ard-pane .45s cubic-bezier(.16, 1, .3, 1) both; }
    @keyframes ard-pane { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }

    .ard-feats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .ard-feat { display: flex; gap: 11px; align-items: flex-start; border: 1px solid var(--border, #E2E8F0); border-radius: 16px; padding: 12px 13px; background: var(--surface, #fff); }
    .ard-feat .ic { flex: none; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: linear-gradient(135deg, rgba(15, 42, 82, .08), rgba(34, 211, 238, .18)); color: #0E7490; }
    [data-theme="dark"] .ard-feat .ic { color: #67E8F9; }
    .ard-feat b { display: block; font-size: 14px; margin-bottom: 2px; }
    .ard-feat span { display: block; font-size: 13px; line-height: 1.55; color: var(--muted, #64748B); }
    .ard-how { margin: 14px 0 4px; padding: 12px 14px; border-radius: 16px; background: var(--surface-2, #F1F5F9); font-size: 13.5px; line-height: 1.75; }
    .ard-how b { color: var(--text, #0F172A); }
    .ard-duo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .ard-card { border: 1px solid var(--border, #E2E8F0); border-radius: 18px; padding: 14px; display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 12px; align-items: start; }
    .ard-card.pro { border-color: rgba(34, 211, 238, .55); background: linear-gradient(160deg, rgba(34, 211, 238, .08), transparent 60%); }
    .ard-card.mini { border-color: rgba(139, 92, 246, .45); background: linear-gradient(160deg, rgba(139, 92, 246, .07), transparent 60%); }
    .ard-card h4 { margin: 0 0 2px; font-size: 15px; } .ard-card small { display: block; font-size: 11.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted, #64748B); margin-bottom: 6px; }
    .ard-card ul { margin: 0; padding-inline-start: 16px; font-size: 13px; line-height: 1.65; color: var(--text-2, #334155); }
    .ard-when { margin-top: 12px; border-radius: 16px; overflow: hidden; border: 1px solid var(--border, #E2E8F0); }
    .ard-when div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 9px 13px; font-size: 13.5px; align-items: center; }
    .ard-when div + div { border-top: 1px solid var(--border, #E2E8F0); }
    .ard-tag { font-size: 11.5px; font-weight: 800; padding: 4px 9px; border-radius: 99px; white-space: nowrap; }
    .ard-tag.pro { background: rgba(34, 211, 238, .16); color: #0E7490; } .ard-tag.mini { background: rgba(139, 92, 246, .14); color: #6D28D9; }
    [data-theme="dark"] .ard-tag.pro { color: #67E8F9; } [data-theme="dark"] .ard-tag.mini { color: #C4B5FD; }
    .ard-trial { display: flex; gap: 12px; align-items: center; margin-top: 12px; padding: 12px 14px; border-radius: 16px; background: linear-gradient(135deg, #0F2A52, #12305E); color: #E6F6FF; }
    .ard-trial b { color: #fff; } .ard-trial .big { font-size: 26px; font-weight: 800; line-height: 1; color: #67E8F9; flex: none; min-width: 48px; text-align: center; }
    .ard-trial .big small { display: block; font-size: 10.5px; letter-spacing: .08em; color: #A5C4E0; margin-top: 3px; }
    .ard-trial p { margin: 0; font-size: 13.5px; line-height: 1.65; }

    /* guide */
    .ard-sec { margin: 0 0 16px; } .ard-sec h3 { margin: 0 0 8px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #64748B); }
    .ard-meter { border: 1px solid var(--border, #E2E8F0); border-radius: 18px; padding: 14px; }
    .ard-meter .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .ard-meter .top b { font-size: 24px; } .ard-meter .top b small { font-size: 13px; color: var(--muted, #64748B); font-weight: 600; }
    .ard-bar { height: 9px; border-radius: 99px; background: var(--surface-2, #EEF2F7); overflow: hidden; margin: 10px 0 6px; }
    .ard-bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #22D3EE, #1D4ED8); transform-origin: left; animation: ard-grow .9s cubic-bezier(.16, 1, .3, 1) both; }
    .ard-bar.low i { background: linear-gradient(90deg, #F59E0B, #EF4444); }
    @keyframes ard-grow { from { transform: scaleX(0); } }
    .ard-meter p { margin: 0; font-size: 12.5px; color: var(--muted, #64748B); line-height: 1.6; }
    .ard-rows { border: 1px solid var(--border, #E2E8F0); border-radius: 16px; }
    .ard-rows div { display: flex; justify-content: space-between; gap: 10px; padding: 10px 13px; font-size: 13.5px; }
    .ard-rows div + div { border-top: 1px solid var(--border, #E2E8F0); }
    .ard-rows b { font-variant-numeric: tabular-nums; }
    .ard-tips { margin: 0; padding-inline-start: 18px; font-size: 13.5px; line-height: 1.8; }

    /* ---------- subscribe ---------- */
    .ars-load { display: flex; gap: 6px; justify-content: center; padding: 30px 0; } .ars-load i { width: 8px; height: 8px; border-radius: 50%; background: var(--primary, #2F5BEA); animation: air-pulse 1s infinite; }
    .ars-load i:nth-child(2) { animation-delay: .15s; } .ars-load i:nth-child(3) { animation-delay: .3s; }
    .ars-offer { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: center; padding: 14px 16px; border-radius: 18px; margin-bottom: 16px;
        border: 1px solid rgba(34, 211, 238, .45); background: linear-gradient(160deg, rgba(34, 211, 238, .09), transparent 65%); }
    .ars-price { text-align: center; min-width: 92px; } .ars-price b { display: block; font-size: 38px; line-height: 1; letter-spacing: -.02em; }
    .ars-price span { font-size: 13px; font-weight: 800; letter-spacing: .08em; color: var(--muted, #64748B); } .ars-price small { display: block; font-size: 12px; color: var(--muted, #64748B); margin-top: 3px; }
    .ars-offer ul { margin: 0; padding-inline-start: 18px; font-size: 13.5px; line-height: 1.75; }
    .ars-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
    .ars-steps > li { border: 1px solid var(--border, #E2E8F0); border-radius: 18px; padding: 14px; }
    .ars-h { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; } .ars-h b { font-size: 15px; }
    .ars-h .n { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: #fff; background: linear-gradient(135deg, #0F2A52, #1D4ED8); flex: none; }
    .ars-tabs { display: inline-flex; padding: 4px; border-radius: 12px; background: var(--surface-2, #F1F5F9); gap: 4px; margin-bottom: 10px; }
    .ars-tabs button { border: 0; background: transparent; padding: 8px 14px; border-radius: 9px; font: inherit; font-size: 13.5px; font-weight: 700; color: var(--muted, #64748B); cursor: pointer; }
    .ars-tabs button[aria-selected="true"] { background: var(--surface, #fff); color: var(--text, #0F172A); box-shadow: 0 1px 3px rgba(15, 23, 42, .12); }
    .ars-wallet { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-radius: 14px; color: #fff; background: linear-gradient(135deg, #B91C1C, #E11D48); box-shadow: 0 12px 24px -16px rgba(185, 28, 28, .9); }
    .ars-wallet small { display: block; font-size: 11.5px; font-weight: 700; letter-spacing: .04em; opacity: .85; }
    .ars-wallet b { display: block; font-size: 24px; letter-spacing: .06em; font-variant-numeric: tabular-nums; }
    .ars-wallet button { border: 1px solid rgba(255, 255, 255, .5); background: rgba(255, 255, 255, .14); color: #fff; border-radius: 10px; padding: 8px 14px; font: inherit; font-weight: 800; cursor: pointer; flex: none; }
    .ars-how { margin: 10px 0 0; font-size: 13.5px; line-height: 1.75; color: var(--text-2, #334155); }
    .ars-drop { display: grid; justify-items: center; gap: 4px; text-align: center; padding: 18px 14px; border: 1.5px dashed var(--border, #CBD5E1); border-radius: 16px; cursor: pointer; transition: border-color .2s, background .2s; position: relative; overflow: hidden; }
    .ars-drop:hover { border-color: var(--primary, #2F5BEA); background: rgba(47, 91, 234, .04); }
    .ars-drop .ars-plus { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-size: 22px; color: var(--primary, #2F5BEA); background: rgba(47, 91, 234, .1); }
    .ars-drop b { font-size: 14px; } .ars-drop small { font-size: 12.5px; color: var(--muted, #64748B); }
    .ars-drop.has { padding: 8px; border-style: solid; } .ars-drop.has img { max-height: 220px; max-width: 100%; border-radius: 10px; display: block; }
    .ars-chg { position: absolute; bottom: 14px; padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 700; color: #fff; background: rgba(15, 23, 42, .72); }
    .ars-in { display: grid; gap: 6px; margin-top: 10px; font-size: 13px; } .ars-in small { color: var(--muted, #64748B); }
    .ars-in input { border: 1px solid var(--border, #E2E8F0); background: var(--surface, #fff); color: var(--text, #0F172A); border-radius: 12px; padding: 10px 12px; font: inherit; font-size: 15px; letter-spacing: .04em; }
    .ars-code { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; padding: 9px 12px; border-radius: 12px; background: var(--surface-2, #F1F5F9); font-size: 12.5px; color: var(--muted, #64748B); }
    .ars-code b { font-size: 15px; color: var(--text, #0F172A); letter-spacing: .04em; font-variant-numeric: tabular-nums; }
    .ars-state { display: flex; gap: 12px; align-items: flex-start; padding: 13px 14px; border-radius: 16px; margin-bottom: 14px; }
    .ars-state b { display: block; font-size: 14.5px; margin-bottom: 2px; } .ars-state span { display: block; font-size: 13.5px; line-height: 1.7; }
    .ars-state > div { flex: 1; min-width: 0; } .ars-state:not(:has(> div)) { display: block; }
    .ars-state.ok { background: rgba(16, 185, 129, .1); border: 1px solid rgba(16, 185, 129, .35); }
    .ars-state.wait { background: rgba(34, 211, 238, .08); border: 1px solid rgba(34, 211, 238, .4); }
    .ars-state.bad { background: rgba(239, 68, 68, .08); border: 1px solid rgba(239, 68, 68, .35); }
    .ars-spin { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 2.5px solid rgba(34, 211, 238, .3); border-top-color: #0891B2; animation: ars-spin 1s linear infinite; margin-top: 2px; }
    @keyframes ars-spin { to { transform: rotate(360deg); } }
    .ars-mini { margin: 12px 2px 4px; font-size: 12.5px; color: var(--muted, #64748B); } .ars-mini a, .ars-link { color: var(--primary, #2F5BEA); font-weight: 700; }
    .ars-link { border: 0; background: none; padding: 0; font: inherit; cursor: pointer; }
    .ard-btn[disabled] { opacity: .5; cursor: not-allowed; transform: none !important; }
    @media (max-width: 620px) { .ars-offer { grid-template-columns: 1fr; text-align: center; gap: 8px; } .ars-offer ul { text-align: start; } .ars-wallet b { font-size: 21px; } }

    /* ---------- the launch welcome ---------- */
    .arw { position: fixed; inset: 0; z-index: 2100; display: grid; place-items: center; padding: 20px; overflow: hidden; color: #E6F6FF; font-family: Inter, "IBM Plex Sans Arabic", system-ui, sans-serif;
        background: radial-gradient(90% 70% at 50% 42%, #10285A 0%, #071230 46%, #030814 100%); opacity: 0; transition: opacity .45s ease; }
    .arw.in { opacity: 1; } .arw.out { opacity: 0; transition-duration: .5s; }
    .arw-grid { position: absolute; inset: -20%; background-image: linear-gradient(rgba(103, 232, 249, .07) 1px, transparent 1px), linear-gradient(90deg, rgba(103, 232, 249, .07) 1px, transparent 1px); background-size: 46px 46px;
        transform: perspective(700px) rotateX(58deg) translateY(30%); mask-image: radial-gradient(60% 50% at 50% 30%, #000, transparent); -webkit-mask-image: radial-gradient(60% 50% at 50% 30%, #000, transparent); animation: arw-grid 14s linear infinite; }
    @keyframes arw-grid { to { background-position: 0 46px, 0 0; } }
    .arw-ring { position: absolute; left: 50%; top: 40%; width: min(520px, 120vw); aspect-ratio: 1; border-radius: 50%; transform: translate(-50%, -50%) scale(.6); opacity: 0;
        border: 1px solid rgba(103, 232, 249, .28); box-shadow: 0 0 80px rgba(34, 211, 238, .18) inset, 0 0 60px rgba(34, 211, 238, .12); }
    .arw.in .arw-ring { animation: arw-ring 1.4s .15s cubic-bezier(.16, 1, .3, 1) forwards; }
    .arw-ring.r2 { width: min(700px, 150vw); border-color: rgba(103, 232, 249, .12); } .arw.in .arw-ring.r2 { animation-delay: .3s; }
    @keyframes arw-ring { to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
    .arw-sweep { position: absolute; left: 50%; top: 40%; width: min(520px, 120vw); aspect-ratio: 1; border-radius: 50%; transform: translate(-50%, -50%);
        background: conic-gradient(from 0deg, transparent 0 78%, rgba(103, 232, 249, .35) 92%, transparent 100%); mask: radial-gradient(circle, transparent 69.5%, #000 70%, #000 70.6%, transparent 71%); -webkit-mask: radial-gradient(circle, transparent 69.5%, #000 70%, #000 70.6%, transparent 71%); opacity: 0; }
    .arw.in .arw-sweep { animation: arw-fade .6s .9s forwards, arw-spin 6s .9s linear infinite; }
    @keyframes arw-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
    @keyframes arw-fade { to { opacity: 1; } }
    .arw-dots i { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: #67E8F9; opacity: 0; animation: arw-dot 5s ease-in-out infinite; }
    @keyframes arw-dot { 0% { opacity: 0; transform: translateY(20px); } 30% { opacity: .8; } 100% { opacity: 0; transform: translateY(-70px); } }
    .arw-box { position: relative; z-index: 2; display: grid; justify-items: center; text-align: center; max-width: 640px; }
    .arw-bot { position: relative; opacity: 0; transform: translateY(28px) scale(.92); filter: blur(8px); }
    .arw.in .arw-bot { animation: arw-bot .9s .35s cubic-bezier(.16, 1, .3, 1) forwards; }
    @keyframes arw-bot { to { opacity: 1; transform: none; filter: none; } }
    .arw-bot .air-eyes, .arw-bot .air-glow { opacity: 0; }
    .arw.in .arw-bot .air-eyes { animation: arw-on .9s 1.05s steps(1) forwards, air-blink 5.2s 2.4s infinite; }
    .arw.in .arw-bot .air-glow { animation: arw-on .9s 1.05s steps(1) forwards, air-pulse 2.4s 2s ease-in-out infinite; }
    @keyframes arw-on { 0% { opacity: 0; } 15% { opacity: 1; } 28% { opacity: .2; } 40% { opacity: 1; } 100% { opacity: 1; } }
    .arw-halo { position: absolute; left: 50%; top: 42%; width: 240px; height: 240px; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(circle, rgba(34, 211, 238, .35), transparent 62%); opacity: 0; z-index: -1; }
    .arw.in .arw-halo { animation: arw-fade 1s 1.1s forwards; }
    .arw-kick { margin-top: 18px; font-size: 12px; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: #67E8F9; opacity: 0; }
    .arw h1 { margin: 10px 0 6px; font-size: clamp(30px, 6vw, 52px); line-height: 1.08; letter-spacing: -.02em; color: #fff; opacity: 0; }
    .arw h1 .hl { background: linear-gradient(90deg, #67E8F9, #A5B4FC); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .arw .ar-line { font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; font-size: clamp(18px, 3.4vw, 24px); font-weight: 600; color: #DCEBFA; opacity: 0; }
    .arw .sub { margin: 12px auto 0; max-width: 520px; font-size: 15px; line-height: 1.7; color: #A9C2DC; opacity: 0; }
    .arw .chip { display: inline-flex; align-items: center; gap: 8px; margin-top: 16px; padding: 7px 14px; border-radius: 99px; font-size: 13px; font-weight: 700; color: #E6F6FF;
        background: rgba(34, 211, 238, .1); border: 1px solid rgba(103, 232, 249, .35); opacity: 0; }
    .arw .acts { display: flex; gap: 10px; justify-content: center; margin-top: 22px; flex-wrap: wrap; opacity: 0; }
    .arw .acts .ard-btn.g { background: rgba(255, 255, 255, .08); color: #DCEBFA; border: 1px solid rgba(255, 255, 255, .14); }
    .arw.in .arw-kick { animation: arw-up .7s 1.25s cubic-bezier(.16, 1, .3, 1) forwards; }
    .arw.in h1 { animation: arw-up .8s 1.4s cubic-bezier(.16, 1, .3, 1) forwards; }
    .arw.in .ar-line { animation: arw-up .8s 1.6s cubic-bezier(.16, 1, .3, 1) forwards; }
    .arw.in .sub { animation: arw-up .8s 1.8s cubic-bezier(.16, 1, .3, 1) forwards; }
    .arw.in .chip { animation: arw-up .8s 1.95s cubic-bezier(.16, 1, .3, 1) forwards; }
    .arw.in .acts { animation: arw-up .8s 2.1s cubic-bezier(.16, 1, .3, 1) forwards; }
    @keyframes arw-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

    /* ---------- Miss Marwa's card ---------- */
    .art { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 22px; color: #E6F6FF; margin: 0 0 14px; position: relative; overflow: hidden;
        background: radial-gradient(120% 160% at 0% 0%, #1B3A6E 0%, #0B1A36 55%, #071128 100%); box-shadow: 0 18px 40px -26px rgba(2, 6, 23, .8); animation: art-in .7s cubic-bezier(.16, 1, .3, 1) both; }
    .art::after { content: ''; position: absolute; right: -40px; top: -60px; width: 200px; height: 200px; border-radius: 50%; background: radial-gradient(circle, rgba(34, 211, 238, .22), transparent 65%); pointer-events: none; }
    .art-ph { position: relative; flex: none; width: 74px; height: 74px; border-radius: 50%; padding: 3px; background: conic-gradient(from 200deg, #22D3EE, #6366F1, #22D3EE); }
    .art-ph img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; background: #fff; display: block; border: 2px solid #0B1A36; }
    .art-ph .bot { position: absolute; right: -6px; bottom: -4px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #0B1630; box-shadow: 0 0 0 2px #22D3EE; }
    .art-tx { flex: 1; min-width: 0; position: relative; z-index: 1; }
    .art-who { font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #67E8F9; }
    .art-say { margin: 3px 0 2px; font: 700 17px/1.5 "IBM Plex Sans Arabic", system-ui, sans-serif; color: #fff; }
    .art-sub { font-size: 13px; color: #A9C2DC; }
    .art-go { position: relative; z-index: 1; flex: none; border: 0; border-radius: 14px; padding: 11px 15px; font: 700 13.5px/1.2 Inter, "IBM Plex Sans Arabic", sans-serif; color: #071128; background: linear-gradient(135deg, #67E8F9, #A5F3FC); cursor: pointer; }
    .art-go:hover { filter: brightness(1.05); }
    @keyframes art-in { from { opacity: 0; transform: translateY(10px); } }
    @media (max-width: 560px) { .art { flex-wrap: wrap; } .art-go { width: 100%; } .art-ph { width: 62px; height: 62px; } .art-say { font-size: 16px; } }

    /* ---------- the launcher (every student page) ---------- */
    .arl { position: fixed; z-index: 900; right: 18px; bottom: calc(22px + env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 10px; flex-direction: row-reverse; pointer-events: none; }
    @media (max-width: 1023px) { .arl { right: 12px; bottom: calc(var(--bottomnav-h, 68px) + 14px + env(safe-area-inset-bottom)); } .arl-btn { width: 52px; height: 52px; } }
    .arl-btn { pointer-events: auto; position: relative; width: 58px; height: 58px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; display: grid; place-items: center; text-decoration: none;
        background: radial-gradient(circle at 32% 28%, #1E4E8C 0%, #0F2A52 50%, #0B1630 100%); box-shadow: 0 0 0 2px rgba(34, 211, 238, .8), 0 14px 30px -10px rgba(8, 145, 178, .7);
        transform: translateY(18px) scale(.6); opacity: 0; transition: transform .6s cubic-bezier(.16, 1.3, .3, 1), opacity .35s ease, box-shadow .2s; }
    .arl.in .arl-btn { transform: none; opacity: 1; }
    .arl-btn:hover { box-shadow: 0 0 0 3px rgba(34, 211, 238, 1), 0 16px 34px -10px rgba(8, 145, 178, .9); }
    .arl-btn::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; border: 1px solid rgba(34, 211, 238, .5); opacity: 0; animation: arl-ping 3.6s 1s ease-out infinite; }
    @keyframes arl-ping { 0% { opacity: .9; transform: scale(.9); } 70%, 100% { opacity: 0; transform: scale(1.35); } }
    .arl-bub { pointer-events: auto; max-width: min(250px, 64vw); padding: 10px 14px; border-radius: 16px 16px 4px 16px; background: #0F2A52; color: #F0FDFF; direction: rtl; text-align: right;
        font: 600 13.5px/1.55 "IBM Plex Sans Arabic", system-ui, sans-serif; box-shadow: 0 0 0 1px rgba(34, 211, 238, .45), 0 16px 30px -14px rgba(2, 6, 23, .7);
        transform-origin: 100% 80%; transform: translateX(8px) scale(.85); opacity: 0; transition: transform .45s cubic-bezier(.16, 1.2, .3, 1), opacity .3s ease; cursor: pointer; }
    .arl-bub b { display: block; font: 800 11px/1.4 Inter, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #67E8F9; direction: ltr; text-align: right; }
    .arl.talk .arl-bub { transform: none; opacity: 1; }
    .arl.hide { opacity: 0; pointer-events: none; transition: opacity .3s; }
    .arl.hide * { pointer-events: none !important; }

    /* ---------- the slim credits meter (chat) ---------- */
    .arm { display: flex; align-items: center; gap: 10px; border: 1px solid var(--border, #E2E8F0); background: var(--surface, #fff); border-radius: 14px; padding: 8px 12px; margin-bottom: 8px; font-size: 13px; animation: art-in .5s cubic-bezier(.16, 1, .3, 1) both; }
    .arm .ard-bar { flex: 1; margin: 0; height: 7px; }
    .arm b { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .arm button { border: 0; background: none; color: var(--primary, #2F5BEA); font: inherit; font-weight: 700; cursor: pointer; padding: 2px 4px; white-space: nowrap; }

    @media (max-width: 620px) {
        .ard-stage, .ard-stage[style] { grid-template-columns: 70px minmax(0, 1fr) !important; padding: 46px 14px 16px !important; gap: 10px; align-items: start; }
        .ard-stage .air { width: 70px; height: 88px; margin-top: 18px; }
        .ard-say { padding: 13px 14px; } .ard-say h2 { font-size: 19px !important; } .ard-say p { font-size: 14px; line-height: 1.65; }
        .ard-x { top: 8px; right: 8px; width: 32px; height: 32px; }
        .ard-body { padding: 16px 16px 4px; } .ard-foot { padding: 12px 16px 18px; }
        .ard-feats, .ard-duo { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
        .air *, .ard-pane, .ard-bar i, .art, .arm, .arw *, .arl-btn::after { animation: none !important; }
        .arw .arw-bot, .arw h1, .arw .ar-line, .arw .sub, .arw .chip, .arw .acts, .arw-kick, .arw-ring, .arw-halo, .arw-bot .air-eyes, .arw-bot .air-glow { opacity: 1 !important; transform: none !important; filter: none !important; }
        .arw-ring { transform: translate(-50%, -50%) !important; } .arw-sweep { display: none; }
        .ard, .ard-back, .arl-btn, .arl-bub { transition: none !important; }
    }`;
    function css() { if (document.getElementById('air-css')) return; const s = document.createElement('style'); s.id = 'air-css'; s.textContent = CSS; document.head.appendChild(s); }

    const IC = {
        book: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/></svg>',
        list: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>',
        cam: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
        quiz: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l2.5 2.5L16 9"/><rect x="3.5" y="3.5" width="17" height="17" rx="4"/></svg>',
        exam: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M4.6 6.6l2 2M17.4 15.4l2 2M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3"/></svg>',
        pdf: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 14h6M9 17.5h4"/></svg>'
    };

    // ---------- dialog shell ----------
    function dialog(html, { small = false, light = false, onClose, label = 'Miss Marwa Assistant Pro' } = {}) {
        css();
        const back = document.createElement('div');
        back.className = 'ard-back';
        back.innerHTML = `<div class="ard${small ? ' sm' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}"><button class="ard-x${light ? ' l' : ''}" type="button" aria-label="Close">✕</button>${html}</div>`;
        const prev = document.activeElement;
        let closed = false;
        const close = () => {
            if (closed) return; closed = true;
            back.classList.remove('in'); document.removeEventListener('keydown', key);
            setTimeout(() => { back.remove(); document.documentElement.style.overflow = ''; try { prev && prev.focus && prev.focus(); } catch (e) { } }, reduced() ? 0 : 340);
            if (onClose) onClose();
        };
        const key = (e) => { if (e.key === 'Escape') close(); };
        back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('.ard-x')) close(); });
        document.addEventListener('keydown', key);
        document.body.appendChild(back);
        document.documentElement.style.overflow = 'hidden';
        requestAnimationFrame(() => requestAnimationFrame(() => back.classList.add('in')));
        setTimeout(() => { const b = back.querySelector('.ard-btn.p') || back.querySelector('.ard-x'); try { b && b.focus({ preventScroll: true }); } catch (e) { } }, 60);
        return { el: back, box: back.querySelector('.ard'), close };
    }
    const trialLine = (t) => t ? `${dayEn(t.start)} → ${dayEn(t.end)}` : '';

    // ---------- the introduction (first time in the assistant; "Guide" opens it again) ----------
    function intro({ trial = null, subscribed = false, onClose, onDone } = {}) {
        const showTrial = trial && !subscribed && (trial.phase === 'on' || trial.phase === 'before');
        const STEPS = [
            {
                say: `<span class="ard-kick">Meet your study partner</span>
                    <h2>Hi, I'm Miss Marwa Assistant Pro</h2>
                    <p dir="rtl">أنا المساعد الذكي بتاع مس مروة 👋 اتدرّبت على منهج الـ Science بتاعك وبس — كتابك كله وواجبات مس مروة.</p>`,
                body: `<div class="ard-feats">
                    <div class="ard-feat"><span class="ic">${IC.book}</span><div><b>Only your curriculum</b><span dir="rtl">بشرح من كتابك (المعاصر) بنفس كلماته — ومش بخرج برّه المنهج أبداً.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.list}</span><div><b>Not the internet</b><span dir="rtl">مش زي أي AI تاني بيجيب كلام من النت ممكن يلخبطك — كل معلومة من كتابك.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.quiz}</span><div><b>Teaches, not just answers</b><span dir="rtl">بشرح ببساطة وبأمثلة من حياتك، خطوة بخطوة، زي مس مروة بالظبط.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.exam}</span><div><b>Knows how you're doing</b><span dir="rtl">بشوف نتايج امتحاناتك وبساعدك تراجع غلطاتك.</span></div></div>
                </div>`
            },
            {
                say: `<span class="ard-kick">What I can do</span>
                    <h2>Ask me anything in your Science book</h2>
                    <p dir="rtl">اكتب سؤالك بالعربي أو بالإنجليزي — أو صوّره — وأنا أكمّل معاك.</p>`,
                body: `<div class="ard-feats">
                    <div class="ard-feat"><span class="ic">${IC.book}</span><div><b>Explain any part</b><span dir="rtl">"اشرحلي الـ density" — ببساطة وبأمثلة.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.list}</span><div><b>Summarize a lesson</b><span dir="rtl">خريطة الدرس الأول، وبعدها كل نقطة بالتفصيل.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.cam}</span><div><b>Snap a question</b><span dir="rtl">صوّر أي سؤال: المعطيات، القانون وليه، والحل خطوة بخطوة.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.quiz}</span><div><b>Practice questions</b><span dir="rtl">أسئلة من التقويم الذاتي في كتابك ومن واجبات مس مروة — وأصححلك على طول.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.exam}</span><div><b>Your exam mistakes</b><span dir="rtl">بعد امتحانك الأونلاين: الإجابة الصح… وليه.</span></div></div>
                    <div class="ard-feat"><span class="ic">${IC.pdf}</span><div><b>Practice exam PDF</b><span dir="rtl">امتحان على أي درس بإجابة نموذجية كاملة.</span></div></div>
                </div>
                <div class="ard-how" dir="rtl"><b>إزاي تستخدمني؟</b> اكتب سؤالك تحت، أو دوس <b>📎</b> وابعت صورة أو PDF. بعد كل شرح هتلاقي زرار <b>"نحل أسئلة عليه"</b> — جرّبه 😉</div>`
            },
            {
                say: `<span class="ard-kick">Two assistants, one team</span>
                    <h2>Me, and my little helper Mini</h2>
                    <p dir="rtl">إنت بتختار مين يجاوبك من فوق خانة الكتابة — وتقدر تبدّل في أي وقت.</p>`,
                body: `<div class="ard-duo">
                    <div class="ard-card pro">${svg({ size: 58 })}<div><h4>Assistant Pro</h4><small>The main one · بيصرف من رصيدك</small>
                        <ul dir="rtl"><li>شرح عميق ودقيق من كتابك</li><li>صور وملفات PDF</li><li>تلخيص الدروس وحل أسئلة معاك</li><li>امتحانات PDF بالإجابات</li></ul></div></div>
                    <div class="ard-card mini">${svg({ size: 58, variant: 'mini' })}<div><h4>Mini Assistant</h4><small>Free · رسايل محدودة كل يوم</small>
                        <ul dir="rtl"><li>إجابات سريعة ومختصرة</li><li>تعريف أو معلومة صغيرة</li><li>مجاني تماماً</li><li>ممكن يغلط — راجع المهم مع Pro</li></ul></div></div>
                </div>
                <div class="ard-when">
                    <div><span dir="rtl">تعريف سريع أو تأكيد معلومة صغيرة</span><span class="ard-tag mini">Mini</span></div>
                    <div><span dir="rtl">تفهم درس، تحل مسألة، أو تصوّر سؤال</span><span class="ard-tag pro">Pro</span></div>
                    <div><span dir="rtl">مراجعة قبل الامتحان وأسئلة تدريب</span><span class="ard-tag pro">Pro</span></div>
                </div>
                ${showTrial ? `<div class="ard-trial"><div class="big">${n1(trial.credits)}<small>CREDITS</small></div><p dir="rtl"><b>فترة تجريبية مجانية</b> من ${esc(dayAr(trial.start))} <bdi dir="ltr">${esc(dayEn(trial.start))}</bdi> لحد ${esc(dayAr(trial.end))} <bdi dir="ltr">${esc(dayEn(trial.end))}</bdi> — معاك <bdi dir="ltr">${n1(trial.credits)} credits</bdi> تجرّب بيهم Assistant Pro. السؤال النصي بياخد جزء صغير، والصور والـ PDF أكتر شوية. بعد كده تقدر تشترك وتكمّل معايا 🚀</p></div>` : ''}`
            }
        ];
        let k = 0;
        const d = dialog(`<div id="ardPane"></div><div class="ard-steps" aria-hidden="true">${STEPS.map((_, i) => `<i data-s="${i}"></i>`).join('')}</div>
            <div class="ard-foot"><button class="ard-btn g" type="button" data-back>Back</button><button class="ard-btn p" type="button" data-next>Next</button></div>`, { label: 'Introduction to Miss Marwa Assistant Pro', onClose });
        const pane = d.box.querySelector('#ardPane');
        const show = () => {
            const s = STEPS[k];
            pane.innerHTML = `<div class="ard-pane"><div class="ard-stage"><div class="ard-bot">${svg({ size: 132, wave: k === 0 })}</div><div class="ard-say">${s.say}</div></div><div class="ard-body">${s.body}</div></div>`;
            d.box.querySelectorAll('.ard-steps i').forEach((x, i) => x.classList.toggle('on', i === k));
            d.box.querySelector('[data-back]').style.visibility = k ? 'visible' : 'hidden';
            d.box.querySelector('[data-next]').textContent = k === STEPS.length - 1 ? "Let's start ✨" : 'Next';
            d.box.scrollTop = 0;
        };
        d.box.addEventListener('click', (e) => {
            if (e.target.closest('[data-back]')) { if (k > 0) { k--; show(); } return; }
            if (e.target.closest('[data-next]')) { if (k < STEPS.length - 1) { k++; show(); } else { d.close(); if (onDone) onDone(); } }
        });
        show();
        return d;
    }

    // ---------- the guide (limits + how to use + the introduction again) ----------
    function guide({ status = {}, daily = null, onIntro, onSubscribe } = {}) {
        const c = status.credits, pro = (status.models || []).find(m => m.tier === 'pro') || {}, free = (status.models || []).find(m => m.tier === 'free') || {};
        const t = status.today || {}, L = t.limits || {};
        let meter = '';
        if (c) {
            const pct = c.budget > 0 ? Math.max(0, Math.min(100, c.left / c.budget * 100)) : 0;
            meter = `<div class="ard-meter"><div class="top"><span>${c.mode === 'trial' ? 'Free trial credits' : c.ends ? 'Subscription credits' : 'This month\'s credits'}</span><b>${n1(c.left)} <small>/ ${n1(c.budget)} left</small></b></div>
                <div class="ard-bar${pct < 20 ? ' low' : ''}"><i style="width:${pct}%"></i></div>
                <p dir="rtl">${c.mode === 'trial' ? `الفترة التجريبية لحد ${esc(dayAr(c.ends))} <bdi dir="ltr">${esc(dayEn(c.ends))}</bdi>. ` : c.ends ? `اشتراكك لحد ${esc(dayAr(c.ends))} <bdi dir="ltr">${esc(dayEn(c.ends))}</bdi>. ` : 'الرصيد بيتجدد أول كل شهر. '}السؤال النصي بياخد جزء صغير من الـ credit، والصور والـ PDF أكتر — ومفيش حد للرسايل في اليوم.</p>
                ${c.mode === 'trial' ? '<button class="ard-btn p" type="button" data-sub style="margin-top:12px">Subscribe to keep going</button>' : ''}</div>`;
        } else if (['TRIAL_CAP', 'TRIAL_OVER', 'STUDENT_OFF', 'SUB_CAP', 'SUB_EXPIRED'].includes(pro.code)) {
            meter = `<div class="ard-meter"><div class="top"><span>Assistant Pro</span><b style="font-size:16px">${({ TRIAL_OVER: 'Trial ended', TRIAL_CAP: 'Trial credits used', SUB_CAP: 'Credits used', SUB_EXPIRED: 'Subscription ended' })[pro.code] || 'Not subscribed'}</b></div>
                <p dir="rtl" style="margin-top:6px">اشترك في Assistant Pro عشان تكمّل معايا ✨</p><button class="ard-btn p" type="button" data-sub style="margin-top:10px">Subscribe</button></div>`;
        }
        const rows = [];
        if (free.ready) rows.push(`<div><span>Mini Assistant messages today</span><b>${Number(t.messages) || 0} / ${Number(L.messages) || 0}</b></div>`);
        if (daily && pro.ready) {
            rows.push(`<div><span>Photos today (Pro)</span><b>${daily.images.used} / ${daily.images.max}</b></div>`);
            rows.push(`<div><span>PDFs you send today (Pro)</span><b>${daily.pdfIn.used} / ${daily.pdfIn.max}</b></div>`);
            rows.push(`<div><span>PDFs I make today (Pro)</span><b>${daily.pdfOut.used} / ${daily.pdfOut.max}</b></div>`);
        }
        const d = dialog(`<div class="ard-stage" style="grid-template-columns:96px minmax(0,1fr);padding:22px 22px 18px"><div class="ard-bot">${svg({ size: 84 })}</div>
                <div class="ard-say"><span class="ard-kick">Guide &amp; limits</span><h2 style="font-size:22px">How to get the most out of me</h2></div></div>
            <div class="ard-body">
                ${meter ? `<div class="ard-sec"><h3>Your credits</h3>${meter}</div>` : ''}
                ${rows.length ? `<div class="ard-sec"><h3>Today</h3><div class="ard-rows">${rows.join('')}</div><p class="small" style="margin:6px 2px 0;font-size:12px;color:var(--muted,#64748B)" dir="rtl">الأعداد دي بتبدأ من جديد كل يوم.</p></div>` : ''}
                <div class="ard-sec"><h3>Tips</h3><ul class="ard-tips" dir="rtl">
                    <li>اسأل سؤال واحد واضح في المرة — وقول اسم الدرس لو تعرفه.</li>
                    <li>عشان تفهم درس: دوس <b>"لخصلي درس"</b> واختاره من القائمة.</li>
                    <li>بعد الشرح دوس <b>"نحل أسئلة عليه"</b> — أسئلة من كتابك وواجبات مس مروة.</li>
                    <li>سؤال في كتاب أو ورقة؟ صوّره بوضوح، سؤال واحد في الصورة.</li>
                    <li>استخدم <b>Mini</b> للحاجات السريعة، و<b>Pro</b> للشرح والحل.</li>
                    <li>أثناء امتحان أونلاين المساعد بيقفل لحد ما تخلّص.</li>
                </ul></div>
            </div>
            <div class="ard-foot"><button class="ard-btn g" type="button" data-intro>Show the introduction again</button><button class="ard-btn p" type="button" data-ok>Got it</button></div>`, { label: 'Guide and limits' });
        d.box.addEventListener('click', (e) => {
            if (e.target.closest('[data-ok]')) d.close();
            else if (e.target.closest('[data-intro]')) { d.close(); setTimeout(() => onIntro && onIntro(), reduced() ? 0 : 360); }
            else if (e.target.closest('[data-sub]')) { d.close(); setTimeout(() => (onSubscribe || subscribe)({ code: pro.code }), reduced() ? 0 : 360); }
        });
        return d;
    }

    // ---------- subscribe (trial over / credits used up) — the full subscription screen comes next ----------
    // ---------- subscribe: pay by Vodafone Cash / Fawry, then send the screenshot / receipt here (27 Nov 2026) ----------
    //   GET /api/subscription?action=info → price, wallet, account code, the last request; POST …?action=request → the photo
    const TITLES = { TRIAL_OVER: 'Your free trial has ended', TRIAL_CAP: "You've used your trial credits", SUB_EXPIRED: 'Your subscription has ended',
        SUB_CAP: "You've used this subscription's credits", STUDENT_CAP: "This month's credits are used up" };
    const fmtWallet = (w) => String(w || '').replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3');
    const ago = (iso) => { const t = Date.parse(String(iso || '').replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')); if (!t) return ''; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'دلوقتي' : m < 60 ? `من ${m} دقيقة` : m < 1440 ? `من ${Math.round(m / 60)} ساعة` : `من ${Math.round(m / 1440)} يوم`; };
    // a phone photo (4 MB) → JPEG ≤ 1600 px (~300 KB), still sharp enough to read a transfer number
    function shrink(file) {
        return new Promise((res, rej) => {
            const url = URL.createObjectURL(file), img = new Image();
            img.onload = () => {
                const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
                const c = document.createElement('canvas'); c.width = w; c.height = h;
                const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);
                const out = c.toDataURL('image/jpeg', .85);
                res({ mime: 'image/jpeg', data: out.slice(out.indexOf(',') + 1), preview: out });
            };
            img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
            img.src = url;
        });
    }
    function subscribe({ code = '' } = {}) {
        css();
        const d = dialog(`<div class="ard-stage"><div class="ard-bot">${svg({ size: 118 })}</div>
                <div class="ard-say"><span class="ard-kick">Miss Marwa Assistant Pro</span><h2>${esc(TITLES[code] || 'Subscribe to Assistant Pro')}</h2>
                <p dir="rtl">${code ? 'اشترك وكمّل مذاكرة معايا — ' : ''}شرح من كتابك، حل بالصور، أسئلة تدريب وامتحانات PDF.</p></div></div>
            <div class="ard-body" id="arsBody"><div class="ars-load" aria-busy="true"><i></i><i></i><i></i></div></div>`, { label: 'Subscribe to Assistant Pro' });
        const box = d.box, body = box.querySelector('#arsBody');
        let info = null, method = 'vodafone', pick = null, busy = false, forceForm = false;
        const api = async (action, payload) => {
            const r = await fetch('/api/subscription?action=' + action, payload ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : { credentials: 'same-origin' });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || 'حصلت مشكلة — جرّب تاني');
            return j;
        };
        const waLink = () => `https://wa.me/2${info.wallet}?text=${encodeURIComponent(`إيصال اشتراك Assistant Pro (${info.price} جنيه)\nكود الحساب: ${info.code}`)}`;
        function render() {
            const R = info.request, P = info.price;
            let top = '';
            if (info.sub) top = `<div class="ars-state ok"><b>You're subscribed ✓</b><span dir="rtl">اشتراكك شغال لحد <bdi dir="ltr">${esc(dayEn(info.sub.until))}</bdi> — باقيلك <bdi dir="ltr">${n1(info.sub.leftEgp)}</bdi> credits. تقدر تجدّد بعد ما يخلص.</span></div>`;
            else if (R && R.status === 'pending' && !forceForm) {
                box.querySelector('.ard-say h2').textContent = 'Thanks — we got your payment';
                body.innerHTML = `<div class="ars-state wait"><span class="ars-spin" aria-hidden="true"></span><div><b>Payment received — waiting for activation</b>
                    <span dir="rtl">وصلنا إيصالك (${esc(ago(R.createdAt))}). فريق مس مروة بيراجعه ويفعّلك Assistant Pro لمدة ${info.days} يوم — وهيوصلك إشعار أول ما يتفعّل ✨</span></div></div>
                    <div class="ars-code"><span>Your account code</span><b>${esc(info.code)}</b></div>
                    <p class="ars-mini" dir="rtl">الصورة مش واضحة أو بعت حاجة غلط؟ <button type="button" class="ars-link" data-again>ابعت صورة تانية</button></p>`;
                foot(`<span></span><button class="ard-btn p" type="button" data-ok>Got it</button>`);
                return;
            } else if (R && R.status === 'rejected') top = `<div class="ars-state bad"><b>Your last receipt wasn't accepted</b><span dir="rtl">${esc(R.note || 'ابعت صورة أوضح للتحويل.')}</span></div>`;
            box.querySelector('.ard-say h2').textContent = info.sub ? 'Renew Assistant Pro' : (TITLES[code] || 'Subscribe to Assistant Pro');
            body.innerHTML = `${top}
                <div class="ars-offer"><div class="ars-price"><b>${n1(P)}</b><span>EGP</span><small>for ${info.days} days</small></div>
                    <ul><li><b>${n1(info.credits)} credits</b> for explanations, summaries &amp; quizzes</li><li>Photos, PDFs, quizzes &amp; practice exams</li><li>Only your Science curriculum — like Miss Marwa</li></ul></div>
                <ol class="ars-steps">
                    <li><div class="ars-h"><span class="n">1</span><b>Transfer <bdi>${n1(P)}</bdi> EGP</b></div>
                        <div class="ars-tabs" role="tablist"><button type="button" role="tab" data-m="vodafone" aria-selected="${method === 'vodafone'}">Vodafone Cash</button><button type="button" role="tab" data-m="fawry" aria-selected="${method === 'fawry'}">Fawry</button></div>
                        <div class="ars-wallet"><div><small>${method === 'fawry' ? 'Vodafone Cash wallet (deposit at Fawry)' : 'Vodafone Cash wallet'}</small><b dir="ltr">${esc(fmtWallet(info.wallet))}</b></div><button type="button" data-copy="${esc(info.wallet)}">Copy</button></div>
                        <p class="ars-how" dir="rtl">${method === 'fawry'
                            ? `روح أي منفذ <b>فوري</b> واطلب <b>«إيداع في محفظة فودافون كاش»</b> على الرقم ده بـ <b>${n1(P)} جنيه</b> — وخد الإيصال وصوّره.`
                            : `حوّل <b>${n1(P)} جنيه</b> على المحفظة دي من محفظتك (فودافون كاش أو أي محفظة) أو من <b>InstaPay</b> — وخد screenshot لرسالة التحويل.`}</p></li>
                    <li><div class="ars-h"><span class="n">2</span><b>Send ${method === 'fawry' ? 'a photo of the receipt' : 'the screenshot'}</b></div>
                        <label class="ars-drop${pick ? ' has' : ''}"><input type="file" accept="image/*" data-file hidden>
                            ${pick ? `<img src="${pick.preview}" alt="Your receipt"><span class="ars-chg">Change photo</span>` : `<span class="ars-plus" aria-hidden="true">＋</span><b>${method === 'fawry' ? 'Upload the receipt photo' : 'Upload the screenshot'}</b><small dir="rtl">${method === 'fawry' ? 'صوّر الإيصال كله بوضوح' : 'لازم يبان المبلغ والرقم اللي اتحوّل عليه'}</small>`}</label>
                        ${method === 'vodafone' ? `<label class="ars-in"><span dir="rtl">الرقم اللي حوّلت منه <small>(اختياري — بيسرّع المراجعة)</small></span><input inputmode="numeric" maxlength="11" placeholder="01xxxxxxxxx" data-from dir="ltr"></label>` : ''}
                        <div class="ars-code"><span>Your account code — sent with the photo automatically</span><b>${esc(info.code)}</b></div></li>
                    <li><div class="ars-h"><span class="n">3</span><b>We activate it</b></div><p class="ars-how" dir="rtl">فريق مس مروة بيراجع التحويل ويفعّلك خلال ساعات — والـ ${info.days} يوم بيبدأوا من لحظة التفعيل.</p></li>
                </ol>
                <p class="ars-mini" dir="rtl">مشكلة في الرفع؟ <a href="${esc(waLink())}" target="_blank" rel="noopener">ابعت الصورة على واتساب</a> مع كود حسابك.</p>`;
            foot(`<button class="ard-btn g" type="button" data-ok>Later</button><button class="ard-btn p" type="button" data-send ${pick ? '' : 'disabled'}>Send receipt</button>`);
        }
        function foot(html) { let f = box.querySelector('.ard-foot'); if (!f) { f = document.createElement('div'); f.className = 'ard-foot'; box.appendChild(f); } f.innerHTML = html; }
        box.addEventListener('click', async (e) => {
            if (e.target.closest('[data-ok]')) { d.close(); return; }
            const t = e.target.closest('[data-m]'); if (t && t.dataset.m !== method) { method = t.dataset.m; render(); return; }
            if (e.target.closest('[data-again]')) { forceForm = true; render(); return; }
            const cp = e.target.closest('[data-copy]');
            if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied ✓'; } catch (x) { cp.textContent = cp.dataset.copy; } setTimeout(() => { cp.textContent = 'Copy'; }, 1800); return; }
            if (e.target.closest('[data-send]') && pick && !busy) {
                busy = true; const b = e.target.closest('[data-send]'); b.disabled = true; b.textContent = 'Sending…';
                const from = (box.querySelector('[data-from]') || {}).value || '';
                try {
                    const r = await api('request', { method, fromPhone: from.replace(/\D/g, ''), image: { mime: pick.mime, data: pick.data } });
                    info.request = r.request; pick = null; forceForm = false; render();
                } catch (x) { b.disabled = false; b.textContent = 'Send receipt'; toast(x.message); }
                busy = false;
            }
        });
        box.addEventListener('change', async (e) => {
            const f = e.target.closest('[data-file]'); if (!f || !f.files || !f.files[0]) return;
            const file = f.files[0];
            if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) { toast('اختار صورة (screenshot أو صورة الإيصال)'); return; }
            try { pick = await shrink(file); render(); } catch (x) { toast('الصورة دي مش بتفتح — جرّب screenshot تاني'); }
        });
        function toast(m) { if (window.Site && Site.toast) Site.toast(m, 'error'); else alert(m); }
        api('info').then(j => { info = j; render(); }).catch(x => { body.innerHTML = `<div class="ars-state bad"><b>Couldn't load</b><span dir="rtl">${esc(x.message)}</span></div>`; foot(`<button class="ard-btn p" type="button" data-ok>Close</button>`); });
        return d;
    }

    // ---------- the launch welcome (once per student, on the first visit after launch) ----------
    function welcome({ trial = null, subscribed = false, firstName = '', onStart, onClose } = {}) {
        css();
        const el = document.createElement('div');
        el.className = 'arw'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Miss Marwa Assistant Pro is ready');
        const dots = Array.from({ length: 18 }, (_, i) => `<i style="left:${(i * 53) % 100}%;top:${30 + (i * 37) % 60}%;animation-delay:${(i * .43) % 5}s"></i>`).join('');
        const showTrial = trial && !subscribed && trial.phase === 'on';
        el.innerHTML = `<div class="arw-grid"></div><div class="arw-ring"></div><div class="arw-ring r2"></div><div class="arw-sweep"></div><div class="arw-dots">${dots}</div>
            <div class="arw-box">
                <div class="arw-bot"><div class="arw-halo"></div>${svg({ size: 150, wave: true })}</div>
                <div class="arw-kick">Miss Marwa Assistant Pro · Now live</div>
                <h1>I'm ready now —<br><span class="hl">let's study together${firstName ? ', ' + esc(firstName) : ''}!</span></h1>
                <div class="ar-line" dir="rtl">أنا جاهز دلوقتي… يلا نذاكر سوا!</div>
                <p class="sub">Trained only on your Science curriculum — your book, Miss Marwa's homework, your exams. Not the internet.</p>
                ${showTrial ? `<span class="chip">Free trial · ${esc(trialLine(trial))} · ${n1(trial.credits)} credits</span>` : ''}
                <div class="acts"><button class="ard-btn g" type="button" data-later>Later</button><button class="ard-btn p" type="button" data-go>Start studying →</button></div>
            </div>`;
        let done = false;
        const close = (go) => {
            if (done) return; done = true;
            el.classList.add('out'); document.removeEventListener('keydown', key);
            setTimeout(() => { el.remove(); document.documentElement.style.overflow = ''; }, reduced() ? 0 : 520);
            if (onClose) onClose();
            if (go && onStart) setTimeout(onStart, reduced() ? 0 : 380);
        };
        const key = (e) => { if (e.key === 'Escape') close(false); };
        el.addEventListener('click', (e) => { if (e.target.closest('[data-go]')) close(true); else if (e.target.closest('[data-later]')) close(false); });
        document.addEventListener('keydown', key);
        document.body.appendChild(el);
        document.documentElement.style.overflow = 'hidden';
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
        setTimeout(() => { try { el.querySelector('[data-go]').focus({ preventScroll: true }); } catch (e) { } }, 2300);
        return { el, close };
    }

    // ---------- Miss Marwa's card (her photo + what she says) ----------
    function teacher({ text, sub = '', action = '', attrs = '' } = {}) {
        css();
        return `<div class="art" role="note"><div class="art-ph"><img src="/assets/img/marwa-160.png" alt="Miss Marwa" width="74" height="74" loading="lazy"><span class="bot">${head(22)}</span></div>
            <div class="art-tx"><div class="art-who">Miss Marwa</div><div class="art-say" dir="rtl">${esc(text)}</div>${sub ? `<div class="art-sub">${esc(sub)}</div>` : ''}</div>
            ${action ? `<button class="art-go" type="button" ${attrs}>${esc(action)}</button>` : ''}</div>`;
    }

    // ---------- the small robot on every student page ----------
    let L = null;
    function launcher({ href = 'assistant.html', lines = [], first = 2600, every = 26000, stay = 4200 } = {}) {
        css();
        if (L) return L;
        const el = document.createElement('div');
        el.className = 'arl';
        el.innerHTML = `<a class="arl-btn" href="${esc(href)}" aria-label="Open Miss Marwa Assistant Pro" title="Miss Marwa Assistant Pro">${head(36)}</a><div class="arl-bub" role="status"><b>Assistant Pro</b><span></span></div>`;
        document.body.appendChild(el);
        el.querySelector('.arl-bub').addEventListener('click', () => { location.href = href; });
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
        let n = 0, t1 = null, t2 = null;
        const talk = () => {
            // quiet while the page's own Assistant Pro badge is talking (never two bubbles at once)
            if (!lines.length || document.hidden || el.classList.contains('hide') || document.querySelector('.aip.out')) { t1 = setTimeout(talk, 6000); return; }
            el.querySelector('.arl-bub span').textContent = lines[n++ % lines.length];
            el.classList.add('talk');
            t2 = setTimeout(() => { el.classList.remove('talk'); t1 = setTimeout(talk, every); }, stay);
        };
        t1 = setTimeout(talk, first);
        // never on top of an open dialog, the keyboard or the page's own bottom buttons
        const obs = new MutationObserver(() => el.classList.toggle('hide', !!document.querySelector('.ard-back, .arw, .sheet-backdrop.open, .modal.open, dialog[open]')));
        obs.observe(document.body, { childList: true, subtree: false, attributes: false });
        L = { el, hide: (v) => el.classList.toggle('hide', v !== false), remove: () => { clearTimeout(t1); clearTimeout(t2); obs.disconnect(); el.remove(); L = null; } };
        return L;
    }

    // ---------- the slim credits meter for the chat (shown once more than half is used) ----------
    function meter(c, { always = false } = {}) {
        if (!c || !(c.budget > 0)) return '';
        const pct = Math.max(0, Math.min(100, c.left / c.budget * 100));
        if (!always && pct > 50) return '';
        css();
        return `<div class="arm" role="status"><span>${c.mode === 'trial' ? 'Trial credits' : 'Credits'}</span><span class="ard-bar${pct < 20 ? ' low' : ''}"><i style="width:${pct}%"></i></span><b>${n1(c.left)} / ${n1(c.budget)}</b><button type="button" data-guide>Details</button></div>`;
    }

    window.AiRobot = { svg, head, intro, guide, subscribe, welcome, teacher, launcher, meter, css, dayEn, dayAr, n1 };
})();
