/* =====================================================================
   StudioRender — the Science Academy look for the studio's summaries and exams (screen preview = the PDF).
   Pro writes content only (JSON); this fixed template does the layout — free, identical every time.
   • summaryHtml(doc, { edit })   exhaustive lesson summary in Miss Marwa's style (term boxes, G.R, arrows, tables…)
   • examHtml(doc, { edit, key }) printable exam like her own sample (+ the Model Answer page when key = true)
   • onlineHtml(doc, { edit })    the MCQ quiz (correct answers marked) before publishing
   • print(innerHtml, title)       → the browser's "Save as PDF" (vector text, A4, page numbers)
   Editable text carries data-e="<path>" (contenteditable) so the studio can write edits back into the JSON.
   ===================================================================== */
(function () {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // **bold** inside text (her key words), everything else escaped
    const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const ed = (o, path, text, tag = 'span', cls = '') => o.edit
        ? `<${tag} class="${cls}" data-e="${path}" contenteditable="true" spellcheck="false">${rich(text)}</${tag}>`
        : `<${tag} class="${cls}">${rich(text)}</${tag}>`;
    const LETTER = ['a', 'b', 'c', 'd', 'e', 'f'];
    const ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
    const GRADE = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
    const tools = (o, path, { regen = false } = {}) => o.edit ? `<span class="sx-tools" contenteditable="false">${regen ? `<button type="button" class="sx-t" data-regen="${path}" title="Write this question again">↻</button>` : ''}<button type="button" class="sx-t" data-del="${path}" title="Remove">✕</button></span>` : '';

    const CSS = `
    .sx { --navy: #0B1F4D; --blue: #1D4ED8; --sky: #E8F0FF; --line: #C9D8F5; --ink: #0F172A; --muted: #64748B;
        color: var(--ink); background: #fff; font: 400 14.5px/1.55 Inter, "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", sans-serif; }
    .sx * { box-sizing: border-box; }
    .sx-page { background: #fff; width: 100%; max-width: 794px; margin: 0 auto; padding: 34px 40px 40px; }
    .sx [contenteditable="true"] { outline: none; border-radius: 4px; transition: background .12s; }
    .sx [contenteditable="true"]:hover { background: #F1F6FF; } .sx [contenteditable="true"]:focus { background: #FFF8DB; box-shadow: 0 0 0 2px #FDE68A; }
    .sx-tools { position: absolute; top: 0; right: 0; z-index: 2; display: inline-flex; gap: 4px; opacity: 0; transition: opacity .12s; }
    .sx-blk:hover > .sx-tools, .sx-q:hover > .sx-tools { opacity: 1; }
    .sx-t { border: 1px solid var(--line); background: #fff; color: var(--muted); width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 13px; line-height: 1; }
    .sx-t:hover { color: var(--blue); border-color: var(--blue); } .sx-t[data-del]:hover { color: #DC2626; border-color: #DC2626; }
    /* brand header */
    .sx-brand { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 14px; background: linear-gradient(110deg, var(--navy), var(--blue)); color: #fff; margin-bottom: 18px; }
    .sx-brand img { width: 46px; height: 46px; border-radius: 50%; background: #fff; padding: 3px; }
    .sx-brand .b1 { font-weight: 800; font-size: 17px; letter-spacing: -.01em; line-height: 1.15; }
    .sx-brand .b2 { font-size: 12px; opacity: .85; }
    .sx-brand .b3 { margin-left: auto; text-align: right; font-size: 12px; font-weight: 600; opacity: .95; line-height: 1.4; }
    /* ---------- summary ---------- */
    .sx-h1 { font-size: 23px; font-weight: 850; letter-spacing: -.02em; color: var(--navy); margin: 2px 0 14px; padding-bottom: 8px; border-bottom: 3px solid var(--blue); }
    .sx-blk { break-inside: avoid; margin: 0 0 11px; position: relative; }
    .sx-sec { margin: 20px 0 10px; font-size: 17px; font-weight: 800; color: var(--blue); display: flex; align-items: center; gap: 8px; break-after: avoid; }
    .sx-sec::before { content: ''; width: 6px; height: 20px; border-radius: 3px; background: var(--blue); }
    .sx-term { padding: 9px 12px; border-left: 4px solid var(--blue); background: var(--sky); border-radius: 4px 10px 10px 4px; }
    .sx-term .k { display: inline-block; font-weight: 800; color: var(--navy); border: 1.5px solid var(--blue); border-radius: 999px; padding: 1px 11px; margin-right: 6px; background: #fff; }
    .sx-lbl { font-weight: 800; color: var(--navy); }
    .sx ul, .sx ol { margin: 4px 0 0; padding-left: 22px; } .sx li { margin: 2px 0; } .sx ul li::marker { color: var(--blue); }
    .sx-arr { display: grid; grid-template-columns: 1fr auto 1fr; gap: 6px 10px; align-items: center; margin-top: 4px; }
    .sx-arr .ar { color: var(--blue); font-weight: 900; }
    .sx-ex { padding-left: 2px; } .sx-ex .tag, .sx-gr .tag, .sx-note .tag { display: inline-block; font-size: 11.5px; font-weight: 800; padding: 1px 8px; border-radius: 6px; margin-right: 6px; vertical-align: 1px; }
    .sx-ex .tag { background: var(--sky); color: var(--blue); }
    .sx-facts { display: flex; flex-wrap: wrap; gap: 6px 14px; } .sx-facts .f { padding: 3px 10px; border: 1px solid var(--line); border-radius: 8px; }
    .sx-gr { padding: 9px 12px; border: 1.5px solid var(--line); border-radius: 10px; }
    .sx-gr .tag { background: var(--navy); color: #fff; } .sx-gr .q { font-weight: 700; } .sx-gr .a { display: block; margin-top: 3px; }
    .sx-eq { text-align: center; font-weight: 700; padding: 8px 12px; border: 1.5px dashed var(--blue); border-radius: 10px; color: var(--navy); }
    .sx-note { padding: 8px 12px; border-radius: 10px; background: #FFFBEB; border: 1px solid #FDE68A; } .sx-note .tag { background: #F59E0B; color: #fff; }
    .sx-fig { padding: 8px 12px; border: 1.5px dashed var(--line); border-radius: 10px; color: var(--muted); font-size: 13.5px; }
    .sx table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 13.5px; }
    .sx th, .sx td { border: 1px solid var(--line); padding: 6px 8px; vertical-align: top; text-align: left; }
    .sx th { background: var(--blue); color: #fff; font-weight: 700; } .sx td.rl { background: var(--sky); font-weight: 700; color: var(--navy); width: 22%; }
    .sx-key { padding: 12px 14px; border-radius: 12px; background: var(--navy); color: #fff; } .sx-key li::marker { color: #93C5FD; } .sx-key .sx-lbl { color: #fff; }
    .sx-lesson + .sx-lesson { break-before: page; }
    /* ---------- exam ---------- */
    .sx-ex-h { text-align: center; margin-bottom: 10px; } .sx-ex-h .t { font-size: 21px; font-weight: 850; color: var(--navy); } .sx-ex-h .s { color: var(--muted); font-size: 13px; margin-top: 2px; }
    .sx-fields { display: grid; grid-template-columns: 2.2fr 1fr 1.4fr 1.2fr; gap: 8px 14px; font-size: 13.5px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px; margin: 10px 0 6px; }
    .sx-fields span { white-space: nowrap; overflow: hidden; }
    .sx-inst { text-align: center; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .sx-st { margin: 16px 0 8px; padding: 6px 12px; border-radius: 8px; background: var(--sky); color: var(--navy); font-weight: 800; break-after: avoid; display: flex; justify-content: space-between; gap: 10px; }
    .sx-st .m { color: var(--blue); white-space: nowrap; }
    .sx-q { break-inside: avoid; margin: 0 0 10px; padding-left: 26px; position: relative; }
    .sx-q > .n { position: absolute; left: 0; top: 0; font-weight: 800; color: var(--navy); }
    .sx-opts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px 12px; margin-top: 4px; }
    .sx-opts.long { grid-template-columns: 1fr 1fr; } .sx-opts.vlong { grid-template-columns: 1fr; }
    .sx-opt .l { font-weight: 700; color: var(--navy); margin-right: 4px; } .sx-opt.ok .l { color: #fff; background: #16A34A; border-radius: 50%; padding: 0 6px; }
    .sx-opt.ok { color: #166534; font-weight: 700; } [data-pick] { cursor: pointer; }
    .sx-dots { display: block; border-bottom: 1.5px dotted #94A3B8; height: 22px; margin-top: 2px; }
    .sx-tf { white-space: nowrap; font-weight: 700; color: var(--navy); }
    .sx-ans { color: #166534; font-weight: 600; } .sx-ans b { color: #15803D; }
    .sx-luck { text-align: center; font-weight: 800; color: var(--blue); margin-top: 18px; font-size: 16px; }
    .sx-pdf .sx-page { max-width: none; padding: 0 2px; margin: 0; } .sx-pdf .sx-keypage { margin-top: 0; padding-top: 0; border-top: 0; }
    .sx-keypage { break-before: page; } .sx-keytab { margin-top: 4px; color: var(--ink); font-weight: 400; } .sx-keytab td { color: #166534; } .sx-keypage .sx-h1 { font-size: 20px; }
    .sx-src { color: #94A3B8; font-size: 11px; margin-left: 4px; white-space: nowrap; }
    @media screen { .sx-keypage { margin-top: 26px; padding-top: 20px; border-top: 2px dashed var(--line); } }
    @media (max-width: 640px) { .sx-page { padding: 18px 14px 24px; } .sx-opts { grid-template-columns: 1fr 1fr; } .sx-fields { grid-template-columns: 1fr 1fr; } .sx-brand .b3 { display: none; } .sx-arr { grid-template-columns: 1fr; } .sx-arr .ar { transform: rotate(90deg); justify-self: start; } }
    @media print { .sx-tools { display: none !important; } .sx [contenteditable] { background: none !important; box-shadow: none !important; } }
    `;

    const brand = (doc, right) => `<div class="sx-brand"><img src="/assets/img/logo-96.png" alt=""><div><div class="b1">Science Academy</div><div class="b2">with Miss Marwa</div></div><div class="b3">${right}</div></div>`;

    // ---------------------------------------------------------------- summary
    function block(b, path, o) {
        const t = tools(o, path);
        switch (b.t) {
            case 'section': return `<div class="sx-blk sx-sec">${ed(o, path + '.title', b.title)}${t}</div>`;
            case 'term': return `<div class="sx-blk sx-term">${t}${ed(o, path + '.term', b.term, 'span', 'k')}${ed(o, path + '.def', b.def)}</div>`;
            case 'points': { const L = b.ordered ? 'ol' : 'ul'; return `<div class="sx-blk">${t}${b.title ? `<div>${ed(o, path + '.title', b.title, 'span', 'sx-lbl')}</div>` : ''}<${L}>${b.items.map((x, i) => `<li>${ed(o, `${path}.items.${i}`, x)}</li>`).join('')}</${L}></div>`; }
            case 'arrows': return `<div class="sx-blk">${t}${b.title ? `<div>${ed(o, path + '.title', b.title, 'span', 'sx-lbl')}</div>` : ''}<div class="sx-arr">${b.items.map((x, i) => `<div>${ed(o, `${path}.items.${i}.from`, x.from)}</div><div class="ar">⟶</div><div>${ed(o, `${path}.items.${i}.to`, x.to)}</div>`).join('')}</div></div>`;
            case 'example': return `<div class="sx-blk sx-ex">${t}<span class="tag">Ex</span>${ed(o, path + '.text', b.text)}</div>`;
            case 'facts': return `<div class="sx-blk sx-facts">${t}${b.items.map((x, i) => `<span class="f">${ed(o, `${path}.items.${i}.k`, x.k, 'span', 'sx-lbl')}: ${ed(o, `${path}.items.${i}.v`, x.v)}</span>`).join('')}</div>`;
            case 'compare': return `<div class="sx-blk">${t}${b.title ? `<div>${ed(o, path + '.title', b.title, 'span', 'sx-lbl')}</div>` : ''}<table><thead><tr><th></th>${b.cols.map((c, i) => `<th>${ed(o, `${path}.cols.${i}`, c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r, i) => `<tr><td class="rl">${ed(o, `${path}.rows.${i}.label`, r.label)}</td>${r.cells.map((c, j) => `<td>${ed(o, `${path}.rows.${i}.cells.${j}`, c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
            case 'reason': return `<div class="sx-blk sx-gr">${t}<span class="tag">G.R</span>${ed(o, path + '.q', b.q, 'span', 'q')}${ed(o, path + '.a', b.a, 'span', 'a')}</div>`;
            case 'equation': return `<div class="sx-blk sx-eq">${t}${ed(o, path + '.text', b.text)}</div>`;
            case 'note': return `<div class="sx-blk sx-note">${t}<span class="tag">Note</span>${ed(o, path + '.text', b.text)}</div>`;
            case 'figure': return `<div class="sx-blk sx-fig">${t}📖 Look at the figure in your book${b.p && o.edit ? ` <span class="sx-src">(PDF p.${b.p})</span>` : ''}: ${ed(o, path + '.text', b.text)}</div>`;
            default: return '';
        }
    }
    function summaryHtml(doc, o = {}) {
        const lessons = (doc.content && doc.content.lessons) || [];
        return `<div class="sx">${lessons.map((L, li) => {
            const last = L.blocks.length && L.blocks[L.blocks.length - 1];
            const keyIdx = last && last.t === 'points' && /key points/i.test(last.title || '') ? L.blocks.length - 1 : -1;
            return `<div class="sx-page sx-lesson">${brand(doc, `${GRADE[doc.grade] || ''} · Science<br>Unit ${L.unit} · Lesson ${L.lesson}`)}
                ${ed(o, `lessons.${li}.title`, L.title, 'div', 'sx-h1')}
                ${L.blocks.map((b, i) => i === keyIdx ? `<div class="sx-blk sx-key">${tools(o, `lessons.${li}.blocks.${i}`)}<div class="sx-lbl">⭐ ${esc(b.title)}</div><ul>${b.items.map((x, k) => `<li>${ed(o, `lessons.${li}.blocks.${i}.items.${k}`, x)}</li>`).join('')}</ul></div>` : block(b, `lessons.${li}.blocks.${i}`, o)).join('')}
            </div>`;
        }).join('')}</div>`;
    }

    // ---------------------------------------------------------------- exam
    const total = (doc) => doc.content.sections.reduce((t, s) => t + s.items.length * (Number(s.marks) || 0), 0);
    function question(s, si, q, qi, n, o) {
        const path = `sections.${si}.items.${qi}`, t = tools(o, path, { regen: o.edit });
        const src = o.key && q.p ? `<span class="sx-src">p.${q.p}</span>` : '';
        const head = `<span class="n">${n}.</span>${t}`;
        switch (s.type) {
            case 'mcq': {
                const len = Math.max(...q.options.map(x => String(x).length));
                return `<div class="sx-q">${head}${ed(o, path + '.q', q.q)}${src}<div class="sx-opts ${len > 46 ? 'vlong' : len > 20 ? 'long' : ''}">${q.options.map((x, k) => `<div class="sx-opt ${o.key && k === q.answer ? 'ok' : ''}"><span class="l" ${o.edit ? `data-pick="${path}" data-k="${k}" title="Mark as the correct answer"` : ''}>${LETTER[k]})</span>${ed(o, `${path}.options.${k}`, x)}</div>`).join('')}</div></div>`;
            }
            case 'complete': return `<div class="sx-q">${head}${ed(o, path + '.q', q.q)}${src}</div>`;
            case 'tf': return `<div class="sx-q">${head}${ed(o, path + '.q', q.q)} <span class="sx-tf" ${o.edit ? `data-tf="${path}" title="Switch ✓ / ✗"` : ''}>(${o.key ? (q.answer ? ' ✓ ' : ' ✗ ') : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'})</span>${src}${!o.key ? '<span class="sx-dots"></span>' : ''}</div>`;
            case 'term': return `<div class="sx-q">${head}${ed(o, path + '.q', q.q)} <b>(...........................)</b>${src}</div>`;
            case 'compare': return `<div class="sx-q">${head}${ed(o, path + '.q', q.q)}${src}<table><thead><tr><th>Point of comparison</th><th>${esc(q.a)}</th><th>${esc(q.b)}</th></tr></thead><tbody>${q.points.map((pt, k) => `<tr><td class="rl">${esc(pt)}</td><td>${o.key ? esc(q.answer[k] && q.answer[k][0]) : '<br><br>'}</td><td>${o.key ? esc(q.answer[k] && q.answer[k][1]) : '<br><br>'}</td></tr>`).join('')}</tbody></table></div>`;
            default: return `<div class="sx-q">${head}${ed(o, path + '.q', q.q)}${src}${!o.key ? '<span class="sx-dots"></span><span class="sx-dots"></span>' : ''}</div>`;
        }
    }
    function answer(s, q) {
        switch (s.type) {
            case 'mcq': return `<b>${LETTER[q.answer]})</b> ${esc(q.options[q.answer])}`;
            case 'complete': return q.answer.map(esc).join(' — ');
            case 'tf': return q.answer ? '<b>(✓)</b>' : `<b>(✗)</b> ${esc(q.correction || '')}`;
            case 'compare': {
                const cut = (name, v) => { const t = String(v || ''); const re = new RegExp('^\\s*' + String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:\\-–]\\s*', 'i'); return name ? t.replace(re, '') : t; };
                return `<table class="sx-keytab"><thead><tr><th></th><th>${esc(q.a)}</th><th>${esc(q.b)}</th></tr></thead><tbody>${q.points.map((pt, k) => `<tr><td class="rl">${esc(pt)}</td><td>${esc(cut(q.a, q.answer[k] && q.answer[k][0]))}</td><td>${esc(cut(q.b, q.answer[k] && q.answer[k][1]))}</td></tr>`).join('')}</tbody></table>`;
            }
            default: return esc(q.answer);
        }
    }
    function examHtml(doc, o = {}) {
        const c = doc.content, T = total(doc);
        let n = 0;
        const paper = `<div class="sx-page">${brand(doc, `${GRADE[doc.grade] || ''} · Science`)}
            <div class="sx-ex-h">${ed(o, 'title', c.title, 'div', 't')}${ed(o, 'subtitle', c.subtitle || '', 'div', 's')}</div>
            <div class="sx-fields"><span>Name: ........................................</span><span>Class: ..........</span><span>Date: ...../...../.......</span><span>Mark: ...... / ${T}</span></div>
            <div class="sx-inst">Answer all questions.</div>
            ${c.sections.map((s, si) => !s.items.length ? '' : `<div class="sx-st"><span>${ORD[si] || ''}: ${ed(o, `sections.${si}.title`, s.title)}</span><span class="m">(${s.items.length * (Number(s.marks) || 0)} marks)</span></div>
                ${s.items.map((q, qi) => question(s, si, q, qi, ++n, { ...o, key: false })).join('')}`).join('')}
            <div class="sx-luck">Good Luck ✨</div></div>`;
        if (!o.key) return `<div class="sx">${paper}</div>`;
        n = 0;
        const key = `<div class="sx-page sx-keypage">${brand(doc, 'Model Answer<br>for the teacher')}<div class="sx-h1">Model Answer — ${esc(c.title)}</div>
            ${c.sections.map((s, si) => !s.items.length ? '' : `<div class="sx-st"><span>${ORD[si] || ''}: ${esc(s.title)}</span><span class="m">(${s.items.length * (Number(s.marks) || 0)} marks)</span></div>
                ${s.items.map(q => `<div class="sx-q"><span class="n">${++n}.</span><span class="sx-ans">${answer(s, q)}</span>${q.p ? `<span class="sx-src">PDF p.${q.p}</span>` : ''}</div>`).join('')}`).join('')}</div>`;
        return `<div class="sx">${paper}${key}</div>`;
    }
    function onlineHtml(doc, o = {}) {
        const c = doc.content; let n = 0;
        return `<div class="sx"><div class="sx-page">${brand(doc, `${GRADE[doc.grade] || ''} · Online quiz`)}
            <div class="sx-ex-h">${ed(o, 'title', c.title, 'div', 't')}<div class="s">${c.sections.reduce((t, s) => t + s.items.length, 0)} multiple-choice questions · the correct answer is marked in green${o.edit ? ' — tap a letter to change it' : ''}</div></div>
            ${c.sections.map((s, si) => s.items.map((q, qi) => question(s, si, q, qi, ++n, { ...o, key: true })).join('')).join('')}</div></div>`;
    }

    // ---------------------------------------------------------------- PDF file download (one tap → a .pdf file, no print window)
    // html2pdf (html2canvas + jsPDF) draws each page of the template at high resolution into an A4 PDF.
    // Each .sx-page (a lesson / the exam / the model answer) is drawn separately → long documents never hit canvas limits.
    const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    let libP = null;
    const PDF_W = 711;     // A4 width minus the 11 mm side margins, in CSS px (188 mm)
    function loadLib() {
        if (window.html2pdf) return Promise.resolve();
        return libP = libP || new Promise((res, rej) => {
            const s = document.createElement('script'); s.src = LIB; s.async = true;
            s.onload = () => window.html2pdf ? res() : rej(new Error('PDF tool did not load'));
            s.onerror = () => { libP = null; s.remove(); rej(new Error('PDF tool did not load')); };
            document.head.appendChild(s);
            setTimeout(() => rej(new Error('PDF tool took too long to load')), 25000);
        });
    }
    const fileName = (t) => (String(t || 'Science Academy').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Science Academy') + '.pdf';
    async function download(inner, title) {
        await loadLib(); css();
        const host = document.createElement('div');
        host.className = 'sx-pdf';
        host.style.cssText = `position:absolute;left:-12000px;top:0;width:${PDF_W}px;background:#fff`;
        host.innerHTML = inner;
        document.body.appendChild(host);
        try {
            if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]);
            await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
            const pages = [...host.querySelectorAll('.sx-page')].map(pg => { const w = document.createElement('div'); w.className = 'sx sx-pdf'; w.style.cssText = `width:${PDF_W}px;background:#fff;color:#0F172A`; w.appendChild(pg.cloneNode(true)); host.appendChild(w); return w; });
            const tallest = Math.max(...pages.map(p => p.scrollHeight), 1);
            const scale = Math.max(1.2, Math.min(2, 30000 / tallest));            // stay under the browser's canvas size limit
            const opt = { margin: [11, 11, 15, 11], filename: fileName(title), image: { type: 'jpeg', quality: 0.95 },
                html2canvas: { scale, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: PDF_W },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
                pagebreak: { mode: ['css', 'legacy'], avoid: ['.sx-blk', '.sx-q', 'tr', '.sx-st', '.sx-brand', '.sx-h1', '.sx-ex-h', '.sx-fields', 'li'] } };
            let w = window.html2pdf().set(opt).from(pages[0]).toPdf();
            for (const pg of pages.slice(1)) w = w.get('pdf').then(pdf => { pdf.addPage(); }).from(pg).toContainer().toCanvas().toPdf();
            await w.get('pdf').then(pdf => {
                const n = pdf.internal.getNumberOfPages();
                for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text(`Science Academy - Miss Marwa   |   page ${i} of ${n}`, 105, 290, { align: 'center' }); }
            }).save();
        } finally { host.remove(); }
    }
    // the editable text → the stored text: <b> back to **bold**, line breaks kept, nothing else
    function textOf(el) {
        let out = '';
        el.childNodes.forEach(nd => {
            if (nd.nodeType === 3) out += nd.data;
            else if (nd.nodeType === 1) {
                const tg = nd.tagName;
                if (tg === 'BR') out += '\n';
                else if (tg === 'B' || tg === 'STRONG') { const t = textOf(nd); out += t.trim() ? `**${t}**` : t; }
                else if (tg === 'DIV' || tg === 'P') out += (out ? '\n' : '') + textOf(nd);
                else out += textOf(nd);
            }
        });
        return out.replace(/\u00a0/g, ' ').replace(/\*\*\*\*/g, '');
    }

    // ---------------------------------------------------------------- Print (the browser's print window)
    function print(inner, title) {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
        document.body.appendChild(f);
        const d = f.contentDocument;
        d.open();
        d.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><base href="${location.origin}/">
            <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
            <style>${CSS}
            @page { size: A4; margin: 14mm 12mm 16mm; @bottom-center { content: "Science Academy · Miss Marwa — page " counter(page) " of " counter(pages); font: 9pt Inter, sans-serif; color: #64748B; } }
            html, body { margin: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .sx-page { max-width: none; padding: 0; } .sx-page + .sx-page { break-before: page; }</style></head><body>${inner}</body></html>`);
        d.close();
        const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { } setTimeout(() => f.remove(), 60000); };
        const wait = () => Promise.race([(d.fonts && d.fonts.ready) || Promise.resolve(), new Promise(r => setTimeout(r, 2500))]);
        const imgs = [...d.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })).filter(Boolean);
        Promise.all([wait(), ...imgs]).then(() => setTimeout(go, 150));
    }

    // ---------------------------------------------------------------- edits: path → value
    function setPath(obj, path, value) {
        const ks = path.split('.'); let o = obj;
        for (let i = 0; i < ks.length - 1; i++) { o = o[isNaN(ks[i]) ? ks[i] : +ks[i]]; if (o == null) return false; }
        const last = ks[ks.length - 1]; o[isNaN(last) ? last : +last] = value; return true;
    }
    function getPath(obj, path) { return path.split('.').reduce((o, k) => o == null ? o : o[isNaN(k) ? k : +k], obj); }
    function removePath(obj, path) {
        const ks = path.split('.'), idx = +ks.pop(); const arr = getPath(obj, ks.join('.'));
        if (Array.isArray(arr)) { arr.splice(idx, 1); return true; } return false;
    }
    let styled = false;
    function css() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
    window.StudioRender = { summaryHtml, examHtml, onlineHtml, print, download, textOf, css, setPath, getPath, removePath, total, CSS };
})();
