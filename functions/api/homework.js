// =============================================================
// Homework · الواجبات — assignments + answer keys (Step 2)
//
// Staff create an assignment for a grade / unit / lesson with a deadline and a total score,
// then build the answer key the grader (Step 3, Workers AI) marks against:
//   mcq    — correct letter (+ optional answer text, if students write the word)
//   tf     — true / false (+ optional correction for false statements)
//   short  — answer + accepted alternative wordings
//   essay  — model answer + key ideas, each worth points (score = sum of ideas found)
//
// States: draft → published (push to the grade, once) → closed.
// Late work is accepted after the deadline until the assignment closes
// (closes_at, or a manual Close). Submissions arrive in Step 3.
// =============================================================
import { requireStaff, ensureAppSchema, auditStmt, can } from './admin-auth.js';
import { r2, mediaInfo, mediaResponse, deleteMedia } from './media-store.js';
import { runAI, parseJsonLoose, solvePrompt, aiReady, usageToday, quotaHitToday, visionModel, VISION_MODELS, DAILY_FREE_NEURONS, AiQuotaError, AiUnavailableError } from './ai-engine.js';
import { gradeStep, processQueue, resultOf, weaknessReport, releaseMode, RELEASE_KEY, loadKey, purgeHomeworkMedia, pushToStudent } from './hw-grader.js';

const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
const TYPES = ['mcq', 'tf', 'short', 'essay'];
export const HW_UNITS = 6, HW_LESSONS = 6;
const MAX_QUESTIONS = 60;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);
const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const str = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const round2 = (n) => Math.round(n * 100) / 100;
const intIn = (v, max) => { const n = parseInt(v, 10); return n >= 1 && n <= max ? n : null; };

// "2026-11-20T18:00:00.000Z" / "2026-11-20 18:00:00" → "2026-11-20 18:00:00" (UTC) or null
function utc(v) {
    if (!v) return null;
    const s = String(v);
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}
const ms = (v) => (v ? new Date(String(v).replace(' ', 'T') + 'Z').getTime() : NaN);

// Effective state: a published assignment whose closing time has passed counts as closed.
function stateOf(a, now = Date.now()) {
    if (a.status === 'published' && a.closes_at && ms(a.closes_at) <= now) return 'closed';
    return a.status;
}

// ---------- Answer-key validation ----------
// Returns { questions, errors, sum }. `strict` = publishing (everything must be complete).
export function cleanKey(input, { strict = false } = {}) {
    const errors = [], questions = [];
    const list = Array.isArray(input) ? input.slice(0, MAX_QUESTIONS + 1) : [];
    if (list.length > MAX_QUESTIONS) errors.push(`At most ${MAX_QUESTIONS} questions`);
    const labels = new Set();
    list.slice(0, MAX_QUESTIONS).forEach((q, i) => {
        const n = i + 1;
        const type = TYPES.includes(q && q.type) ? q.type : null;
        if (!type) { errors.push(`Question ${n}: choose a type`); return; }
        const label = str(q.label, 12) || String(n);
        const name = `Question ${label}`;
        if (labels.has(label.toLowerCase())) errors.push(`${name}: the number "${label}" is used twice`);
        labels.add(label.toLowerCase());
        const points = round2(num(q.points));
        if (!(points > 0) || points > 100) errors.push(`${name}: points must be more than 0`);
        const prompt = str(q.prompt, 1000);
        const out = { label, type, prompt, points: points > 0 ? points : 0, answer: '', extra: {} };
        out.extra.explanation = str(q.explanation, 600);
        if (q.aiCheck) { out.extra.aiCheck = true; if (strict) errors.push(`${name}: check the AI answer (tap "Looks right")`); }
        if (Number.isFinite(Number(q.confidence)) && q.confidence !== null && q.confidence !== '') out.extra.confidence = Math.round(Number(q.confidence) * 100) / 100;
        if (type === 'mcq') {
            const letter = str(q.answer, 1).toUpperCase();
            if (!/^[A-F]$/.test(letter)) { if (strict) errors.push(`${name}: pick the correct letter`); }
            else out.answer = letter;
            out.extra.answerText = str(q.answerText, 300);
            out.extra.options = (Array.isArray(q.options) ? q.options : []).map(o => str(o, 200)).slice(0, 6);
        } else if (type === 'tf') {
            const v = String(q.answer).toLowerCase();
            if (v !== 'true' && v !== 'false') { if (strict) errors.push(`${name}: choose True or False`); }
            else out.answer = v;
            out.extra.correction = v === 'false' ? str(q.correction, 300) : '';
        } else if (type === 'short') {
            out.answer = str(q.answer, 300);
            if (!out.answer && strict) errors.push(`${name}: type the answer`);
            const alts = (Array.isArray(q.alternatives) ? q.alternatives : []).map(a => str(a, 200)).filter(Boolean);
            out.extra.alternatives = [...new Set(alts)].slice(0, 15);
        } else if (type === 'essay') {
            out.extra.modelAnswer = str(q.modelAnswer, 2000);
            const ideas = (Array.isArray(q.ideas) ? q.ideas : []).slice(0, 12)
                .map(it => ({ text: str(it && it.text, 200), points: round2(num(it && it.points)) }))
                .filter(it => it.text);
            out.extra.ideas = ideas.map(it => ({ text: it.text, points: it.points > 0 ? it.points : 0 }));
            if (!ideas.length) { if (strict) errors.push(`${name}: add at least one key idea`); }
            else {
                if (ideas.some(it => !(it.points > 0))) errors.push(`${name}: every key idea needs points`);
                const s = round2(ideas.reduce((t, it) => t + (it.points > 0 ? it.points : 0), 0));
                if (Math.abs(s - points) > 0.01) errors.push(`${name}: key ideas add up to ${s}, but the question is worth ${points}`);
            }
            if (!out.extra.modelAnswer && strict && !ideas.length) errors.push(`${name}: add the model answer`);
        }
        questions.push(out);
    });
    const sum = round2(questions.reduce((t, q) => t + q.points, 0));
    return { questions, errors, sum };
}

function cleanAssignment(d) {
    const errors = [];
    const grade = GRADES.includes(String(d.grade || '').toLowerCase()) ? String(d.grade).toLowerCase() : null;
    if (!grade) errors.push('Choose the grade');
    const unit = intIn(d.unit, HW_UNITS), lesson = intIn(d.lesson, HW_LESSONS);
    if (!unit) errors.push('Choose the unit');
    if (!lesson) errors.push('Choose the lesson');
    const title = str(d.title, 150) || (unit && lesson ? `Unit ${unit} · Lesson ${lesson} homework` : '');
    const deadline = utc(d.deadline);
    const closesAt = d.closesAt ? utc(d.closesAt) : null;
    if (d.deadline && !deadline) errors.push('The deadline is not a valid date');
    if (closesAt && deadline && ms(closesAt) < ms(deadline)) errors.push('"Accept late work until" must be after the deadline');
    const total = round2(num(d.totalScore));
    if (!(total > 0) || total > 1000) errors.push('Total score must be more than 0');
    let source = null;
    if (d.source && typeof d.source === 'object') source = JSON.stringify({ kind: d.source.kind === 'r2' ? 'r2' : 'upload', key: str(d.source.key, 300), name: str(d.source.name, 200), pages: (Array.isArray(d.source.pages) ? d.source.pages : []).map(Number).filter(n => n > 0).slice(0, 60) });
    return { grade, unit, lesson, title, instructions: str(d.instructions, 1000), deadline, closesAt, total: total > 0 ? total : 0, source, errors };
}

// ---------- Push to the grade (OneSignal tag "grade", set by the student portal) ----------
async function pushToGrade(env, origin, grade, title, message) {
    const appId = env.ONESIGNAL_APP_ID, apiKey = env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey) return { sent: false, reason: 'not-configured' };
    try {
        const r = await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Key ${apiKey}` },
            body: JSON.stringify({
                app_id: appId, target_channel: 'push',
                headings: { en: title, ar: title }, contents: { en: message, ar: message },
                filters: [{ field: 'tag', key: 'grade', relation: '=', value: grade.toUpperCase() }],
                web_url: `${origin}/exams.html?tab=homework`
            })
        });
        return { sent: r.ok };
    } catch (e) { return { sent: false, reason: e.message }; }
}
function arDate(v) {
    try { return new Date(String(v).replace(' ', 'T') + 'Z').toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return String(v); }
}

// AI "solve" reply → answer-key builder questions (flagged aiCheck so staff review them)
function normaliseSolved(parsed) {
    const list = parsed && Array.isArray(parsed.questions) ? parsed.questions : Array.isArray(parsed) ? parsed : [];
    return list.slice(0, MAX_QUESTIONS).map((q, i) => {
        const t = String(q.type || '').toLowerCase();
        const type = ['mcq', 'choose', 'choice'].includes(t) ? 'mcq' : ['tf', 'true_false', 'truefalse', 'true/false'].includes(t) ? 'tf' : ['essay', 'reason', 'explain'].includes(t) ? 'essay' : 'short';
        let answer = String(q.answer ?? '').trim();
        if (type === 'mcq') { const m = answer.toLowerCase().match(/[a-f]/); answer = m ? m[0].toUpperCase() : ''; }
        if (type === 'tf') answer = /^(true|t|✓|yes|صح)/i.test(answer) ? 'true' : /^(false|f|✗|x|no|خطأ|خطا)/i.test(answer) ? 'false' : '';
        const ideas = (Array.isArray(q.ideas) ? q.ideas : []).map(x => ({ text: str(typeof x === 'string' ? x : x && x.text, 200), points: 1 })).filter(x => x.text).slice(0, 6);
        const conf = Number(q.confidence);
        return {
            label: str(q.label, 12) || String(i + 1), type, prompt: str(q.question || q.prompt, 1000),
            options: (Array.isArray(q.options) ? q.options : []).map(o => str(o, 200)).slice(0, 6),
            answer: type === 'short' ? str(answer, 300) : answer, answerText: type === 'mcq' ? str(q.answer_text || q.answerText, 300) : '',
            correction: type === 'tf' ? str(q.correction, 300) : '', alternatives: (Array.isArray(q.alternatives) ? q.alternatives : []).map(x => str(x, 200)).filter(Boolean).slice(0, 15),
            modelAnswer: type === 'essay' ? str(q.model_answer || q.modelAnswer, 2000) : '', ideas: type === 'essay' ? ideas : [],
            explanation: str(q.explanation, 600), confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null, aiCheck: true
        };
    });
}

const rowOut = (a, extra = {}) => ({
    id: a.id, grade: a.grade, unit: a.unit, lesson: a.lesson, title: a.title, instructions: a.instructions || '',
    deadline: a.deadline, closesAt: a.closes_at, totalScore: a.total_score, status: a.status, state: stateOf(a),
    createdBy: a.created_by, updatedBy: a.updated_by, createdAt: a.created_at, updatedAt: a.updated_at,
    publishedAt: a.published_at, closedAt: a.closed_at, pushSentAt: a.push_sent_at, source: (() => { try { return a.source ? JSON.parse(a.source) : null; } catch (e) { return null; } })(), ...extra
});
const qOut = (q) => {
    let extra = {}; try { extra = JSON.parse(q.extra || '{}'); } catch (e) { }
    return { id: q.id, label: q.label, type: q.type, prompt: q.prompt || '', points: q.points, answer: q.answer || '', ...extra };
};

async function loadQuestions(db, id) {
    const { results } = await db.prepare('SELECT * FROM hw_questions WHERE assignment_id = ? ORDER BY ord, id').bind(id).all();
    return (results || []).map(qOut);
}
async function submissionsCount(db, id) {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM hw_submissions WHERE assignment_id = ?').bind(id).first();
    return r ? r.n : 0;
}
function questionStmts(db, id, questions) {
    return [
        db.prepare('DELETE FROM hw_questions WHERE assignment_id = ?').bind(id),
        ...questions.map((q, i) => db.prepare('INSERT INTO hw_questions (assignment_id, ord, label, type, prompt, answer, extra, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, i + 1, q.label, q.type, q.prompt || null, q.answer || null, JSON.stringify(q.extra), q.points))
    ];
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db);
        const isPost = request.method === 'POST';
        const data = isPost ? await request.json().catch(() => ({})) : {};
        const need = {
            list: 'homework.view', get: 'homework.view', save: 'homework.create', publish: 'homework.publish', close: 'homework.publish', reopen: 'homework.publish', unpublish: 'homework.publish', delete: 'homework.delete',
            books: 'homework.create', book: 'homework.create', 'ai-solve-page': 'homework.create', 'ai-lab': 'homework.create', usage: 'homework.view',
            settings: 'homework.view', 'set-release': 'settings.manage',
            submissions: 'homework.view', submission: 'homework.view', review: 'homework.review', regrade: 'homework.review', 'grade-step': 'homework.review',
            report: 'homework.view', verify: 'homework.view', page: 'homework.view', counts: 'homework.view'
        }[action];
        if (!need) return bad('Unknown action', 404);
        const GETS = ['list', 'get', 'books', 'book', 'usage', 'settings', 'submissions', 'submission', 'verify', 'page', 'counts'];
        if (!GETS.includes(action) && !isPost) return bad('POST only', 405);
        const auth = await requireStaff(request, env, need);
        if (auth.error) return auth.error;
        const staff = auth.staff;

        // ---------- list (per grade) ----------
        if (action === 'list') {
            const bg = (async () => { await processQueue(env, db, 3, url.origin).catch(() => null); await purgeHomeworkMedia(env, db).catch(() => null); })();
            if (context.waitUntil) context.waitUntil(bg);
            const grade = String(url.searchParams.get('grade') || '').toLowerCase();
            const where = GRADES.includes(grade) ? 'WHERE a.grade = ?' : '';
            const { results } = await db.prepare(`SELECT a.*,
                    (SELECT COUNT(*) FROM hw_questions q WHERE q.assignment_id = a.id) AS q_count,
                    (SELECT COALESCE(SUM(points), 0) FROM hw_questions q WHERE q.assignment_id = a.id) AS q_points,
                    (SELECT COUNT(*) FROM hw_submissions s WHERE s.assignment_id = a.id AND s.status != 'uploading') AS submitted,
                    (SELECT COUNT(*) FROM hw_submissions s WHERE s.assignment_id = a.id AND s.status = 'needs_review') AS needs_review
                FROM hw_assignments a ${where} ORDER BY a.id DESC LIMIT 300`).bind(...(where ? [grade] : [])).all();
            const { results: roster } = await db.prepare('SELECT LOWER(grade) AS g, COUNT(*) AS n FROM students GROUP BY LOWER(grade)').all();
            const students = {}; (roster || []).forEach(r => { students[r.g] = r.n; });
            return json({
                items: (results || []).map(a => rowOut(a, { questions: a.q_count, points: round2(a.q_points), submitted: a.submitted, needsReview: a.needs_review, students: students[a.grade] || 0 })),
                students, units: HW_UNITS, lessons: HW_LESSONS
            });
        }

        if (action === 'counts') {     // for the Today page
            const r = await db.prepare(`SELECT SUM(CASE WHEN status IN ('pending', 'needs_review') THEN 1 ELSE 0 END) AS to_check,
                SUM(CASE WHEN status IN ('grading', 'queued') THEN 1 ELSE 0 END) AS marking FROM hw_submissions`).first();
            return json({ toCheck: (r && r.to_check) || 0, marking: (r && r.marking) || 0 });
        }

        // ================= Books in R2 (for "Auto-solve from homework PDF") =================
        if (action === 'books') {
            const bucket = r2(env);
            if (!bucket) return bad('Cloudflare R2 (MEDIA) is not connected', 503);
            const out = []; let cursor; const prefix = url.searchParams.get('prefix') || undefined;
            for (let k = 0; k < 10; k++) {
                const page = await bucket.list({ limit: 1000, cursor, prefix });
                for (const o of page.objects || []) {
                    if (/^(ask|hw|hwkey)\//.test(o.key) || !/\.pdf$/i.test(o.key)) continue;
                    out.push({ key: o.key, size: o.size, uploaded: o.uploaded || null });
                }
                if (!page.truncated || !page.cursor) break;
                cursor = page.cursor;
            }
            out.sort((x, y) => x.key.localeCompare(y.key, 'en', { numeric: true }));
            return json({ books: out });
        }
        if (action === 'book') {        // stream a book PDF with Range support (pdf.js only downloads the pages it needs)
            const bucket = r2(env), key = url.searchParams.get('key') || '';
            if (!bucket) return bad('Cloudflare R2 (MEDIA) is not connected', 503);
            if (!/\.pdf$/i.test(key) || /^(ask|hw|hwkey)\//.test(key) || key.includes('..')) return bad('Not a book', 400);
            const head = await bucket.head(key);
            if (!head) return bad('Book not found', 404);
            const size = head.size, range = request.headers.get('Range');
            const base = { 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
            const m = range && range.match(/bytes=(\d*)-(\d*)/);
            if (m && (m[1] || m[2])) {
                let start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
                let end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
                if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
                const obj = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
                return new Response(obj.body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
            }
            const obj = await bucket.get(key);
            return new Response(obj.body, { headers: { ...base, 'Content-Length': String(size) } });
        }

        // ================= Workers AI =================
        if (action === 'usage') {
            return json({ today: await usageToday(db), limit: DAILY_FREE_NEURONS, quotaHit: await quotaHitToday(db), ai: aiReady(env), model: visionModel(env), models: VISION_MODELS });
        }
        if (action === 'ai-solve-page' || action === 'ai-lab') {
            if (!aiReady(env)) return bad('Workers AI is not connected — add the AI binding in Cloudflare', 503, { code: 'AI_OFF' });
            const image = String(data.image || '');
            if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return bad('Send the page as an image', 400);
            if (image.length > 3_000_000) return bad('Page image too large — under 2 MB please', 413);
            const model = VISION_MODELS.includes(data.model) ? data.model : undefined;
            const task = action === 'ai-solve-page' ? 'solve' : (data.task || 'solve');
            let prompt;
            if (task === 'solve') prompt = solvePrompt({ grade: data.grade, unit: data.unit, lesson: data.lesson, continueFrom: data.continueFrom || null });
            else if (task === 'read') {
                const { readPrompt } = await import('./ai-engine.js');
                const key = data.assignmentId ? await loadKey(db, parseInt(data.assignmentId, 10)) : (Array.isArray(data.key) ? data.key : []);
                if (!key.length) return bad('Pick a homework (its answer key tells the AI which questions to look for)', 400);
                prompt = readPrompt({ key, pageNo: 1, pages: 1 });
            } else prompt = str(data.prompt, 4000) || 'Describe this page.';
            try {
                const out = await runAI(env, db, { image, prompt, model, maxTokens: task === 'solve' ? 4096 : 2048 });
                const parsed = parseJsonLoose(out.text);
                const res = { model: out.model, format: out.format, ms: out.ms, neurons: out.neurons, usage: out.usage, today: await usageToday(db), limit: DAILY_FREE_NEURONS, parsed };
                if (action === 'ai-lab') return json({ ...res, task, raw: out.text, prompt });
                const questions = normaliseSolved(parsed);
                return json({ ...res, questions, sections: (parsed && parsed.page_sections) || [], raw: questions.length ? undefined : String(out.text).slice(0, 3000) });
            } catch (e) {
                if (e instanceof AiQuotaError) return bad("Today's free AI allowance is used up — it resets at 2:00 am (Cairo).", 429, { code: 'AI_QUOTA' });
                if (e instanceof AiUnavailableError) return bad(e.message, 503, { code: 'AI_OFF' });
                return bad('Workers AI error: ' + (e.message || e), 502, { code: 'AI_ERROR' });
            }
        }

        // ================= Release mode (staff confirm first, or instant) =================
        if (action === 'settings') {
            const mode = await releaseMode(db);
            const agg = await db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN a.override_points IS NULL OR ABS(a.override_points - a.ai_points) < 0.001 THEN 1 ELSE 0 END) AS same
                FROM hw_answers a JOIN hw_submissions s ON s.id = a.submission_id WHERE s.released_at IS NOT NULL`).first();
            const checked = await db.prepare(`SELECT COUNT(*) AS n FROM hw_submissions WHERE released_by IS NOT NULL`).first();
            return json({ releaseMode: mode, agreement: agg && agg.n ? Math.round(agg.same / agg.n * 1000) / 10 : null, answersChecked: agg ? agg.n : 0, submissionsChecked: checked ? checked.n : 0, canChange: can(staff, 'settings.manage') });
        }
        if (action === 'set-release') {
            const mode = data.mode === 'instant' ? 'instant' : 'confirm';
            await db.batch([
                db.prepare(`INSERT INTO app_kv ("key", value) VALUES (?, ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(RELEASE_KEY, mode),
                auditStmt(db, request, staff, 'homework.release-mode', null, { mode })
            ]);
            return json({ ok: true, releaseMode: mode });
        }

        // ================= Submissions =================
        if (action === 'verify') {     // receipt code shown at the door
            const code = String(url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const r = code ? await db.prepare(`SELECT s.id, s.status, s.final_score, s.submitted_at, s.late, s.released_at, a.title, a.total_score, st.first_name, st.last_name, st.student_id
                FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id LEFT JOIN students st ON st.student_id = s.student_id WHERE s.receipt_code = ?`).bind(code).first() : null;
            if (!r) return json({ found: false });
            return json({ found: true, id: r.id, studentId: r.student_id, name: `${r.first_name || ''} ${r.last_name || ''}`.trim(), title: r.title, status: r.status, score: r.final_score, total: r.total_score, submittedAt: r.submitted_at, late: !!r.late });
        }
        if (action === 'page') {       // a submitted page image (staff)
            const mid = parseInt(url.searchParams.get('media'), 10);
            const info = mid ? await mediaInfo(db, mid) : null;
            if (!info || info.kind !== 'hw') return new Response('Not found', { status: 404 });
            return (await mediaResponse(env, db, info)) || new Response('Not found', { status: 404 });
        }
        if (action === 'submissions') {
            const aid = parseInt(url.searchParams.get('assignment'), 10);
            const asg = aid ? await db.prepare('SELECT * FROM hw_assignments WHERE id = ?').bind(aid).first() : null;
            if (!asg) return bad('Homework not found', 404);
            const { results } = await db.prepare(`SELECT s.*, st.first_name, st.last_name, st.gender, st.branch, st.phone, st.parent_phone FROM hw_submissions s
                LEFT JOIN students st ON st.student_id = s.student_id WHERE s.assignment_id = ? ORDER BY s.submitted_at`).bind(aid).all();
            const { results: missing } = await db.prepare(`SELECT student_id, first_name, last_name, gender, branch, phone, parent_phone FROM students
                WHERE LOWER(grade) = ? AND student_id NOT IN (SELECT student_id FROM hw_submissions WHERE assignment_id = ? AND status != 'uploading') ORDER BY first_name, last_name`).bind(asg.grade, aid).all();
            const who = (r) => ({ studentId: r.student_id, firstName: r.first_name || '?', lastName: r.last_name || '', gender: r.gender, branch: r.branch, phone: r.phone, parentPhone: r.parent_phone });
            return json({
                assignment: rowOut(asg),
                submissions: (results || []).filter(r => r.status !== 'uploading').map(r => ({ id: r.id, ...who(r), status: r.status, score: r.final_score, autoScore: r.auto_score, late: !!r.late, unreadable: !!r.unreadable,
                    pages: r.pages, submittedAt: r.submitted_at, gradedAt: r.graded_at, releasedAt: r.released_at, releasedBy: r.released_by, receipt: r.receipt_code, error: r.ai_error })),
                missing: (missing || []).map(who)
            });
        }
        if (action === 'submission') {
            const sid = parseInt(url.searchParams.get('id'), 10);
            const r = sid ? await resultOf(db, sid) : null;
            if (!r) return bad('Submission not found', 404);
            const { results: pages } = await db.prepare('SELECT page_no, media_id, status, read_json FROM hw_pages WHERE submission_id = ? ORDER BY page_no').bind(sid).all();
            const st = await db.prepare('SELECT first_name, last_name, gender, branch, phone, parent_phone FROM students WHERE student_id = ?').bind(r.studentId).first() || {};
            return json({ ...r, student: { id: r.studentId, firstName: st.first_name, lastName: st.last_name, gender: st.gender, branch: st.branch, phone: st.phone, parentPhone: st.parent_phone },
                pageList: (pages || []).map(p => { let j = {}; try { j = JSON.parse(p.read_json || '{}'); } catch (e) { } return { pageNo: p.page_no, mediaId: p.media_id, status: p.status, readable: j.page_readable !== false, notes: j.notes || '' }; }) });
        }
        if (action === 'review') {     // staff override marks and/or release the result to the student
            const sid = parseInt(data.id, 10);
            const sub = sid ? await db.prepare('SELECT s.*, a.title FROM hw_submissions s JOIN hw_assignments a ON a.id = s.assignment_id WHERE s.id = ?').bind(sid).first() : null;
            if (!sub) return bad('Submission not found', 404);
            if (['uploading', 'grading', 'queued'].includes(sub.status)) return bad('Still being marked — try again in a moment', 409);
            const key = await loadKey(db, sub.assignment_id), byId = Object.fromEntries(key.map(q => [q.id, q]));
            const stmts = [];
            for (const [qid, v] of Object.entries(data.overrides || {})) {
                const q = byId[qid]; if (!q) continue;
                const val = v === null || v === '' ? null : Math.max(0, Math.min(Number(q.points), Math.round(Number(v) * 100) / 100));
                if (val !== null && !Number.isFinite(val)) continue;
                stmts.push(db.prepare(`INSERT INTO hw_answers (submission_id, question_id, verdict, points, ai_points, override_points) VALUES (?, ?, 'blank', 0, 0, ?)
                    ON CONFLICT(submission_id, question_id) DO UPDATE SET override_points = excluded.override_points`).bind(sid, q.id, val));
            }
            if (stmts.length) await db.batch(stmts);
            const tot = await db.prepare('SELECT COALESCE(SUM(COALESCE(override_points, points)), 0) AS t FROM hw_answers WHERE submission_id = ?').bind(sid).first();
            const final = Math.round((tot ? tot.t : 0) * 100) / 100;
            const release = !!data.release;
            await db.batch([
                db.prepare(`UPDATE hw_submissions SET final_score = ?, ${release ? `status = 'graded', released_at = COALESCE(released_at, CURRENT_TIMESTAMP), released_by = ?,` : ''} updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                    .bind(...(release ? [final, staff.name, sid] : [final, sid])),
                auditStmt(db, request, staff, release ? 'homework.release' : 'homework.override', String(sid), { overrides: data.overrides || {}, final, title: sub.title, student: sub.student_id })
            ]);
            if (release && !sub.released_at) {
                const p = pushToStudent(env, url.origin, sub.student_id, 'نتيجة الواجب جاهزة ✅', `${sub.title} — افتح التطبيق وشوف درجتك`, '/homework.html?id=' + sub.assignment_id);
                if (context.waitUntil) context.waitUntil(p);
            }
            return json({ ok: true, final, released: release || !!sub.released_at });
        }
        if (action === 'regrade') {    // mark again (e.g. after fixing a page) — pages are kept
            const sid = parseInt(data.id, 10);
            const sub = sid ? await db.prepare('SELECT * FROM hw_submissions WHERE id = ?').bind(sid).first() : null;
            if (!sub) return bad('Submission not found', 404);
            await db.batch([
                db.prepare(`UPDATE hw_pages SET status = 'new', read_json = NULL WHERE submission_id = ?`).bind(sid),
                db.prepare(`DELETE FROM hw_answers WHERE submission_id = ?`).bind(sid),
                db.prepare(`UPDATE hw_submissions SET status = 'grading', released_at = NULL, released_by = NULL, report = NULL, ai_error = NULL, tries = 0, lock_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(sid),
                auditStmt(db, request, staff, 'homework.regrade', String(sid), { student: sub.student_id, previous: sub.final_score })
            ]);
            return json({ ok: true });
        }
        if (action === 'grade-step') {
            const sid = parseInt(data.id, 10);
            return json(await gradeStep(env, db, sid));
        }
        if (action === 'report') {
            const sid = parseInt(data.id, 10);
            const rep = sid ? await weaknessReport(env, db, sid, { refresh: !!data.refresh }) : null;
            if (!rep) return bad('Submission not found', 404);
            return json(rep);
        }

        const id = parseInt(isPost ? data.id : url.searchParams.get('id'), 10) || null;
        const a = id ? await db.prepare('SELECT * FROM hw_assignments WHERE id = ?').bind(id).first() : null;
        if (id && !a) return bad('Homework not found', 404);

        if (action === 'get') {
            if (!a) return bad('Homework not found', 404);
            return json({ assignment: rowOut(a, { submitted: await submissionsCount(db, a.id) }), questions: await loadQuestions(db, a.id) });
        }

        // ---------- save (create draft / update) ----------
        if (action === 'save') {
            const c = cleanAssignment(data);
            const key = cleanKey(data.questions, { strict: false });
            const errors = [...c.errors, ...key.errors];
            if (errors.length) return bad(errors[0], 400, { errors });
            if (a) {
                const subs = await submissionsCount(db, a.id);
                if (subs && (a.grade !== c.grade)) return bad("Students already submitted — the grade can't change", 409);
                if (subs) return bad('Students already submitted this homework — the answer key is locked. (Re-marking arrives with grading.)', 409, { code: 'LOCKED' });
                if (a.status !== 'draft' && c.grade !== a.grade) return bad("The grade can't change after publishing", 409);
                await db.batch([
                    db.prepare(`UPDATE hw_assignments SET grade = ?, unit = ?, lesson = ?, title = ?, instructions = ?, deadline = ?, closes_at = ?, total_score = ?,
                        source = COALESCE(?, source), updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(c.grade, c.unit, c.lesson, c.title, c.instructions || null, c.deadline, c.closesAt, c.total, c.source, staff.name, a.id),
                    ...questionStmts(db, a.id, key.questions),
                    auditStmt(db, request, staff, 'homework.save', String(a.id), { title: c.title, grade: c.grade, questions: key.questions.length, status: a.status })
                ]);
                return json({ ok: true, id: a.id, sum: key.sum });
            }
            const r = await db.prepare(`INSERT INTO hw_assignments (grade, unit, lesson, title, instructions, deadline, closes_at, total_score, status, created_by, updated_by, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`).bind(c.grade, c.unit, c.lesson, c.title, c.instructions || null, c.deadline, c.closesAt, c.total, staff.name, staff.name, c.source).run();
            const newId = Number(r.meta.last_row_id);
            await db.batch([...questionStmts(db, newId, key.questions), auditStmt(db, request, staff, 'homework.create', String(newId), { title: c.title, grade: c.grade })]);
            return json({ ok: true, id: newId, sum: key.sum, created: true });
        }

        if (!a) return bad('Homework not found', 404);

        // ---------- publish ----------
        if (action === 'publish') {
            if (a.status === 'published' && stateOf(a) === 'published') return json({ ok: true, already: true });
            const questions = await loadQuestions(db, a.id);
            const key = cleanKey(questions, { strict: true });
            const errors = [...key.errors];
            if (!questions.length) errors.push('Add at least one question to the answer key');
            if (!a.deadline) errors.push('Set the deadline');
            else if (ms(a.deadline) <= Date.now()) errors.push('The deadline has already passed — choose a later one');
            if (questions.length && Math.abs(key.sum - a.total_score) > 0.01) errors.push(`Question points add up to ${key.sum}, but the total score is ${a.total_score}`);
            if (errors.length) return bad(errors[0], 400, { errors });
            const firstPublish = !a.push_sent_at;
            await db.batch([
                db.prepare(`UPDATE hw_assignments SET status = 'published', published_at = COALESCE(published_at, CURRENT_TIMESTAMP), closed_at = NULL,
                    push_sent_at = COALESCE(push_sent_at, CURRENT_TIMESTAMP), updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(staff.name, a.id),
                auditStmt(db, request, staff, 'homework.publish', String(a.id), { title: a.title, grade: a.grade, deadline: a.deadline })
            ]);
            let push = { sent: false, reason: 'already-sent' };
            if (firstPublish) {
                const p = pushToGrade(env, url.origin, a.grade, 'واجب جديد 📚', `${a.title} — آخر موعد للتسليم ${arDate(a.deadline)}`);
                if (context.waitUntil) { context.waitUntil(p); push = { sent: true, queued: true }; } else push = await p;
            }
            return json({ ok: true, push });
        }

        // ---------- close / reopen / back to draft ----------
        if (action === 'close') {
            if (a.status === 'draft') return bad('Drafts are not open — nothing to close', 409);
            await db.batch([
                db.prepare(`UPDATE hw_assignments SET status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(staff.name, a.id),
                auditStmt(db, request, staff, 'homework.close', String(a.id), { title: a.title })
            ]);
            return json({ ok: true });
        }
        if (action === 'reopen') {
            if (a.status === 'draft') return bad('Publish the draft instead', 409);
            // late work accepted again: drop a closing time that has already passed (or use the new one)
            const closesAt = data.closesAt ? utc(data.closesAt) : (a.closes_at && ms(a.closes_at) > Date.now() ? a.closes_at : null);
            await db.batch([
                db.prepare(`UPDATE hw_assignments SET status = 'published', closed_at = NULL, closes_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(closesAt, staff.name, a.id),
                auditStmt(db, request, staff, 'homework.reopen', String(a.id), { title: a.title })
            ]);
            return json({ ok: true });
        }
        if (action === 'unpublish') {
            if (await submissionsCount(db, a.id)) return bad('Students already submitted — close it instead', 409);
            await db.batch([
                db.prepare(`UPDATE hw_assignments SET status = 'draft', updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(staff.name, a.id),
                auditStmt(db, request, staff, 'homework.unpublish', String(a.id), { title: a.title })
            ]);
            return json({ ok: true });
        }

        // ---------- delete (teacher; full copy kept in the activity log) ----------
        if (action === 'delete') {
            const questions = await loadQuestions(db, a.id);
            const subs = await submissionsCount(db, a.id);
            const { results: pg } = await db.prepare('SELECT media_id FROM hw_pages WHERE submission_id IN (SELECT id FROM hw_submissions WHERE assignment_id = ?) AND media_id IS NOT NULL').bind(a.id).all();
            if (subs && data.confirm !== 'DELETE') return bad(`${subs} student${subs === 1 ? '' : 's'} already submitted — confirm to delete their submissions too`, 409, { code: 'HAS_SUBMISSIONS', submissions: subs });
            await db.batch([
                auditStmt(db, request, staff, 'homework.delete', String(a.id), { assignment: rowOut(a), questions, submissions: subs }),
                db.prepare('DELETE FROM hw_answers WHERE submission_id IN (SELECT id FROM hw_submissions WHERE assignment_id = ?)').bind(a.id),
                db.prepare('DELETE FROM hw_pages WHERE submission_id IN (SELECT id FROM hw_submissions WHERE assignment_id = ?)').bind(a.id),
                db.prepare('DELETE FROM hw_submissions WHERE assignment_id = ?').bind(a.id),
                db.prepare('DELETE FROM hw_questions WHERE assignment_id = ?').bind(a.id),
                db.prepare('DELETE FROM hw_assignments WHERE id = ?').bind(a.id)
            ]);
            if ((pg || []).length) await deleteMedia(env, db, pg.map(x => x.media_id));
            return json({ ok: true });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('homework error', err);
        return bad(err.message || 'Something went wrong', 500);
    }
}
