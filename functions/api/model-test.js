// =====================================================================
// Model test (/api/model-test) — Miss Marwa only (permission copilot.use). Hidden from students.
// Benchmarks "Miss Marwa Assistant Pro" on real first-term exams, exactly as a student would ask:
//   • exam sets are imported as JSON (transcribed from the papers, with the answer key)
//   • a run = one reasoning mode (plain / check / thinking); the page sends the questions one by one
//     (so a run can pause / resume and never hits a time limit)
//   • choose / true-false / complete answers are marked automatically against the key (from the
//     "✅ الإجابة:" line); written answers are marked ✓/✗ by Miss Marwa — or exported for an
//     independent marker (never graded by the same model)
//   • every answer gets a style check: Egyptian Arabic (not فصحى), English science terms not
//     translated, not all-English, has the final exam-answer line
// =====================================================================
import { requireStaff, ensureAppSchema } from './admin-auth.js';
import { chat, AiLimitError, BRANDS, claudeReady, modelFor } from './ai-gateway.js';
import { searchBook, bookRules, GRADE_LABELS } from './curriculum.js';
import { tutorPrompt } from './tutor.js';
import { reasoning, REASONING_MODES, stripPrivate, finalAnswers, taskRules } from './ai-rules.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s });
const bad = (m, s = 400, extra = {}) => json({ error: m, ...extra }, s);
const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
const KINDS = ['mcq', 'tf', 'complete', 'reason', 'define', 'what-happens', 'problem', 'compare', 'other'];
const LETTERS = 'abcdefgh';
const MAX_ITEMS = 120;

let ready = false;
async function ensureTables(db) {
    if (ready) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS bench_sets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, grade TEXT NOT NULL, source TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS bench_items (id INTEGER PRIMARY KEY AUTOINCREMENT, set_id INTEGER NOT NULL, ord INTEGER NOT NULL, section TEXT, kind TEXT NOT NULL,
            question TEXT NOT NULL, options TEXT, answer TEXT, answer_index INTEGER, marks REAL DEFAULT 1, notes TEXT)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS bench_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, set_id INTEGER NOT NULL, mode TEXT NOT NULL, model TEXT, label TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS bench_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, item_id INTEGER NOT NULL, text TEXT, final TEXT,
            auto INTEGER, style TEXT, mark INTEGER, note TEXT, ms INTEGER, cost_usd REAL, tokens_in INTEGER, tokens_out INTEGER, error TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(run_id, item_id))`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_bench_items_set ON bench_items(set_id, ord)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_bench_answers_run ON bench_answers(run_id)')
    ]);
    ready = true;
}

// ---------- importing a set ----------
export function checkSet(input) {
    const errors = [];
    const d = typeof input === 'string' ? (() => { try { return JSON.parse(input); } catch (e) { errors.push('Not valid JSON: ' + e.message); return null; } })() : input;
    if (!d) return { errors };
    const title = String(d.title || '').trim(), grade = String(d.grade || '').toLowerCase().replace(/\s+/g, '');
    if (!title) errors.push('Missing "title"');
    if (!GRADES.includes(grade)) errors.push(`"grade" must be one of ${GRADES.join(', ')}`);
    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.length) errors.push('No "items"');
    if (items.length > MAX_ITEMS) errors.push(`Up to ${MAX_ITEMS} questions per set`);
    const clean = items.map((it, i) => {
        const n = i + 1, kind = String(it.kind || 'other').toLowerCase();
        const q = String(it.question || '').trim();
        const options = Array.isArray(it.options) ? it.options.map(o => String(o).trim()).filter(Boolean) : null;
        if (!q) errors.push(`Item ${n}: missing "question"`);
        if (!KINDS.includes(kind)) errors.push(`Item ${n}: unknown kind "${kind}" (use ${KINDS.join(', ')})`);
        let answerIndex = Number.isInteger(it.answerIndex) ? it.answerIndex : null;
        if (kind === 'mcq') {
            if (!options || options.length < 2) errors.push(`Item ${n}: a choose question needs at least 2 options`);
            else if (answerIndex === null || answerIndex < 0 || answerIndex >= options.length) errors.push(`Item ${n}: "answerIndex" must point at the correct option (0 = first)`);
        }
        if (kind !== 'mcq' && !String(it.answer || '').trim()) errors.push(`Item ${n}: missing "answer" (the model answer)`);
        return { section: String(it.section || '').slice(0, 40), kind, question: q, options: kind === 'mcq' ? options : (options && options.length ? options : null), answer: String(it.answer || (options && answerIndex !== null ? options[answerIndex] : '') || '').trim(), answerIndex, marks: Number(it.marks) > 0 ? Number(it.marks) : 1, notes: it.notes ? String(it.notes).slice(0, 500) : null };
    });
    return { errors, set: { title: title.slice(0, 120), grade, source: String(d.source || '').slice(0, 300), items: clean } };
}

// ---------- what the "student" sends ----------
export function askText(item) {
    const opts = item.options && item.options.length ? '\n' + item.options.map((o, i) => `(${LETTERS[i]}) ${o}`).join('\n') : '';
    return `حل السؤال ده:\n${item.question}${opts}`;
}

// ---------- automatic marking ----------
const normEn = (t) => String(t || '').toLowerCase().replace(/[*_`"'“”‘’]/g, '').replace(/[^\p{L}\p{N}\s.%/-]/gu, ' ').replace(/\s+/g, ' ').trim();
export function autoMark(item, text) {
    const finals = finalAnswers(text);
    const f = finals.length ? finals[0].text : '';
    if (item.kind === 'mcq') {
        const pick = (s) => {
            const m = String(s).match(/^\s*\(?([a-h])\)/i) || String(s).match(/^\s*([a-h])[\).\s-]/i) || String(s).match(/\(([a-h])\)/i);
            if (m) return LETTERS.indexOf(m[1].toLowerCase());
            const n = normEn(s);
            const hits = item.options.map((o, i) => (n.includes(normEn(o)) ? i : -1)).filter(i => i >= 0);
            return hits.length === 1 ? hits[0] : -1;
        };
        if (!f) return { auto: null, final: '' };
        const p = pick(f);
        return { auto: p < 0 ? null : (p === item.answerIndex ? 1 : 0), final: f, picked: p };
    }
    if (item.kind === 'tf') {
        if (!f) return { auto: null, final: '' };
        const want = /^\s*(true|✓|صح)/i.test(item.answer) ? 'true' : 'false';
        const got = /^\s*(true|✓|صح)/i.test(f) ? 'true' : /^\s*(false|✗|غلط)/i.test(f) ? 'false' : null;
        if (!got) return { auto: null, final: f };
        if (got !== want) return { auto: 0, final: f };
        return { auto: want === 'true' ? 1 : null, final: f };   // a "False" needs its correction checked by a person
    }
    if (item.kind === 'complete') {
        if (!f) return { auto: null, final: '' };
        // "a | b" = two blanks (both needed); "x / y" or "x or y" = either is accepted
        const n = normEn(finals.map(x => x.text).join(' '));
        const blanks = String(item.answer).split('|').map(b => b.split(/\s*(?:\/|\bor\b)\s*/i).map(normEn).filter(Boolean));
        const ok = blanks.every(alts => alts.some(k => n.includes(k)));
        return { auto: ok ? 1 : null, final: f };   // not found → a person decides (synonyms / other wording)
    }
    return { auto: null, final: f };
}

// ---------- style check (our teaching rules) ----------
const DIALECT = /(^|[\s،.؟!])(ده|دي|دول|اللي|علشان|عشان|يعني|بص|بصي|كده|ازاي|إزاي|ليه|مش|بتاع|بتاعة|إيه|ايه|هنا|كمان|اوي|أوي|بقى|خلي|خلّي|هي|زي|برضه|يلا|طب|احنا|إحنا|بيكون|بتكون|بنقيس|بيتقاس)(?=$|[\s،.؟!])/g;
const FUSHA = /(^|[\s،.؟!])(الذي|التي|الذين|هذا|هذه|ذلك|تلك|لذلك|حيث|إن|إنّ|لأن|يجب|نستنتج|كما|أيضاً|أيضا|لكي|سوف|ليس|ليست|عندما|يكون|تكون)(?=$|[\s،.؟!])/g;
const TRANSLATED = ['العلوم', 'الفيزياء', 'الكيمياء', 'الأحياء', 'الذرة', 'الذره', 'النواة', 'النواه', 'الكثافة', 'الكثافه', 'الكتلة', 'الكتله', 'الطاقة', 'الطاقه', 'العجلة', 'العنصر', 'المركب', 'الإلكترون', 'الالكترون', 'البروتون', 'النيوترون', 'الخلية', 'الخليه', 'الجزيء', 'التيار الكهربي', 'المقاومة الكهربية', 'الضغط الجوي', 'التسارع', 'الكهرومغناطيسية', 'الجدول الدوري', 'التكافؤ'];
const EXAM_KINDS = ['mcq', 'tf', 'complete', 'reason', 'define', 'what-happens', 'problem'];
export function styleOf(text, kind) {
    const t = String(text || '');
    const ar = (t.match(/[؀-ۿ]/g) || []).length, la = (t.match(/[A-Za-z]/g) || []).length;
    const share = ar + la ? ar / (ar + la) : 0;
    const dia = (t.match(DIALECT) || []).length, fus = (t.match(FUSHA) || []).length;
    const translated = TRANSLATED.filter(w => t.includes(w));
    const checks = {
        egyptian: ar > 0 && dia >= 1 && dia >= fus,          // Egyptian Arabic, not فصحى
        englishTerms: la > 0 && translated.length === 0,    // terms kept in English, not translated
        mixed: share >= 0.2,                                // not an all-English answer
        finalLine: !EXAM_KINDS.includes(kind) || finalAnswers(t).length > 0
    };
    const score = Object.values(checks).filter(Boolean).length / 4;
    return { ...checks, score, dialect: dia, fusha: fus, translated, arabicShare: Math.round(share * 100) };
}

// ---------- summaries ----------
export function summarize(items, answers, rate = 53.7) {
    const byItem = Object.fromEntries(items.map(i => [i.id, i]));
    const done = answers.filter(a => !a.error);
    const graded = done.filter(a => a.mark !== null && a.mark !== undefined ? true : a.auto !== null && a.auto !== undefined);
    const ok = graded.filter(a => (a.mark !== null && a.mark !== undefined ? a.mark : a.auto) === 1);
    const marksTotal = graded.reduce((t, a) => t + (byItem[a.item_id] ? byItem[a.item_id].marks : 1), 0);
    const marksOk = ok.reduce((t, a) => t + (byItem[a.item_id] ? byItem[a.item_id].marks : 1), 0);
    const kinds = {};
    for (const a of graded) { const k = (byItem[a.item_id] || {}).kind || 'other'; kinds[k] ||= { graded: 0, ok: 0 }; kinds[k].graded++; if ((a.mark ?? a.auto) === 1) kinds[k].ok++; }
    const styles = done.map(a => { try { return JSON.parse(a.style).score; } catch (e) { return null; } }).filter(v => v !== null);
    const cost = done.reduce((t, a) => t + (a.cost_usd || 0), 0);
    return {
        questions: items.length, answered: done.length, errors: answers.length - done.length,
        graded: graded.length, correct: ok.length, needsMarking: done.length - graded.length,
        accuracy: graded.length ? Math.round(ok.length / graded.length * 1000) / 10 : null,
        marksAccuracy: marksTotal ? Math.round(marksOk / marksTotal * 1000) / 10 : null,
        style: styles.length ? Math.round(styles.reduce((a, b) => a + b, 0) / styles.length * 1000) / 10 : null,
        avgSeconds: done.length ? Math.round(done.reduce((t, a) => t + (a.ms || 0), 0) / done.length / 100) / 10 : null,
        costUsd: Math.round(cost * 10000) / 10000, costPerAnswerEgp: done.length ? Math.round(cost / done.length * rate * 1000) / 1000 : null,
        byKind: kinds
    };
}

const itemOut = (r) => ({ id: r.id, ord: r.ord, section: r.section, kind: r.kind, question: r.question, options: r.options ? JSON.parse(r.options) : null, answer: r.answer, answerIndex: r.answer_index, marks: r.marks, notes: r.notes });
const ansOut = (a) => ({ id: a.id, itemId: a.item_id, text: a.text, final: a.final, auto: a.auto, style: a.style ? JSON.parse(a.style) : null, mark: a.mark, note: a.note, ms: a.ms, costUsd: a.cost_usd, tokensIn: a.tokens_in, tokensOut: a.tokens_out, error: a.error });

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db);
        await ensureTables(db);
        const auth = await requireStaff(request, env, 'copilot.use');
        if (auth.error) return auth.error;
        const rate = Number(env.USD_EGP) > 0 ? Number(env.USD_EGP) : 53.7;
        const loadSet = async (id) => {
            const s = await db.prepare('SELECT * FROM bench_sets WHERE id = ?').bind(id).first();
            if (!s) return null;
            const { results } = await db.prepare('SELECT * FROM bench_items WHERE set_id = ? ORDER BY ord').bind(id).all();
            return { set: s, items: (results || []).map(itemOut) };
        };
        const runAnswers = async (runId) => ((await db.prepare('SELECT * FROM bench_answers WHERE run_id = ? ORDER BY item_id').bind(runId).all()).results || []);

        if (action === 'status') return json({ proReady: claudeReady(env), model: modelFor(env, 'pro'), brand: BRANDS.pro.name, modes: REASONING_MODES, current: env.PRO_REASONING || 'plain', rate });
        if (action === 'sets') {
            const { results: sets } = await db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM bench_items i WHERE i.set_id = s.id) AS n FROM bench_sets s ORDER BY s.grade, s.id`).all();
            const out = [];
            for (const s of sets || []) {
                const { results: runs } = await db.prepare('SELECT * FROM bench_runs WHERE set_id = ? ORDER BY id DESC').bind(s.id).all();
                const L = await loadSet(s.id);
                out.push({ id: s.id, title: s.title, grade: s.grade, source: s.source, questions: s.n, runs: await Promise.all((runs || []).map(async r => ({ id: r.id, mode: r.mode, model: r.model, at: r.created_at, finished: !!r.finished_at, summary: summarize(L.items, await runAnswers(r.id), rate) }))) });
            }
            return json({ sets: out });
        }
        if (action === 'set') {
            const L = await loadSet(parseInt(url.searchParams.get('id'), 10)); if (!L) return bad('Set not found', 404);
            const { results: runs } = await db.prepare('SELECT * FROM bench_runs WHERE set_id = ? ORDER BY id DESC').bind(L.set.id).all();
            const R = [];
            for (const r of runs || []) { const ans = await runAnswers(r.id); R.push({ id: r.id, mode: r.mode, model: r.model, at: r.created_at, finished: !!r.finished_at, answers: ans.map(ansOut), summary: summarize(L.items, ans, rate) }); }
            return json({ set: { id: L.set.id, title: L.set.title, grade: L.set.grade, source: L.set.source }, items: L.items, runs: R });
        }
        if (action === 'export') {   // everything, for an independent marker
            const L = await loadSet(parseInt(url.searchParams.get('id'), 10)); if (!L) return bad('Set not found', 404);
            const { results: runs } = await db.prepare('SELECT * FROM bench_runs WHERE set_id = ? ORDER BY id').bind(L.set.id).all();
            const R = [];
            for (const r of runs || []) { const ans = await runAnswers(r.id); R.push({ id: r.id, mode: r.mode, model: r.model, at: r.created_at, summary: summarize(L.items, ans, rate), answers: ans.map(ansOut) }); }
            return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), set: L.set, items: L.items, runs: R }, null, 2), {
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="model-test-${L.set.grade}-${L.set.id}.json"` } });
        }
        if (request.method !== 'POST') return bad('POST only', 405);
        const data = await request.json().catch(() => ({}));

        if (action === 'import') {
            const { errors, set } = checkSet(data.json ?? data);
            if (errors.length) return bad('Fix the set first', 400, { errors });
            const r = await db.prepare('INSERT INTO bench_sets (title, grade, source) VALUES (?, ?, ?)').bind(set.title, set.grade, set.source).run();
            const sid = Number(r.meta.last_row_id);
            await db.batch(set.items.map((it, i) => db.prepare('INSERT INTO bench_items (set_id, ord, section, kind, question, options, answer, answer_index, marks, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .bind(sid, i + 1, it.section, it.kind, it.question, it.options ? JSON.stringify(it.options) : null, it.answer, it.answerIndex, it.marks, it.notes)));
            return json({ id: sid, questions: set.items.length });
        }
        if (action === 'delete-set') {
            const id = parseInt(data.id, 10);
            const { results: runs } = await db.prepare('SELECT id FROM bench_runs WHERE set_id = ?').bind(id).all();
            await db.batch([...(runs || []).map(r => db.prepare('DELETE FROM bench_answers WHERE run_id = ?').bind(r.id)),
                db.prepare('DELETE FROM bench_runs WHERE set_id = ?').bind(id), db.prepare('DELETE FROM bench_items WHERE set_id = ?').bind(id), db.prepare('DELETE FROM bench_sets WHERE id = ?').bind(id)]);
            return json({ ok: true });
        }
        if (action === 'run-start') {
            const L = await loadSet(parseInt(data.setId, 10)); if (!L) return bad('Set not found', 404);
            if (!claudeReady(env)) return bad(`${BRANDS.pro.name} isn't connected — add the ANTHROPIC_API_KEY secret in Cloudflare first.`, 503, { code: 'PAID_OFF' });
            const mode = REASONING_MODES.includes(data.mode) ? data.mode : 'plain';
            const r = await db.prepare('INSERT INTO bench_runs (set_id, mode, model) VALUES (?, ?, ?)').bind(L.set.id, mode, modelFor(env, 'pro')).run();
            return json({ runId: Number(r.meta.last_row_id), itemIds: L.items.map(i => i.id) });
        }
        if (action === 'run-one') {
            const run = await db.prepare('SELECT * FROM bench_runs WHERE id = ?').bind(parseInt(data.runId, 10)).first(); if (!run) return bad('Run not found', 404);
            const row = await db.prepare('SELECT * FROM bench_items WHERE id = ? AND set_id = ?').bind(parseInt(data.itemId, 10), run.set_id).first(); if (!row) return bad('Question not found', 404);
            const item = itemOut(row);
            const prev = await db.prepare('SELECT * FROM bench_answers WHERE run_id = ? AND item_id = ?').bind(run.id, item.id).first();
            if (prev && !prev.error && !data.redo) return json({ answer: ansOut(prev), skipped: true });
            const set = await db.prepare('SELECT grade FROM bench_sets WHERE id = ?').bind(run.set_id).first();
            const R = reasoning(env, run.mode);
            let fields;
            try {
                // same curriculum-book grounding as a real student's Pro answer (their grade's book passages)
                // exactly what a student gets: the same keyword step + the grade's book + the strict rules
                // (a grade whose book isn't indexed yet is benchmarked without the book)
                const bg = String(set.grade || '').toLowerCase();
                const bf = await searchBook(env, db, { grade: bg, text: askText(item).slice(0, 1500), meter: { staffId: auth.staff.id } });
                const brules = bf.indexed && bf.science ? bookRules(bf.ctx, GRADE_LABELS[bg] || set.grade) : '';
                const out = await chat(env, db, { tier: 'pro', system: tutorPrompt(null, 'pro', { bench: { grade: set.grade }, books: !!bf.ctx.text }) + taskRules('exam', 'pro') + brules + R.system, messages: [{ role: 'user', content: askText(item) }], maxTokens: 1500 + R.extraTokens, temperature: 0.3, thinking: R.thinking, meter: { staffId: auth.staff.id, kind: 'bench' } });
                const text = stripPrivate(out.text);
                const m = autoMark(item, text);
                const u = out.usage || {};
                fields = { text, final: m.final || null, auto: m.auto, style: JSON.stringify(styleOf(text, item.kind)), ms: out.ms, cost: out.costUsd || 0, tin: u.input_tokens ?? null, tout: u.output_tokens ?? null, error: null };
            } catch (e) {
                fields = { text: null, final: null, auto: null, style: null, ms: null, cost: 0, tin: null, tout: null, error: (e instanceof AiLimitError ? e.code + ': ' : '') + String(e.message || e).slice(0, 300) };
            }
            await db.prepare(`INSERT INTO bench_answers (run_id, item_id, text, final, auto, style, ms, cost_usd, tokens_in, tokens_out, error, mark, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
                ON CONFLICT(run_id, item_id) DO UPDATE SET text = excluded.text, final = excluded.final, auto = excluded.auto, style = excluded.style, ms = excluded.ms, cost_usd = excluded.cost_usd,
                tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out, error = excluded.error, mark = NULL, note = NULL, created_at = CURRENT_TIMESTAMP`)
                .bind(run.id, item.id, fields.text, fields.final, fields.auto, fields.style, fields.ms, fields.cost, fields.tin, fields.tout, fields.error).run();
            const saved = await db.prepare('SELECT * FROM bench_answers WHERE run_id = ? AND item_id = ?').bind(run.id, item.id).first();
            // all questions answered → the run is finished
            const left = await db.prepare(`SELECT COUNT(*) c FROM bench_items i WHERE i.set_id = ? AND NOT EXISTS (SELECT 1 FROM bench_answers a WHERE a.run_id = ? AND a.item_id = i.id AND a.error IS NULL)`).bind(run.set_id, run.id).first();
            if (left.c === 0 && !run.finished_at) await db.prepare('UPDATE bench_runs SET finished_at = CURRENT_TIMESTAMP WHERE id = ?').bind(run.id).run();
            if (fields.error && /DAILY_CAP|MONTHLY_CAP|PAID_OFF/.test(fields.error)) return json({ answer: ansOut(saved), stop: fields.error }, 200);
            return json({ answer: ansOut(saved) });
        }
        if (action === 'mark') {   // Miss Marwa's ✓ / ✗ (null = clear)
            const a = await db.prepare('SELECT id FROM bench_answers WHERE id = ?').bind(parseInt(data.answerId, 10)).first(); if (!a) return bad('Answer not found', 404);
            const mark = data.mark === 1 || data.mark === 0 ? data.mark : null;
            await db.prepare('UPDATE bench_answers SET mark = ?, note = ? WHERE id = ?').bind(mark, data.note ? String(data.note).slice(0, 500) : null, a.id).run();
            return json({ ok: true });
        }
        if (action === 'delete-run') {
            const id = parseInt(data.id, 10);
            await db.batch([db.prepare('DELETE FROM bench_answers WHERE run_id = ?').bind(id), db.prepare('DELETE FROM bench_runs WHERE id = ?').bind(id)]);
            return json({ ok: true });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('model-test error', err);
        return bad(err.message || 'Something went wrong', 500);
    }
}
