// =====================================================================
// /api/studio — Miss Marwa's "Exam & summary studio" (teacher only, permission studio.use). 21 Nov 2026.
//
// Everything is made ONLY from the indexed curriculum book (the book map gives the exact lesson pages):
//   • summary  — an exhaustive study guide of a lesson in Miss Marwa's own style (from her handwritten samples):
//                1) list EVERY idea on the lesson pages (definitions, G.R, laws, comparisons, uses, examples…)
//                2) write the summary covering every item  3) check coverage in code, 4) add what's missing.
//   • exam     — a printable exam: sections / counts / marks chosen by her (default = her own sample), then a
//                checker pass fixes any question that isn't answerable from the cited page.
//   • online   — N multiple-choice questions → published into Online exams (after she reviews them).
// Pro (Claude Haiku 5.5) writes CONTENT ONLY, as JSON. The look (blue & white Science Academy PDF) is a fixed
// template in the browser (studio-render.js) — free, identical every time, can't garble content.
// Cost: the lesson pages sit in ONE prompt-cached block, so listing + writing + checking pay them once (+10%).
//
//   GET  ?action=map                 grades → units → lessons (from the book maps)
//   GET  ?action=list | get&id=      saved documents
//   POST ?action=summary  { grade, unit, lesson, docId?, instructions }   (a doc can hold several lessons)
//   POST ?action=exam     { grade, unit, lessons[], sections[], title?, instructions }
//   POST ?action=online   { grade, unit, lessons[], count, title?, instructions }
//   POST ?action=regen    { id, s, q, instructions }      one question again
//   POST ?action=save     { id, content, title? }        her edits
//   POST ?action=publish  { id, durationDays, timeLimitMinutes, shuffle }   online → Online exams
//   POST ?action=delete   { id }
// =====================================================================
import { requireStaff, ensureAppSchema, audit } from './admin-auth.js';
import { chat, AiLimitError, claudeReady } from './ai-gateway.js';
import { createExam } from './exams.js';
import { cleanSolutions } from './solutions-doc.js';
import { gradeToc, pageTexts, chunksOf, pageKind, norm, GRADE_LABELS, bookName } from './curriculum.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s });
const bad = (m, s = 400, extra = {}) => json({ error: m, ...extra }, s);
const GRADE_EN = { prep1: 'First Preparatory', prep2: 'Second Preparatory', prep3: 'Third Preparatory', sec1: 'First Secondary' };
const NUM_WORD = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const MAX_SOURCE = 150000;          // characters of book text per job (≈ 55k tokens — far below the long-prompt price)

// ----------------------------------------------------------------------------------------------
// Exam section types (Miss Marwa picks which, how many, marks each). Default = her own exam sample.
// ----------------------------------------------------------------------------------------------
export const SECTION_TYPES = {
    mcq: { title: 'Choose the correct answer', fmt: '{"q":"stem (use ............ for a blank)","options":["…","…","…","…"],"answer":<index 0-3>}' },
    complete: { title: 'Complete the following statements', fmt: '{"q":"statement with ............ for each blank","answer":["word(s) for blank 1","…"]}' },
    tf: { title: 'Put (✓) or (✗) and correct the wrong statement', fmt: '{"q":"statement","answer":true|false,"correction":"the correct statement (only when false)"}' },
    term: { title: 'Write the scientific term', fmt: '{"q":"the definition / description","answer":"the scientific term"}' },
    reason: { title: 'Give reasons for', fmt: '{"q":"the fact to explain (no \\"Why\\")","answer":"Because …"}' },
    whathappens: { title: 'What happens when …?', fmt: '{"q":"What happens when …?","answer":"…"}' },
    compare: { title: 'Compare between', fmt: '{"q":"Compare between A and B","a":"A","b":"B","points":["Definition","Examples"],"answer":[["A: definition","B: definition"],["A: examples","B: examples"]]}' },
    short: { title: 'Answer the following questions', fmt: '{"q":"question","answer":"model answer"}' }
};
export const DEFAULT_SECTIONS = [
    { type: 'mcq', count: 5, marks: 2 }, { type: 'complete', count: 3, marks: 2 }, { type: 'tf', count: 3, marks: 2 },
    { type: 'reason', count: 2, marks: 2 }, { type: 'whathappens', count: 1, marks: 2 }, { type: 'compare', count: 1, marks: 2 }
];
const ORDINAL = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

// ----------------------------------------------------------------------------------------------
// The source block (prompt-cached): the lesson pages + the rules shared by every task
// ----------------------------------------------------------------------------------------------
export function sourceBlock(grade, parts, { exercises = false } = {}) {
    const gl = GRADE_LABELS[grade] || grade;
    return { type: 'text', cache_control: { type: 'ephemeral' }, text: `You work for Miss Marwa (مس مروة), a science teacher in Egypt (language schools — the book and her material are in English).
Below is the ONLY source you may use: pages of the official ${gl} Science school book.

## Rules for everything you write
- Use ONLY what is in these pages: their facts, definitions, laws, units, examples and level. Nothing from outside the book, nothing from other grades, no extra or advanced facts — even if true.
- Simple, clear English, like a good Egyptian teacher's notes for ${gl} students. Keep the book's own scientific terms exactly.
- Every item you write must come from a specific page: put that PDF page number in "p".
- Pages may contain OCR noise, page headers/footers and [Figure: …] lines: ignore noise; never invent what a figure shows beyond its caption.
${exercises ? '- The book\'s own exercises are included: you may use their style, but write your own questions.' : '- Exercise / model-exam pages were removed: use the explanation pages.'}

## The book pages
${parts.map(pt => `### ${pt.label} — PDF pages ${pt.from}–${pt.to}\n${pt.text}`).join('\n\n')}` };
}

/** Pages of the chosen lessons → [{ label, from, to, text, unit, lesson, title }] (lesson pages only, capped) */
export async function lessonParts(db, toc, unitNo, lessonNos, { exercises = false, maxChars = MAX_SOURCE } = {}) {
    const out = [];
    for (const { book, units } of toc) {
        const u = units.find(x => x.unit === unitNo);
        if (!u) continue;
        const lessons = lessonNos && lessonNos.length ? u.lessons.filter(l => lessonNos.includes(l.lesson)) : u.lessons;
        for (const l of lessons) {
            const pages = await pageTexts(db, book, l.start, l.end);
            const keep = [];
            for (const [p, t] of pages) {
                const cs = chunksOf(t).filter(c => exercises || pageKind(c) !== 'exam' && pageKind(c) !== 'front');
                if (cs.length) keep.push(`[page ${p}]\n${dedupe(cs).join('\n')}`);
            }
            out.push({ book, unit: u.unit, unitTitle: u.title, lesson: l.lesson, title: l.title, from: l.start, to: l.end, text: keep.join('\n\n'),
                label: `Unit ${u.unit}${u.title ? ' (' + u.title + ')' : ''} · Lesson ${l.lesson}${l.title ? ': ' + l.title : ''}` });
        }
        break;
    }
    // share the budget between lessons (an exam on a whole unit) — every lesson keeps its share
    const total = out.reduce((t, x) => t + x.text.length, 0);
    if (total > maxChars) { const each = Math.floor(maxChars / out.length); out.forEach(x => { if (x.text.length > each) x.text = x.text.slice(0, each) + '\n[… more pages of this lesson not shown]'; }); }
    return out;
}
// overlapping passages (chunksOf overlaps by 150 chars) → drop the repeated start
function dedupe(cs) { return cs.map((c, i) => i && cs[i - 1].slice(-150) && c.startsWith(cs[i - 1].slice(-150).trim().slice(0, 60)) ? c.slice(150) : c); }

// ----------------------------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------------------------
const CHECKLIST_TASK = `## Task: list EVERY idea of this lesson (a checklist — nothing may be skipped)
Go through the pages in order and list every item a student must know for full marks:
definitions / scientific terms, explanations, "give reason" facts, rules / laws / equations (with units), measuring devices and units, comparisons / classifications, types and examples, uses / applications / advantages / importance, properties, steps of processes, notes and exceptions.
Return ONLY JSON: {"items":[{"kind":"term|explain|reason|law|device|compare|types|example|use|property|process|note","key":"short name, using the book's exact term","p":<PDF page>}]}
Be complete: a typical lesson has 25–80 items. One item per idea. No duplicates.`;

const SUMMARY_TASK = `## Task: write the FULL study summary of this lesson, in Miss Marwa's own style
She writes complete, exhaustive summaries (several pages) so a student can rely ONLY on them and get full marks. Never shorten, never skip, never merge ideas into vague lines. Cover EVERY item of the checklist below, in the book's order.

HOW SHE ORGANISES A LESSON — the most important part (this is what makes her summaries better than the usual books that list everything in one long block):
- First a short "lead" (1–2 simple sentences): the story of the lesson — what we will learn and how the ideas connect.
- Then the lesson is split into its MAIN TOPICS (usually 3–8), each one a "section" with a short simple heading (2–5 words) and an "intro": ONE simple sentence saying what this topic is about and how it follows from the one before. The page shows these topics first as a numbered roadmap, so the headings must be clear and simple.
- Then each topic in turn, completely, before the next one: the term(s) and definition → the explanation (points / arrows) → examples → reasons (G.R), notes, uses… Every content block belongs to the topic above it — no block before the first section except the lead.
- Topics follow the book's order and lead into each other, so the lesson reads like one coherent story, not a list of separate facts.

Her style (from her handwritten summaries):
- Header "Unit Two — Lesson One: Electric Forces" (numbers as words).
- Every scientific term in its own "term" block: the term, then its exact definition.
- "Explanation of …" as short point lists; cause → result as arrows ("The object that loses electrons" → "becomes positively charged").
- "Ex:" examples. Devices and units as facts: Device: Coulomb meter · Unit: Coulomb.
- Classifications / comparisons as two (or more) columns (e.g. Conducting materials vs Insulators; Autotrophs vs Heterotrophs) with rows: Definition, Examples …
- "G.R" (give reason) items: the fact, then "Because …". Add a G.R for every reason in the book.
- "Note:" lines for exceptions and details. "Uses:", "Advantages:", "Importance:", "Life application:" lists.
- Equations on their own line: Glucose + Oxygen → Water + Carbon dioxide + Energy.
- Sometimes a short Arabic meaning in brackets after a hard English word, like silk (حرير) — only for hard everyday words, never for scientific terms.
- Short simple section headings for each main topic (like "Static Electricity", "Electric Forces", "Types of Nutrition").
- Simple English, short sentences. Use **bold** for key words inside sentences.

Return ONLY JSON (no markdown fences):
{"title":"Unit Two — Lesson One: Electric Forces","blocks":[ … ]}
Block types (each block may have "p": PDF page):
{"t":"lead","text":"…"}   ← first block only
{"t":"section","title":"…","intro":"one simple sentence"}
{"t":"term","term":"…","def":"…"}
{"t":"points","title":"optional heading","items":["…","…"],"ordered":false}
{"t":"arrows","title":"optional","items":[{"from":"…","to":"…"}]}
{"t":"example","text":"…"}
{"t":"facts","items":[{"k":"Device","v":"…"},{"k":"Unit","v":"…"}]}
{"t":"compare","title":"…","cols":["A","B"],"rows":[{"label":"Definition","cells":["…","…"]},{"label":"Examples","cells":["…","…"]}]}
{"t":"reason","q":"the fact","a":"Because …"}
{"t":"equation","text":"…"}
{"t":"note","text":"…"}
{"t":"figure","text":"what the book's figure shows (its caption/labels)","p":<page>}  ← to tell students to look at the figure in the book
End with {"t":"points","title":"Key points to remember","items":[…]} (5–10 items).`;

const FILL_TASK = `## Task: add the MISSING items to the summary
The summary below misses these checklist items. Write a block for EACH of them (same block types and style as the summary) and say after which existing block (its number) it belongs, keeping the book's order.
Return ONLY JSON: {"insert":[{"after":<block number>,"block":{…}}]}`;

function examTask({ sections, title, grade, label, instructions, online }) {
    const list = sections.map((s, i) => `${i + 1}. ${s.type} — EXACTLY ${s.count} question${s.count === 1 ? '' : 's'}, format ${SECTION_TYPES[s.type].fmt}`).join('\n');
    return `## Task: write ${online ? 'an ONLINE exam (multiple choice only, auto-graded)' : 'a printable exam'} — ${title}
For ${GRADE_LABELS[grade] || grade} students, on: ${label}.
Sections (keep this order and EXACTLY these counts):
${list}

Quality rules:
- Every question must be answerable from ONE specific page of the book above — put it in "p". Never ask about anything that isn't in the pages.
- Spread the questions over ALL the chosen lessons and ideas (not only the first page). No two questions test the same fact.
- Clear, exam-style English like Egyptian school exams. Mix easy, medium and a few harder (application) questions.
- MCQ: 4 options, exactly ONE correct, no "all of the above", vary the position of the correct answer. The wrong options must be real terms / values that appear in THESE pages (same topic, plausible) — never a term that isn't in the pages (e.g. a device or process from another lesson or grade), and never silly fillers like "stick to".
- Complete: 1–2 blanks, each blank a key word from the book. ✓/✗: about half false, and a false one is wrong in ONE key detail; give its correction.
- No question may depend on a picture (students only see text).
${instructions ? `\nMiss Marwa's instructions (follow them): ${instructions}\n` : ''}
Return ONLY JSON: {"sections":[{"type":"mcq","items":[{…,"p":<page>}]}, …]}`;
}

const CHECK_TASK = `## Task: check this exam against the book pages, like a strict head teacher
For EVERY question: is it answerable from the book pages? Is the marked answer correct according to the book? (MCQ: exactly one correct option; ✓/✗: is the true/false right and the correction right?) Is it clear, at the right level, not a duplicate, not depending on a picture?
Return ONLY JSON: {"fixes":[{"s":<section index>,"q":<question index>,"why":"short reason","item":{…the corrected question in the same format, with "p"}}]}
If everything is right return {"fixes":[]}. Fix ONLY real problems.`;

// ----------------------------------------------------------------------------------------------
// JSON helpers + normalizers (the template trusts these shapes)
// ----------------------------------------------------------------------------------------------
export function parseJson(text) {
    const t = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
}
const str = (v, n = 1500) => String(v ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const pnum = (v) => { const n = parseInt(v, 10); return n > 0 && n < 100000 ? n : null; };
export function cleanBlock(b) {
    if (!b || typeof b !== 'object') return null;
    const p = pnum(b.p);
    const base = (o) => (p ? { ...o, p } : o);
    switch (b.t) {
        case 'section': return b.title ? base({ t: 'section', title: str(b.title, 200), ...(b.intro ? { intro: str(b.intro, 400) } : {}) }) : null;
        case 'lead': return b.text ? base({ t: 'lead', text: str(b.text, 800) }) : null;
        case 'term': return b.term && b.def ? base({ t: 'term', term: str(b.term, 200), def: str(b.def) }) : null;
        case 'points': { const items = (Array.isArray(b.items) ? b.items : []).map(x => str(x)).filter(Boolean).slice(0, 40); return items.length ? base({ t: 'points', title: str(b.title, 200), items, ordered: !!b.ordered }) : null; }
        case 'arrows': { const items = (Array.isArray(b.items) ? b.items : []).map(x => ({ from: str(x && x.from, 400), to: str(x && x.to, 400) })).filter(x => x.from && x.to).slice(0, 20); return items.length ? base({ t: 'arrows', title: str(b.title, 200), items }) : null; }
        case 'example': case 'note': case 'equation': return b.text ? base({ t: b.t, text: str(b.text) }) : null;
        case 'figure': return b.text ? base({ t: 'figure', text: str(b.text, 600) }) : null;
        case 'facts': { const items = (Array.isArray(b.items) ? b.items : []).map(x => ({ k: str(x && x.k, 80), v: str(x && x.v, 300) })).filter(x => x.k && x.v).slice(0, 12); return items.length ? base({ t: 'facts', items }) : null; }
        case 'reason': return b.q && b.a ? base({ t: 'reason', q: str(b.q), a: str(b.a) }) : null;
        case 'compare': {
            const cols = (Array.isArray(b.cols) ? b.cols : []).map(x => str(x, 150)).filter(Boolean).slice(0, 4);
            if (cols.length < 2) return null;
            const rows = (Array.isArray(b.rows) ? b.rows : []).map(r => ({ label: str(r && r.label, 120), cells: cols.map((_, i) => str(r && Array.isArray(r.cells) ? r.cells[i] : '', 800)) })).filter(r => r.cells.some(Boolean)).slice(0, 15);
            return rows.length ? base({ t: 'compare', title: str(b.title, 200), cols, rows }) : null;
        }
        default: return null;
    }
}
export function cleanItem(type, x) {
    if (!x || typeof x !== 'object' || !x.q) return null;
    const p = pnum(x.p), q = str(x.q, 1200);
    const o = (v) => (p ? { ...v, p } : v);
    switch (type) {
        case 'mcq': {
            const options = (Array.isArray(x.options) ? x.options : []).map(v => str(v, 400).replace(/^[a-dA-D][).]\s+/, '')).filter(Boolean).slice(0, 6);
            const answer = parseInt(x.answer, 10);
            return options.length >= 2 && answer >= 0 && answer < options.length ? o({ q, options, answer }) : null;
        }
        case 'complete': { const answer = (Array.isArray(x.answer) ? x.answer : [x.answer]).map(v => str(v, 200)).filter(Boolean); return answer.length ? o({ q, answer }) : null; }
        case 'tf': { const answer = x.answer === true || x.answer === 'true' || x.answer === '✓'; return o({ q, answer, ...(answer ? {} : { correction: str(x.correction, 800) }) }); }
        case 'compare': {
            const points = (Array.isArray(x.points) ? x.points : []).map(v => str(v, 120)).filter(Boolean).slice(0, 6);
            const answer = (Array.isArray(x.answer) ? x.answer : []).map(r => [str(r && r[0], 600), str(r && r[1], 600)]);
            return x.a && x.b && points.length ? o({ q, a: str(x.a, 150), b: str(x.b, 150), points, answer: points.map((_, i) => answer[i] || ['', '']) }) : null;
        }
        default: return x.answer ? o({ q, answer: str(x.answer, 1500) }) : null;
    }
}
export function cleanSections(raw, wanted) {
    const got = Array.isArray(raw && raw.sections) ? raw.sections : [];
    return wanted.map((w, i) => {
        const src = got.find((g, j) => g && g.type === w.type && (j === i || !got.slice(0, j).some(z => z && z.type === w.type))) || (got[i] && !got[i].type ? got[i] : {});  // never borrow another type's questions
        const items = (Array.isArray(src.items) ? src.items : []).map(x => cleanItem(w.type, x)).filter(Boolean).slice(0, w.count);
        return { type: w.type, title: SECTION_TYPES[w.type].title, marks: w.marks, wanted: w.count, items };
    });
}
// a "p" outside the chosen lessons' pages is a wrong citation → removed (never shown as a fake page)
export function keepPages(parts, list) {
    const ok = (p) => parts.some(x => p >= x.from && p <= x.to);
    for (const o of list) if (o && o.p != null && !ok(o.p)) delete o.p;
    return list;
}
// coverage: is each checklist key in the summary text?
export function blockText(b) { return [b.title, b.intro, b.term, b.def, b.text, b.q, b.a, ...(b.items || []).map(x => typeof x === 'string' ? x : [x.from, x.to, x.k, x.v].join(' ')), ...(b.cols || []), ...(b.rows || []).flatMap(r => [r.label, ...r.cells])].filter(Boolean).join(' '); }
export function coverage(checklist, blocks) {
    const all = norm(blocks.map(blockText).join(' \n '));
    const has = (key) => {
        const k = norm(key).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (!k) return true;
        if (all.includes(k)) return true;
        const ws = k.split(' ').filter(w => w.length >= 3);
        return ws.length > 0 && ws.filter(w => all.includes(w)).length / ws.length >= 0.75;
    };
    const missing = checklist.filter(c => !has(c.key));
    return { total: checklist.length, covered: checklist.length - missing.length, missing };
}

// ----------------------------------------------------------------------------------------------
const readyDbs = new WeakSet();
/** A worked-solutions document made in the AI Assistant → saved in "Exams & summaries" (editable there). */
export async function saveSolutionsDoc(db, { grade, content, costUsd, staffId }) {
    await ensureStudio(db);
    const id = newId('solutions');
    await db.prepare('INSERT INTO studio_docs (id, kind, grade, unit, lessons, title, content, settings, cost_usd, created_by) VALUES (?, \'solutions\', ?, NULL, \'[]\', ?, ?, \'{}\', ?, ?)')
        .bind(id, grade || null, content.title, JSON.stringify(content), costUsd || 0, staffId || null).run();
    return id;
}
async function ensureStudio(db) {
    if (readyDbs.has(db)) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS studio_docs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, grade TEXT, unit INTEGER, lessons TEXT, title TEXT,
        content TEXT, settings TEXT, cost_usd REAL DEFAULT 0, published_exam TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
    readyDbs.add(db);
}
const newId = (k) => `${k === 'summary' ? 'SUM' : k === 'online' ? 'ONL' : k === 'solutions' ? 'SOL' : 'EXM'}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;
const docOut = (r) => r && ({ id: r.id, kind: r.kind, grade: r.grade, unit: r.unit, lessons: safe(r.lessons, []), title: r.title, content: safe(r.content, {}), settings: safe(r.settings, {}),
    costUsd: r.cost_usd || 0, publishedExam: r.published_exam || null, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
function safe(s, d) { try { return JSON.parse(s) ?? d; } catch (e) { return d; } }

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url), action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db);
        const auth = await requireStaff(request, env, 'studio.use');
        if (auth.error) return auth.error;
        await ensureStudio(db);
        const who = auth.staff.name || auth.staff.username || String(auth.staff.id);
        const meter = (kind) => ({ staffId: auth.staff.id, kind });
        const ai = async (system, task, maxTokens, kind) => {
            const r = await chat(env, db, { tier: 'pro', system: [system, { type: 'text', text: task }], messages: [{ role: 'user', content: 'Go.' }], maxTokens, meter: meter(kind) });
            return { data: parseJson(r.text), cost: r.costUsd || 0, raw: r.text };
        };

        if (action === 'map') {
            const out = [];
            for (const g of Object.keys(GRADE_LABELS)) {
                const toc = await gradeToc(env, db, g, { build: false });
                const units = toc.length ? toc[0].units.map(u => ({ unit: u.unit, title: u.title, from: u.start, to: u.end, lessons: u.lessons.map(l => ({ lesson: l.lesson, title: l.title, from: l.start, to: l.end })) })) : [];
                out.push({ grade: g, label: GRADE_LABELS[g], book: toc.length ? bookName(toc[0].book) : null, units });
            }
            return json({ grades: out, aiReady: claudeReady(env), sectionTypes: Object.fromEntries(Object.entries(SECTION_TYPES).map(([k, v]) => [k, v.title])), defaultSections: DEFAULT_SECTIONS });
        }
        if (action === 'list') {
            const { results } = await db.prepare('SELECT id, kind, grade, unit, lessons, title, cost_usd, published_exam, created_by, created_at, updated_at FROM studio_docs ORDER BY updated_at DESC LIMIT 200').all();
            return json({ docs: (results || []).map(r => ({ ...docOut(r), content: undefined, settings: undefined })) });
        }
        if (action === 'get') {
            const r = await db.prepare('SELECT * FROM studio_docs WHERE id = ?').bind(url.searchParams.get('id') || '').first();
            return r ? json({ doc: docOut(r) }) : bad('Not found', 404);
        }
        if (request.method !== 'POST') return bad('POST only', 405);
        const data = await request.json().catch(() => ({}));
        if (['summary', 'exam', 'online', 'regen'].includes(action) && !claudeReady(env)) return bad('Assistant Pro is not connected (ANTHROPIC_API_KEY).', 503, { code: 'PAID_OFF' });
        const grade = String(data.grade || '').toLowerCase(), unitNo = parseInt(data.unit, 10);
        const instructions = str(data.instructions, 800);
        const getToc = async () => { const toc = await gradeToc(env, db, grade, { build: false }); return toc.length ? toc : null; };

        try {
            // ------------------------------------------------ SUMMARY (one lesson per call; a doc can hold several)
            if (action === 'summary') {
                const toc = await getToc();
                if (!toc) return bad(`The ${GRADE_LABELS[grade] || grade} book has no book map yet — build it on Curriculum books.`, 409, { code: 'NO_MAP' });
                const lessonNo = parseInt(data.lesson, 10);
                const [part] = await lessonParts(db, toc, unitNo, [lessonNo]);
                if (!part) return bad('That lesson is not in the book map', 404);
                if (part.text.length < 800) return bad('Very little text on this lesson\'s pages — run "Book check" on Curriculum books.', 409, { code: 'NO_TEXT' });
                const sys = sourceBlock(grade, [part]);
                let cost = 0;
                // 1) checklist of every idea
                const c1 = await ai(sys, CHECKLIST_TASK, 4000, 'studio-summary'); cost += c1.cost;
                const checklist = ((c1.data && c1.data.items) || []).map(x => ({ kind: str(x.kind, 20), key: str(x.key, 200), p: pnum(x.p) })).filter(x => x.key).slice(0, 150);
                // 2) the summary, covering every item
                const task = SUMMARY_TASK + `\n\n## Checklist — cover EVERY item\n${checklist.map((c, i) => `${i + 1}. [${c.kind}] ${c.key}${c.p ? ' (p.' + c.p + ')' : ''}`).join('\n')}`
                    + (instructions ? `\n\nMiss Marwa's instructions (follow them): ${instructions}` : '')
                    + `\nUse the header "Unit ${NUM_WORD[part.unit] || part.unit} — Lesson ${NUM_WORD[part.lesson] || part.lesson}: ${part.title || ''}".`;
                const c2 = await ai(sys, task, 14000, 'studio-summary'); cost += c2.cost;
                let blocks = ((c2.data && c2.data.blocks) || []).map(cleanBlock).filter(Boolean);
                if (!blocks.length) return bad('The summary came back empty — try again.', 502, { code: 'AI_ERROR' });
                keepPages([part], blocks);
                // 3) coverage in code → 4) add what's missing (once)
                let cov = coverage(checklist, blocks);
                if (cov.missing.length) {
                    const ftask = FILL_TASK + `\n\nMissing items:\n${cov.missing.map(m => `- [${m.kind}] ${m.key}${m.p ? ' (p.' + m.p + ')' : ''}`).join('\n')}\n\nThe summary blocks (number: block):\n${blocks.map((b, i) => `${i}: ${JSON.stringify(b).slice(0, 220)}`).join('\n')}`;
                    const c3 = await ai(sys, ftask, 5000, 'studio-summary'); cost += c3.cost;
                    const ins = ((c3.data && c3.data.insert) || []).map(x => ({ after: parseInt(x.after, 10), block: cleanBlock(x.block) })).filter(x => x.block && x.after >= -1);
                    ins.sort((a, b) => b.after - a.after).forEach(x => blocks.splice(Math.min(x.after + 1, blocks.length), 0, x.block));
                    cov = coverage(checklist, blocks);
                }
                keepPages([part], blocks);
                const lessonDoc = { unit: part.unit, unitTitle: part.unitTitle, lesson: part.lesson, title: str(c2.data.title, 200) || part.label, from: part.from, to: part.to, blocks,
                    coverage: { total: cov.total, covered: cov.covered, missing: cov.missing.map(m => m.key).slice(0, 30) } };
                // save: a new doc, or append / replace this lesson in an existing one
                let doc = data.docId ? docOut(await db.prepare('SELECT * FROM studio_docs WHERE id = ? AND kind = \'summary\'').bind(data.docId).first()) : null;
                if (doc) {
                    const L = (doc.content.lessons || []).filter(x => !(x.unit === part.unit && x.lesson === part.lesson)).concat(lessonDoc).sort((a, b) => a.unit - b.unit || a.lesson - b.lesson);
                    await db.prepare('UPDATE studio_docs SET content = ?, lessons = ?, cost_usd = cost_usd + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                        .bind(JSON.stringify({ lessons: L }), JSON.stringify(L.map(x => x.lesson)), cost, doc.id).run();
                } else {
                    const id = newId('summary');
                    await db.prepare('INSERT INTO studio_docs (id, kind, grade, unit, lessons, title, content, settings, cost_usd, created_by) VALUES (?, \'summary\', ?, ?, ?, ?, ?, ?, ?, ?)')
                        .bind(id, grade, part.unit, JSON.stringify([part.lesson]), `${GRADE_LABELS[grade]} · Unit ${part.unit} · ${part.title || 'Lesson ' + part.lesson} — summary`, JSON.stringify({ lessons: [lessonDoc] }), JSON.stringify({ instructions }), cost, who).run();
                    doc = { id };
                }
                await audit(db, request, auth.staff, 'studio.summary', doc.id, { grade, unit: part.unit, lesson: part.lesson, items: cov.total, covered: cov.covered, costUsd: cost });
                const r = docOut(await db.prepare('SELECT * FROM studio_docs WHERE id = ?').bind(doc.id).first());
                return json({ doc: r, lessonCoverage: lessonDoc.coverage, costUsd: cost });
            }

            // ------------------------------------------------ EXAM (printable) / ONLINE (MCQ)
            if (action === 'exam' || action === 'online') {
                const online = action === 'online';
                const toc = await getToc();
                if (!toc) return bad(`The ${GRADE_LABELS[grade] || grade} book has no book map yet — build it on Curriculum books.`, 409, { code: 'NO_MAP' });
                const lessonNos = (Array.isArray(data.lessons) ? data.lessons : []).map(n => parseInt(n, 10)).filter(n => n > 0);
                let sections;
                if (online) { const n = Math.min(60, Math.max(1, parseInt(data.count, 10) || 10)); sections = [{ type: 'mcq', count: n, marks: 1 }]; }
                else {
                    sections = (Array.isArray(data.sections) && data.sections.length ? data.sections : DEFAULT_SECTIONS)
                        .map(s => ({ type: String(s.type), count: Math.min(30, Math.max(0, parseInt(s.count, 10) || 0)), marks: Math.min(20, Math.max(0, Number(s.marks) || 0)) }))
                        .filter(s => SECTION_TYPES[s.type] && s.count > 0).slice(0, 10);
                    if (!sections.length) return bad('Choose at least one section');
                }
                const parts = await lessonParts(db, toc, unitNo, lessonNos);
                if (!parts.length) return bad('That unit / lesson is not in the book map', 404);
                const label = parts.length === 1 ? parts[0].label : `Unit ${unitNo}${parts[0].unitTitle ? ' (' + parts[0].unitTitle + ')' : ''} · Lessons ${parts.map(p => p.lesson).join(', ')}`;
                const title = str(data.title, 160) || `Unit ${NUM_WORD[unitNo] || unitNo} ${online ? 'Quiz' : 'Exam'}: ${parts.length === 1 ? parts[0].title : parts[0].unitTitle || ''}`.trim();
                const sys = sourceBlock(grade, parts);
                let cost = 0;
                const w = await ai(sys, examTask({ sections, title, grade, label, instructions, online }), Math.min(16000, 1500 + sections.reduce((t, s) => t + s.count * (s.type === 'compare' ? 450 : 260), 0)), online ? 'studio-online' : 'studio-exam');
                cost += w.cost;
                let secs = cleanSections(w.data, sections);
                // the checker: every question vs the book
                const numbered = secs.map((s, i) => `Section ${i} (${s.type}):\n${s.items.map((q, j) => `  ${j}: ${JSON.stringify(q)}`).join('\n')}`).join('\n');
                const ck = await ai(sys, CHECK_TASK + `\n\nThe exam:\n${numbered}`, 6000, online ? 'studio-online' : 'studio-exam');
                cost += ck.cost;
                let fixed = 0;
                for (const f of ((ck.data && ck.data.fixes) || [])) {
                    const s = secs[parseInt(f.s, 10)], j = parseInt(f.q, 10);
                    const item = s && cleanItem(s.type, f.item);
                    if (s && item && j >= 0 && j < s.items.length) { s.items[j] = item; fixed++; }
                }
                secs.forEach(s => keepPages(parts, s.items));
                const content = { title, subtitle: `Science | ${GRADE_EN[grade] || ''} | ${parts.map(p => p.title).filter(Boolean).join(' & ')}`, label, sections: secs, checked: { fixed } };
                const id = newId(action);
                await db.prepare('INSERT INTO studio_docs (id, kind, grade, unit, lessons, title, content, settings, cost_usd, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(id, action, grade, unitNo, JSON.stringify(parts.map(p => p.lesson)), title, JSON.stringify(content), JSON.stringify({ sections, instructions }), cost, who).run();
                await audit(db, request, auth.staff, 'studio.' + action, id, { grade, unit: unitNo, lessons: parts.map(p => p.lesson), questions: secs.reduce((t, s) => t + s.items.length, 0), fixed, costUsd: cost });
                return json({ doc: docOut(await db.prepare('SELECT * FROM studio_docs WHERE id = ?').bind(id).first()), costUsd: cost });
            }

            // ------------------------------------------------ one question again
            if (action === 'regen') {
                const doc = docOut(await db.prepare('SELECT * FROM studio_docs WHERE id = ?').bind(data.id || '').first());
                if (!doc || doc.kind === 'summary') return bad('Not found', 404);
                const s = doc.content.sections[parseInt(data.s, 10)], j = parseInt(data.q, 10);
                if (!s || !(j >= 0 && j < s.items.length)) return bad('No such question');
                const toc = await gradeToc(env, db, doc.grade, { build: false });
                const parts = await lessonParts(db, toc, doc.unit, doc.lessons);
                const sys = sourceBlock(doc.grade, parts);
                const others = doc.content.sections.flatMap(x => x.items.map(q => q.q)).join('\n- ');
                const task = `## Task: write ONE new ${s.type} question (to replace one in an exam)
Format: ${SECTION_TYPES[s.type].fmt} with "p" (PDF page). It must be answerable from the book pages, different from all of these questions:\n- ${others}
${str(data.instructions, 400) ? `Miss Marwa's instructions: ${str(data.instructions, 400)}` : ''}
Return ONLY JSON: {"item":{…}}`;
                const r = await ai(sys, task, 1200, 'studio-' + doc.kind);
                const item = cleanItem(s.type, r.data && r.data.item);
                if (!item) return bad('Could not make a new question — try again', 502, { code: 'AI_ERROR' });
                keepPages(parts, [item]);
                s.items[j] = item;
                await db.prepare('UPDATE studio_docs SET content = ?, cost_usd = cost_usd + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify(doc.content), r.cost, doc.id).run();
                return json({ item, costUsd: r.cost });
            }
        } catch (e) {
            if (e instanceof AiLimitError) return bad(e.message, 502, { code: e.code });
            throw e;
        }

        if (action === 'save') {
            const doc = docOut(await db.prepare('SELECT * FROM studio_docs WHERE id = ?').bind(data.id || '').first());
            if (!doc) return bad('Not found', 404);
            const c = data.content || {};
            let content;
            if (doc.kind === 'solutions') { content = cleanSolutions(c); if (!content) return bad('Nothing to save', 400); }
            else if (doc.kind === 'summary') content = { lessons: (Array.isArray(c.lessons) ? c.lessons : []).slice(0, 20).map(l => ({ ...l, title: str(l.title, 200), blocks: (Array.isArray(l.blocks) ? l.blocks : []).map(cleanBlock).filter(Boolean) })) };
            else {
                const wanted = (Array.isArray(c.sections) ? c.sections : []).map(s => ({ type: s.type, count: 999, marks: Math.min(20, Math.max(0, Number(s.marks) || 0)) })).filter(s => SECTION_TYPES[s.type]);
                content = { ...doc.content, title: str(c.title, 160) || doc.content.title, subtitle: str(c.subtitle, 240) || doc.content.subtitle,
                    sections: wanted.map((w, i) => ({ type: w.type, title: str(c.sections[i].title, 160) || SECTION_TYPES[w.type].title, marks: w.marks, wanted: c.sections[i].wanted, items: (c.sections[i].items || []).map(x => cleanItem(w.type, x)).filter(Boolean).slice(0, 60) })) };
            }
            const title = str(data.title, 200) || doc.title;
            await db.prepare('UPDATE studio_docs SET content = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(JSON.stringify(content), title, doc.id).run();
            return json({ ok: true, doc: docOut(await db.prepare('SELECT * FROM studio_docs WHERE id = ?').bind(doc.id).first()) });
        }
        if (action === 'publish') {
            const doc = docOut(await db.prepare('SELECT * FROM studio_docs WHERE id = ?').bind(data.id || '').first());
            if (!doc || doc.kind !== 'online') return bad('Only an online exam can be published', 400);
            const pub = await requireStaff(request, env, 'exams.create');
            if (pub.error) return pub.error;
            const questions = doc.content.sections.flatMap(s => s.items).map(q => ({ question: q.q, options: q.options, correctIndex: q.answer }));
            if (!questions.length) return bad('No questions');
            // the same "create exam" as the Online exams page (same checks, student notification, activity log)
            const out = await createExam(env, db, request, pub.staff, { title: str(data.title, 160) || doc.content.title, grade: doc.grade, questions, durationDays: data.durationDays, timeLimitMinutes: data.timeLimitMinutes, shuffle: data.shuffle !== false });
            if (out.error) return bad(out.error, 400);
            await db.prepare('UPDATE studio_docs SET published_exam = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(out.examId, doc.id).run();
            await audit(db, request, auth.staff, 'studio.publish', doc.id, { examId: out.examId, questions: questions.length });
            return json({ ok: true, examId: out.examId });
        }
        if (action === 'delete') {
            const r = await db.prepare('DELETE FROM studio_docs WHERE id = ?').bind(data.id || '').run();
            if (!r.meta.changes) return bad('Not found', 404);
            await audit(db, request, auth.staff, 'studio.delete', data.id, {});
            return json({ ok: true });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('studio error', err);
        return bad('Something went wrong — try again', 500);
    }
}
