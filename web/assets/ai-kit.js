/* =====================================================================
   AiKit — shared pieces of the AI chats (Miss Marwa's AI Assistant + the students' assistant)
   • AiKit.md(text)          safe mini-markdown with clean Arabic/English mixing (English terms isolated)
   • AiKit.shrink(file)      photo → JPEG ≤ 1280 px  { mime, b64, url }
   • AiKit.composer(el, opt) the input bar:   [ ↑ send ][ 🎤 ][ Model ⌄ ] ……… [ + ]
                               + a photo preview row and the text box above it
   No dependencies. Styles are injected once (they use the site's colour tokens).
   ===================================================================== */
(function () {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const SVG = {
        send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
        mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
        plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
        chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
        lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
        stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
    };

    // ---------- text: safe markdown subset + Arabic/English ----------
    const AR = /[؀-ۿ]/, LAT = /[A-Za-z]/;
    const firstStrong = (s) => { for (const ch of s) { if (AR.test(ch)) return 'rtl'; if (LAT.test(ch)) return 'ltr'; } return 'auto'; };
    const isolate = (escaped, dir) => dir !== 'rtl' ? escaped
        : escaped.replace(/([A-Za-z0-9][A-Za-z0-9 _.,:;'’()\[\]\/+\-−×÷=^%°⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉→&;#]*[A-Za-z0-9)\]⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉%°])|([A-Za-z])/g, (m) => /&[a-z]+;?$|&#\d+;?$/.test(m) ? m : `<bdi dir="ltr">${m}</bdi>`);
    function inline(text, dir) {
        return text.split(/(`[^`]+`)/).map(part => {
            if (/^`[^`]+`$/.test(part)) return `<code dir="ltr">${esc(part.slice(1, -1))}</code>`;
            return part.split(/(\*\*[^*]+\*\*)/).map(p => {
                const bold = /^\*\*[^*]+\*\*$/.test(p);
                const t = isolate(esc(bold ? p.slice(2, -2) : p), dir);
                return bold ? `<b>${t}</b>` : t;
            }).join('');
        }).join('');
    }
    function md(src) {
        const lines = String(src || '').replace(/\r/g, '').split('\n');
        let html = '', list = null, para = [], code = null;
        const flushPara = () => { if (para.length) { const t = para.join('\n'); const d = firstStrong(t); html += `<p dir="${d}">${inline(t, d).replace(/\n/g, '<br>')}</p>`; para = []; } };
        const flushList = () => { if (list) { html += `<${list.type}>${list.items.map(it => { const d = firstStrong(it); return `<li dir="${d}">${inline(it, d)}</li>`; }).join('')}</${list.type}>`; list = null; } };
        for (const line of lines) {
            if (code !== null) { if (/^```/.test(line.trim())) { html += `<pre><code>${esc(code.join('\n'))}</code></pre>`; code = null; } else code.push(line); continue; }
            if (/^```/.test(line.trim())) { flushPara(); flushList(); code = []; continue; }
            const h = line.match(/^\s*#{1,6}\s+(.*)$/);
            const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (h) { flushPara(); flushList(); const d = firstStrong(h[1]); html += `<h4 dir="${d}">${inline(h[1].replace(/\*\*/g, ''), d)}</h4>`; }
            else if (ul || ol) { flushPara(); const type = ul ? 'ul' : 'ol'; if (!list || list.type !== type) { flushList(); list = { type, items: [] }; } list.items.push((ul || ol)[1]); }
            else if (!line.trim()) { flushPara(); flushList(); }
            else { flushList(); para.push(line); }
        }
        if (code !== null) html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
        flushPara(); flushList();
        return html;
    }

    // ---------- photo → small JPEG ----------
    function shrink(file, max = 1280, quality = 0.82) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\//.test(file.type || 'image/')) return reject(new Error('Choose a photo'));
            const url = URL.createObjectURL(file);
            const im = new Image();
            im.onload = () => {
                const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
                const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
                const c = document.createElement('canvas'); c.width = w; c.height = h;
                const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
                URL.revokeObjectURL(url);
                const data = c.toDataURL('image/jpeg', quality);
                resolve({ mime: 'image/jpeg', b64: data.split(',')[1], url: data, width: w, height: h });
            };
            im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This photo can't be opened — try another one")); };
            im.src = url;
        });
    }

    // ---------- styles ----------
    const CSS = `
    .ak { display: grid; gap: 4px; padding: 8px; border-radius: 24px; background: var(--surface); border: 1.5px solid var(--border); box-shadow: 0 12px 32px -16px rgba(15, 23, 42, .4); }
    .ak:focus-within { border-color: var(--primary); }
    .ak-att { display: flex; gap: 8px; align-items: center; padding: 2px 4px 4px; }
    .ak-att[hidden] { display: none; }
    .ak-thumb { position: relative; width: 64px; height: 64px; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); flex: none; }
    .ak-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ak-thumb button { position: absolute; top: 3px; right: 3px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: rgba(15, 23, 42, .72); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; }
    .ak-thumb button svg { width: 12px; height: 12px; }
    .ak-att small { color: var(--muted); font-size: 12px; }
    .ak textarea { width: 100%; box-sizing: border-box; border: 0; outline: 0; resize: none; background: transparent; color: var(--text); font: inherit; font-size: 16px; line-height: 1.45; padding: 6px 8px; max-height: 160px; min-height: 40px; }
    .ak-row { display: flex; align-items: center; gap: 6px; }
    .ak-row .sp { flex: 1; }
    .ak-b { width: 40px; height: 40px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; flex: none; color: var(--text-2); background: var(--surface-2); padding: 0; }
    .ak-b svg { width: 20px; height: 20px; }
    .ak-b:hover { color: var(--primary); }
    .ak-b.send { background: var(--primary); color: #fff; }
    .ak-b.send:disabled { opacity: .4; cursor: default; }
    .ak-b.listening { background: var(--danger); color: #fff; animation: akpulse 1.2s infinite; }
    .ak-b[hidden] { display: none; }
    @keyframes akpulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 55%, transparent); } 70% { box-shadow: 0 0 0 12px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
    .ak-pill { height: 40px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font: inherit; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; padding: 0 10px 0 12px; cursor: pointer; min-width: 0; max-width: 46vw; }
    .ak-pill span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ak-pill svg { width: 16px; height: 16px; flex: none; opacity: .7; }
    .ak-pill.max { background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 14%, var(--surface)), color-mix(in srgb, #ec4899 12%, var(--surface))); }
    .ak-menu { position: fixed; z-index: 1000; min-width: 250px; max-width: calc(100vw - 24px); background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: 0 18px 50px -12px rgba(15, 23, 42, .45); padding: 6px; animation: akin .16s ease-out; }
    @keyframes akin { from { opacity: 0; transform: translateY(6px); } }
    .ak-menu .it { display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent; color: var(--text); font: inherit; text-align: start; padding: 10px 12px; border-radius: 12px; cursor: pointer; }
    .ak-menu .it:hover { background: var(--surface-2); }
    .ak-menu .it b { display: block; font-size: 14px; }
    .ak-menu .it small { display: block; color: var(--muted); font-size: 12px; }
    .ak-menu .it .tx { flex: 1; min-width: 0; }
    .ak-menu .it svg { width: 18px; height: 18px; flex: none; }
    .ak-menu .it.on { background: var(--primary-soft); }
    .ak-menu .it.on svg { color: var(--primary); }
    .ak-menu .it.off { opacity: .6; }
    .ak-menu hr { border: 0; border-top: 1px solid var(--border); margin: 4px 6px; }
    .ak-menu .seg { display: inline-flex; gap: 4px; }
    .ak-menu .seg button { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 999px; font: inherit; font-size: 12px; font-weight: 700; padding: 4px 10px; cursor: pointer; }
    .ak-menu .seg button.on { background: var(--primary); border-color: var(--primary); color: #fff; }
    .ak-scrim { position: fixed; inset: 0; z-index: 999; }
    @media (prefers-reduced-motion: reduce) { .ak-b.listening, .ak-menu { animation: none; } }`;
    function injectCss() { if (document.getElementById('ak-css')) return; const s = document.createElement('style'); s.id = 'ak-css'; s.textContent = CSS; document.head.appendChild(s); }

    const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

    /**
     * composer(el, {
     *   models: [{ tier, name, note, ready, locked }], tier, placeholder, maxLength,
     *   onSend({ text, image }) → may return a Promise, onTier(tier), onLocked(model),
     *   beforeAttach() → true | 'message why not', toast(msg, kind), voiceKey
     * })
     */
    function composer(el, opt) {
        injectCss();
        const o = Object.assign({ models: [], tier: 'free', placeholder: 'Ask anything…', maxLength: 4000, voiceKey: 'ai_voice', toast: (m) => alert(m) }, opt || {});
        let models = o.models, tier = o.tier, busy = false, image = null, rec = null, listening = false;
        let voiceLang = store.get(o.voiceKey, 'ar-EG');
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        el.innerHTML = `<div class="ak">
            <div class="ak-att" hidden><div class="ak-thumb"><img alt="Photo to send"><button type="button" class="ak-rm" aria-label="Remove photo">${SVG.x}</button></div><small>Photo ready — add a note or just send</small></div>
            <textarea rows="1" dir="auto" maxlength="${o.maxLength}" placeholder="${esc(o.placeholder)}" aria-label="Message"></textarea>
            <div class="ak-row">
                <button type="button" class="ak-b send" aria-label="Send" disabled>${SVG.send}</button>
                <button type="button" class="ak-b mic" aria-label="Speak" ${SR ? '' : 'hidden'}>${SVG.mic}</button>
                <button type="button" class="ak-pill" aria-haspopup="menu" aria-label="Choose model"><span></span>${SVG.chev}</button>
                <span class="sp"></span>
                <button type="button" class="ak-b plus" aria-label="Add a photo">${SVG.plus}</button>
                <input type="file" accept="image/*" hidden>
            </div></div>`;
        const $ = (s) => el.querySelector(s);
        const ta = $('textarea'), sendB = $('.send'), micB = $('.mic'), pill = $('.ak-pill'), plus = $('.plus'), file = $('input[type=file]'), att = $('.ak-att');
        const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
        const update = () => { sendB.disabled = busy || (!ta.value.trim() && !image); };
        const cur = () => models.find(m => m.tier === tier) || models[0] || { name: '—' };
        const drawPill = () => { const m = cur(); pill.querySelector('span').textContent = m.name; pill.classList.toggle('max', m.tier === 'max'); };

        // model menu
        function closeMenu() { document.querySelectorAll('.ak-menu, .ak-scrim').forEach(x => x.remove()); pill.setAttribute('aria-expanded', 'false'); }
        function openMenu() {
            closeMenu();
            const scrim = document.createElement('div'); scrim.className = 'ak-scrim'; scrim.addEventListener('click', closeMenu);
            const menu = document.createElement('div'); menu.className = 'ak-menu'; menu.setAttribute('role', 'menu');
            menu.innerHTML = models.map(m => `<button type="button" class="it ${m.tier === tier ? 'on' : ''} ${m.ready ? '' : 'off'}" role="menuitemradio" aria-checked="${m.tier === tier}" data-tier="${esc(m.tier)}">
                    <span class="tx"><b>${esc(m.name)}</b><small>${esc(m.ready ? (m.note || '') : (m.locked ? (m.note || 'Locked') : 'Not connected yet'))}</small></span>${m.tier === tier ? SVG.check : m.ready ? '' : SVG.lock}</button>`).join('')
                + (SR ? `<hr><div class="it" style="cursor:default"><span class="tx"><b>Voice</b><small>Language for the 🎤 button</small></span><span class="seg"><button type="button" data-voice="ar-EG" class="${voiceLang === 'ar-EG' ? 'on' : ''}">عربي</button><button type="button" data-voice="en-US" class="${voiceLang === 'en-US' ? 'on' : ''}">EN</button></span></div>` : '');
            document.body.append(scrim, menu);
            const r = pill.getBoundingClientRect();
            menu.style.left = Math.max(12, Math.min(r.left, innerWidth - menu.offsetWidth - 12)) + 'px';
            menu.style.top = Math.max(12, r.top - menu.offsetHeight - 8) + 'px';
            pill.setAttribute('aria-expanded', 'true');
            menu.addEventListener('click', (e) => {
                const v = e.target.closest('[data-voice]'); if (v) { voiceLang = v.dataset.voice; store.set(o.voiceKey, voiceLang); menu.querySelectorAll('[data-voice]').forEach(b => b.classList.toggle('on', b === v)); return; }
                const it = e.target.closest('[data-tier]'); if (!it) return;
                const m = models.find(x => x.tier === it.dataset.tier);
                closeMenu();
                if (!m.ready) { o.onLocked && o.onLocked(m); return; }
                tier = m.tier; drawPill(); o.onTier && o.onTier(tier);
            });
        }
        pill.addEventListener('click', () => (document.querySelector('.ak-menu') ? closeMenu() : openMenu()));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

        // photo
        plus.addEventListener('click', () => {
            const ok = o.beforeAttach ? o.beforeAttach() : true;
            if (ok !== true) { if (ok) o.toast(ok, 'error'); return; }
            file.click();
        });
        file.addEventListener('change', async () => {
            const f = file.files && file.files[0]; file.value = '';
            if (!f) return;
            try { setImage(await shrink(f)); } catch (e) { o.toast(e.message, 'error'); }
        });
        function setImage(img) { image = img; att.hidden = !img; if (img) att.querySelector('img').src = img.url; update(); if (img) ta.focus(); }
        $('.ak-rm').addEventListener('click', () => setImage(null));

        // text + send
        ta.addEventListener('input', () => { autosize(); update(); });
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover) and (pointer: fine)').matches) { e.preventDefault(); go(); }
        });
        async function go() {
            const text = ta.value.trim(); if ((!text && !image) || busy) return;
            const img = image; ta.value = ''; setImage(null); autosize();
            await o.onSend({ text, image: img ? { mime: img.mime, b64: img.b64, url: img.url } : null });
        }
        sendB.addEventListener('click', go);

        // voice (the phone's own speech recognition — free)
        if (SR) micB.addEventListener('click', () => {
            if (listening) { rec && rec.stop(); return; }
            rec = new SR(); rec.lang = voiceLang; rec.interimResults = true; rec.continuous = false;
            const before = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
            rec.onresult = (ev) => { let t = ''; for (const r of ev.results) t += r[0].transcript; ta.value = before + t; autosize(); update(); };
            rec.onerror = (ev) => { if (ev.error === 'not-allowed') o.toast('Allow the microphone to use voice', 'error'); };
            rec.onend = () => { listening = false; micB.classList.remove('listening'); micB.innerHTML = SVG.mic; ta.focus(); };
            try { rec.start(); listening = true; micB.classList.add('listening'); micB.innerHTML = SVG.stop; } catch (e) { o.toast('Voice is not available here', 'error'); }
        });

        drawPill(); autosize(); update();
        return {
            get tier() { return tier; },
            setTier(t) { tier = t; drawPill(); },
            setModels(m) { models = m; if (!models.find(x => x.tier === tier && x.ready)) tier = (models.find(x => x.ready) || models[0] || {}).tier || tier; drawPill(); },
            setBusy(b) { busy = !!b; update(); },
            fill(t) { ta.value = t; autosize(); update(); ta.focus(); },
            focus() { ta.focus(); },
            textarea: ta
        };
    }

    window.AiKit = { md, shrink, composer, esc, SVG };
})();
