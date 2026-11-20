// =====================================================================
// Curriculum books for Assistant Pro (19 Nov 2026) — R2 bucket `curriculum-bucket`, bound as CURRICULUM.
// Files: prep1-science.pdf, prep2-science.pdf, prep3-science.pdf, sec1-science.pdf (grade = start of the name).
//
// Indexing (once per book, from Miss Marwa's "Curriculum books" page — teacher only):
//   • her browser opens the PDF with pdf.js and sends the text of every page here (free — no AI);
//   • pages that are only pictures (scanned) can be read ONCE with Claude vision ("ocr", counted as staff use);
//   • every page is cut into small passages and stored in a full-text index (SQLite FTS5 in D1).
// Answering (bookContext): the student's question → the best few passages of THEIR grade's book (~1,500 tokens),
// which go into the Pro prompt as the source of truth, with page numbers.
//
//   GET  ?action=list                        → books in the bucket + how far each is indexed
//   GET  ?action=pdf&key=…                   → the PDF (Range requests, so pdf.js loads only what it needs)
//   POST ?action=pages { key, total, pages: [{ n, text }] }   → save page texts (replaces those pages)
//   POST ?action=ocr   { key, n, total, image: { mime, b64 } } → read one scanned page with Claude vision
//   POST ?action=clear { key }               → forget a book's index
//   GET  ?action=search&grade=prep2&q=…      → try the search (what Pro would get)
// =====================================================================
import { requireStaff, audit, ensureAppSchema } from './admin-auth.js';
import { chat, AiLimitError, claudeReady } from './ai-gateway.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s });
const bad = (m, s = 400, extra = {}) => json({ error: m, ...extra }, s);
const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
const CHUNK = 900, OVERLAP = 150, MAX_PAGE = 20000;
export const gradeOfKey = (key) => { const m = String(key || '').toLowerCase().match(/^(prep[123]|sec1)\b/); return m ? m[1] : null; };
const okKey = (k) => typeof k === 'string' && /\.pdf$/i.test(k) && !k.includes('..') && k.length < 300;

// ---- Arabic / English text normalized the same way for the index and for questions ----
export function norm(s) {
    return String(s || '').toLowerCase()
        .replace(/[ً-ٰٟـ]/g, '')          // tashkeel + tatweel
        .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/\s+/g, ' ').trim();
}
const STOP = new Set(('the and for are was were with that this from what which when where why how does did can could would should into about your you they them their there then than have has had not but all any its also more most such only very just some each other these those been being will shall may might must ' +
    'اللي ايه ازاي ليه امتي فين مين هو هي هم انا انت انتي احنا ده دي دول كان كانت يكون تكون علي على في من الي الى عن مع او ولا لو اذا اما بس كمان يعني طيب ممكن عايز عاوز عايزه اشرح اشرحلي اشرحيلي قولي قوللي سؤال السؤال اجابه الاجابه ' +
    'هل ما ماذا لماذا كيف متى اين التي الذي الذين هذا هذه ذلك تلك بين عند كل بعد قبل حتي حتى لكن ثم').split(/\s+/));
/** question → an FTS5 query: its meaningful words OR-ed (Arabic "ال" stripped too), max 24 terms */
export function ftsQuery(q) {
    const words = norm(q).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const terms = new Set();
    for (const w of words) {
        if (w.length < 3 || STOP.has(w)) continue;
        terms.add(w);
        if (/^ال[؀-ۿ]{3,}/.test(w)) terms.add(w.slice(2));            // الكثافه → كثافه
        if (/^(وال|بال|كال|فال|لل)[؀-ۿ]{3,}/.test(w)) terms.add(w.slice(3));
        if (terms.size >= 24) break;
    }
    return [...terms].map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
}
export function chunksOf(text) {
    const t = String(text || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, MAX_PAGE);
    if (!t) return [];
    if (t.length <= CHUNK) return [t];
    const out = [];
    let i = 0;
    while (i < t.length) {
        let end = Math.min(t.length, i + CHUNK);
        if (end < t.length) { const cut = t.lastIndexOf(' ', end); if (cut > i + CHUNK * 0.6) end = cut; }
        out.push(t.slice(i, end).trim());
        if (end >= t.length) break;
        const back = t.indexOf(' ', end - OVERLAP);               // next passage starts OVERLAP earlier, on a word boundary
        i = back > i && back < end ? back + 1 : end;
    }
    return out.filter(Boolean);
}

const readyDbs = new WeakSet();
export async function ensureCurriculum(db) {
    if (readyDbs.has(db)) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS curriculum_books ("key" TEXT PRIMARY KEY, grade TEXT, total_pages INTEGER DEFAULT 0, size INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS curriculum_pages (book TEXT NOT NULL, page INTEGER NOT NULL, grade TEXT, chars INTEGER DEFAULT 0, source TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (book, page))`),
        db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS curriculum_fts USING fts5(norm, text UNINDEXED, grade UNINDEXED, book UNINDEXED, page UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')`)
    ]);
    readyDbs.add(db);
}

/** Save one page's text (replaces that page). source: 'text' (pdf.js) | 'ocr' (Claude vision) */
async function savePage(db, book, grade, n, text, source) {
    const chunks = chunksOf(text);
    const st = [
        db.prepare('DELETE FROM curriculum_fts WHERE book = ? AND page = ?').bind(book, n),
        db.prepare(`INSERT INTO curriculum_pages (book, page, grade, chars, source, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(book, page) DO UPDATE SET grade = excluded.grade, chars = excluded.chars, source = excluded.source, updated_at = CURRENT_TIMESTAMP`).bind(book, n, grade, String(text || '').trim().length, source),
        ...chunks.map(c => db.prepare('INSERT INTO curriculum_fts (norm, text, grade, book, page) VALUES (?, ?, ?, ?, ?)').bind(norm(c), c, grade, book, n))
    ];
    await db.batch(st);
    return chunks.length;
}

/**
 * The best passages of this grade's book(s) for a question → { text (for the prompt), passages: [{ book, page, text }] }.
 * Empty when nothing is indexed for the grade or nothing matches.
 */
export async function bookContext(db, grade, question, { k = 4, maxChars = 4200 } = {}) {
    try {
        await ensureCurriculum(db);
        const q = ftsQuery(question);
        if (!q || !GRADES.includes(grade)) return { text: '', passages: [] };
        const { results } = await db.prepare(`SELECT text, book, page FROM curriculum_fts WHERE curriculum_fts MATCH ? AND grade = ? ORDER BY bm25(curriculum_fts) LIMIT ?`)
            .bind(q, grade, k * 2).all();
        const passages = []; let used = 0; const seen = new Set();
        for (const r of results || []) {
            const sig = r.book + ':' + r.page + ':' + String(r.text).slice(0, 60);
            if (seen.has(sig)) continue; seen.add(sig);
            if (used + r.text.length > maxChars && passages.length) break;
            passages.push({ book: r.book, page: Number(r.page), text: r.text }); used += r.text.length;
            if (passages.length >= k) break;
        }
        passages.sort((a, b) => a.book.localeCompare(b.book) || a.page - b.page);
        const text = passages.map(p => `[${bookName(p.book)} — page ${p.page}]\n${p.text}`).join('\n\n');
        return { text, passages };
    } catch (e) { return { text: '', passages: [] }; }    // the search must never break an answer
}
export async function gradeIndexed(db, grade) {
    try { await ensureCurriculum(db); const r = await db.prepare('SELECT COUNT(*) AS n FROM curriculum_pages WHERE grade = ? AND chars > 0').bind(grade).first(); return Number(r && r.n) || 0; } catch (e) { return 0; }
}
export const bookName = (key) => { const g = gradeOfKey(key); return g ? `${{ prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' }[g]} Science book` : String(key).replace(/\.pdf$/i, ''); };

// ---------------------------------------------------------------------------------------------------------------
// Strict grounding (audited 20 Nov 2026 at the user's request):
//   1. searchBook(): Claude first turns the question (or the PHOTO of the question) into science search terms in
//      English AND Arabic — so «يعني إيه الكثافة» finds "Density" in an English book and vice versa (≈ $0.00005).
//      Not a science question → no book needed.
//   2. the best passages of THAT grade's book only (never another grade's).
//   3. the rules: every science fact must come from the passages; nothing found / book not indexed yet →
//      say so and DON'T answer from general knowledge (students) / DON'T write questions (staff).
//   Page numbers are the PDF's page numbers (they can differ a little from the printed ones) → cited as "PDF page".
// ---------------------------------------------------------------------------------------------------------------
export const GRADE_LABELS = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
const KEYWORDS_SYSTEM = (gradeLabel) => `You prepare a search of an Egyptian ${gradeLabel} school SCIENCE textbook (the student/teacher's question may be in Egyptian Arabic, English or both, or in a photo).
Output ONE line only: 6–14 search terms for the science topic of the question — EACH key term in English AND in Arabic (e.g. density, الكثافة, mass, الكتلة, volume, الحجم), comma-separated. Include the unit/lesson topic names if you can tell them. No sentences, no explanation.
If it is not a science question at all (greetings, the platform, marks, personal talk), output exactly: NONE`;

/**
 * Search the grade's book for a question → { science, terms, ctx: { text, passages }, indexed }
 * meter: who pays the tiny keyword step ({ studentId } | { staffId }); without Claude → plain search of the words.
 */
export async function searchBook(env, db, { grade, text = '', image = null, meter = null, k = 4, maxChars = 4200 } = {}) {
    const indexed = await gradeIndexed(db, grade);
    let terms = '', science = true;
    if (indexed && claudeReady(env) && (text.trim() || image)) {
        try {
            const r = await chat(env, db, { tier: 'pro', system: KEYWORDS_SYSTEM(GRADE_LABELS[grade] || grade), messages: [{ role: 'user', content: String(text || '').slice(0, 1500) || '(the question is in the photo)' }],
                image: image && !image.error ? image : null, maxTokens: 120, meter: meter ? { ...meter, kind: 'search' } : null });
            terms = String(r.text || '').split('\n')[0].trim();
            if (/^NONE\b/i.test(terms)) { science = false; terms = ''; }
        } catch (e) { terms = ''; }    // the keyword step must never block an answer (budget errors surface on the real call)
    }
    const ctx = indexed && science ? await bookContext(db, grade, `${terms} ${text}`.slice(0, 900), { k, maxChars }) : { text: '', passages: [] };
    return { science, terms, ctx, indexed: indexed > 0 };
}

/** Grade named in a staff message ("Prep 1", "أولى إعدادي", "الصف الأول الإعدادي", "sec1", "1 ثانوي" …) → 'prep1' | … | null */
export function gradeFromText(text) {
    const t = norm(text).replace(/[ـ]/g, '');
    const rx = [
        ['prep1', /\b(prep|preparatory|grade)\s*\.?\s*(1|one|7)\b|\bp1\b|(اولي|الاولي|اول|الاول|1)\s*(اعدادي|الاعدادي|اعدادى|ع(?=\s|$))|الصف\s*الاول\s*الاعدادي/],
        ['prep2', /\b(prep|preparatory|grade)\s*\.?\s*(2|two|8)\b|\bp2\b|(تانيه|ثانيه|الثانيه|التانيه|تاني|ثاني|الثاني|2)\s*(اعدادي|الاعدادي|اعدادى|ع(?=\s|$))|الصف\s*الثاني\s*الاعدادي/],
        ['prep3', /\b(prep|preparatory|grade)\s*\.?\s*(3|three|9)\b|\bp3\b|(تالته|ثالثه|الثالثه|التالته|تالت|ثالث|الثالث|3)\s*(اعدادي|الاعدادي|اعدادى|ع(?=\s|$))|الصف\s*الثالث\s*الاعدادي/],
        ['sec1', /\b(sec|secondary|grade)\s*\.?\s*(1|one|10)\b|\bs1\b|(اولي|الاولي|اول|الاول|1)\s*(ثانوي|الثانوي|ثانوى|ث(?=\s|$))|الصف\s*الاول\s*الثانوي/]
    ];
    for (const [g, r] of rx) if (r.test(t)) return g;
    return null;
}

/** Student Pro: the rules + passages (strict). */
export function bookRules(ctx, gradeLabel, { indexed = true } = {}) {
    if (!indexed) return `\n\n## Curriculum book — not connected yet (${gradeLabel})
The ${gradeLabel} book isn't connected to Assistant Pro yet. For science content do NOT answer from general knowledge: say «كتاب ${gradeLabel} لسه متربطش بـ Assistant Pro — اسأل مس مروة في الجزء ده 🙏» in one line. You can still help with how to study, the platform, or a question about Miss Marwa's own exams.`;
    if (!ctx || !ctx.text) return `\n\n## Curriculum book — nothing found for this question (${gradeLabel})
The search of the student's ${gradeLabel} book found NOTHING about this question. So:
- Do NOT answer the science content from your general knowledge — not even "basics".
- Say it in one friendly line: «السؤال ده مش لاقيه في كتاب ${gradeLabel} بتاعك — ممكن يكون مش مقرر عليك. ابعتلي اسم الدرس أو اسأل مس مروة 🙏».
- If it's clearly from a higher grade or outside the syllabus, say that it's not in their curriculum.`;
    return `\n\n## Curriculum book — your ONLY source for science (${gradeLabel})
The passages below are from the student's own ${gradeLabel} school book (found by searching it for this question).
- EVERY science fact, definition, law, number and unit in your answer must come from these passages. Use their definitions and wording.
- Do NOT add anything that isn't in the passages — no outside, advanced or "extra" facts, even if true. Simpler is fine; more is not.
- If the passages don't actually cover what was asked, don't answer it from general knowledge: say «الجزء ده مش في كتاب ${gradeLabel} بتاعك — ممكن يكون مش مقرر عليك، اسأل مس مروة 🙏».
- End with the page(s) you used, like: 📖 (كتابك — صفحة 45 في الـ PDF).

${ctx.text}`;
}

/** Staff (Miss Marwa's assistant): writing questions / exams / explanations strictly inside the grade's book. */
export function staffBookRules(found, grade) {
    if (!grade) return `\n\n## Curriculum books — grade not given
Her curriculum books ARE connected (searched per grade), but this request doesn't say the grade. If she asks you to write questions, an exam, a quiz, a worksheet or model answers, FIRST ask her in one short line which grade (Prep 1 / Prep 2 / Prep 3 / Sec 1) — don't write any of it before you know, because every question must come from that grade's book. (A short explanation of a single idea is fine without the grade — keep it at the Egyptian prep-school level.)`;
    const gl = GRADE_LABELS[grade] || grade;
    if (!found.indexed) return `\n\n## Curriculum book — ${gl} not indexed yet
The ${gl} book is not indexed yet (Staff → Curriculum books). Do NOT write questions, exams or explanations for ${gl} from general knowledge. Tell her in one line: «كتاب ${gl} لسه متعملوش Index يا ${'مس مروة'} — اعمليله Index من صفحة Curriculum books وأنا أكتبلك الأسئلة منه على طول 😊», or ask her to paste the lesson text.`;
    if (!found.ctx.text) return `\n\n## Curriculum book — nothing found in the ${gl} book
The search of the ${gl} book found NOTHING for this request. Do NOT write questions or explanations from general knowledge (that's how off-syllabus questions happen). Say the topic wasn't found in the ${gl} book — it may not be in the ${gl} syllabus — and ask her for the lesson name or to paste the lesson text.`;
    return `\n\n## Curriculum book — your ONLY source (${gl})
These passages are from the ${gl} school book (searched for this request). Rules — no exceptions:
- Every question, choice, correct answer, model answer and explanation must come from these passages: their facts, definitions, laws, units and level. Nothing from outside the book, nothing from other grades, no "extra" or advanced facts.
- Each question must be answerable using ONLY these passages. Don't stretch a passage into a topic it doesn't cover.
- After each question's answer write its source page, like (📖 ص 45 PDF).
- If she asked for more questions than the passages can honestly support, write fewer and tell her which topic needs more pages (or a narrower lesson).
- If the passages don't cover the topic she asked for, say so instead of writing it.

${found.ctx.text}`;
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url), action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    const B = env.CURRICULUM && typeof env.CURRICULUM.get === 'function' ? env.CURRICULUM : null;
    try {
        await ensureAppSchema(db);
        const auth = await requireStaff(request, env, 'ai.manage');
        if (auth.error) return auth.error;
        await ensureCurriculum(db);

        if (action === 'list') {
            const objects = [];
            if (B) {
                let cursor;
                for (let i = 0; i < 5; i++) {
                    const page = await B.list({ limit: 1000, cursor });
                    for (const o of page.objects || []) if (/\.pdf$/i.test(o.key)) objects.push({ key: o.key, size: o.size });
                    if (!page.truncated || !page.cursor) break; cursor = page.cursor;
                }
            }
            const { results: books } = await db.prepare('SELECT * FROM curriculum_books').all();
            const { results: stats } = await db.prepare(`SELECT book, COUNT(*) AS pages, SUM(CASE WHEN chars >= 40 THEN 1 ELSE 0 END) AS text_pages,
                SUM(CASE WHEN source = 'ocr' THEN 1 ELSE 0 END) AS ocr_pages, SUM(chars) AS chars FROM curriculum_pages GROUP BY book`).all();
            const { results: scans } = await db.prepare(`SELECT book, page FROM curriculum_pages WHERE chars < 40 ORDER BY book, page`).all();
            const SC = new Map(); for (const r of scans || []) { if (!SC.has(r.book)) SC.set(r.book, []); SC.get(r.book).push(Number(r.page)); }
            const BK = new Map((books || []).map(b => [b.key, b])), ST = new Map((stats || []).map(s => [s.book, s]));
            const keys = new Set([...objects.map(o => o.key), ...BK.keys()]);
            return json({
                connected: !!B, aiReady: claudeReady(env),
                books: [...keys].sort().map(key => {
                    const o = objects.find(x => x.key === key), b = BK.get(key) || {}, s = ST.get(key) || {};
                    return { key, grade: gradeOfKey(key), name: bookName(key), inBucket: !!o, size: o ? o.size : b.size || 0, totalPages: b.total_pages || 0,
                        pagesDone: Number(s.pages) || 0, textPages: Number(s.text_pages) || 0, ocrPages: Number(s.ocr_pages) || 0, chars: Number(s.chars) || 0, updatedAt: b.updated_at || null,
                        scanned: SC.get(key) || [] };
                })
            });
        }
        if (action === 'pdf') {
            const key = url.searchParams.get('key') || '';
            if (!B) return bad('The CURRICULUM bucket is not connected', 503);
            if (!okKey(key)) return bad('Not a book', 400);
            const head = await B.head(key);
            if (!head) return bad('Book not found', 404);
            const size = head.size, range = request.headers.get('Range');
            const base = { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
            const m = range && range.match(/bytes=(\d*)-(\d*)/);
            if (m && (m[1] || m[2])) {
                let start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
                let end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
                if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
                const obj = await B.get(key, { range: { offset: start, length: end - start + 1 } });
                return new Response(obj.body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
            }
            const obj = await B.get(key);
            return new Response(obj.body, { headers: { ...base, 'Content-Length': String(size) } });
        }
        if (action === 'search') {
            const grade = String(url.searchParams.get('grade') || '').toLowerCase(), q = url.searchParams.get('q') || '';
            const ctx = await bookContext(db, grade, q);
            return json({ query: ftsQuery(q), passages: ctx.passages });
        }
        if (request.method !== 'POST') return bad('POST only', 405);
        const data = await request.json().catch(() => ({}));
        const key = String(data.key || '');
        if (!okKey(key)) return bad('Not a book', 400);
        const grade = gradeOfKey(key);
        if (!grade && action !== 'clear') return bad('The file name must start with the grade (prep1-, prep2-, prep3- or sec1-)', 400);
        const touchBook = (total) => db.prepare(`INSERT INTO curriculum_books ("key", grade, total_pages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT("key") DO UPDATE SET grade = excluded.grade, total_pages = MAX(curriculum_books.total_pages, excluded.total_pages), updated_at = CURRENT_TIMESTAMP`).bind(key, grade, total || 0).run();

        if (action === 'pages') {
            const pages = (Array.isArray(data.pages) ? data.pages : []).slice(0, 50);
            if (!pages.length) return bad('No pages');
            let chunks = 0;
            for (const p of pages) {
                const n = parseInt(p && p.n, 10);
                if (!(n >= 1 && n <= 5000)) continue;
                chunks += await savePage(db, key, grade, n, String(p.text || ''), 'text');
            }
            await touchBook(parseInt(data.total, 10) || 0);
            return json({ ok: true, pages: pages.length, chunks });
        }
        if (action === 'ocr') {
            const n = parseInt(data.n, 10), img = data.image || {};
            if (!(n >= 1 && n <= 5000)) return bad('Bad page');
            if (!/^image\/(jpeg|png|webp)$/.test(img.mime || '') || !img.b64 || img.b64.length > 4_000_000) return bad('Send the page as a JPEG');
            let out;
            try {
                out = await chat(env, db, {
                    tier: 'pro', maxTokens: 2500, meter: { staffId: auth.staff.id, kind: 'ocr' }, image: { mime: img.mime, b64: img.b64 },
                    system: 'You copy text from photos of pages of a school science book (Egypt). Output ONLY the text of the page, in reading order, exactly as printed (Arabic and English as they are). Keep headings, definitions, laws and units. For a figure, write one short line: [Figure: what it shows]. No comments, no translation, no markdown fences.',
                    messages: [{ role: 'user', content: `Copy all the text of page ${n}.` }]
                });
            } catch (e) {
                if (e instanceof AiLimitError) return bad(e.message, 502, { code: e.code });
                throw e;
            }
            const chunks = await savePage(db, key, grade, n, out.text, 'ocr');
            await touchBook(parseInt(data.total, 10) || 0);
            return json({ ok: true, page: n, chars: out.text.length, chunks, costUsd: out.costUsd });
        }
        if (action === 'clear') {
            await db.batch([
                db.prepare('DELETE FROM curriculum_fts WHERE book = ?').bind(key),
                db.prepare('DELETE FROM curriculum_pages WHERE book = ?').bind(key),
                db.prepare('DELETE FROM curriculum_books WHERE "key" = ?').bind(key)
            ]);
            await audit(db, request, auth.staff, 'curriculum.clear', key, {});
            return json({ ok: true });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('curriculum error', err);
        return bad('Something went wrong — try again', 500);
    }
}
