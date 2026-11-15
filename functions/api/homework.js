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
import { requireStaff, ensureAppSchema, auditStmt } from './admin-auth.js';

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
        if (type === 'mcq') {
            const letter = str(q.answer, 1).toUpperCase();
            if (!/^[A-F]$/.test(letter)) { if (strict) errors.push(`${name}: pick the correct letter`); }
            else out.answer = letter;
            out.extra.answerText = str(q.answerText, 300);
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
    return { grade, unit, lesson, title, instructions: str(d.instructions, 1000), deadline, closesAt, total: total > 0 ? total : 0, errors };
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

const rowOut = (a, extra = {}) => ({
    id: a.id, grade: a.grade, unit: a.unit, lesson: a.lesson, title: a.title, instructions: a.instructions || '',
    deadline: a.deadline, closesAt: a.closes_at, totalScore: a.total_score, status: a.status, state: stateOf(a),
    createdBy: a.created_by, updatedBy: a.updated_by, createdAt: a.created_at, updatedAt: a.updated_at,
    publishedAt: a.published_at, closedAt: a.closed_at, pushSentAt: a.push_sent_at, ...extra
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
        const need = { list: 'homework.view', get: 'homework.view', save: 'homework.create', publish: 'homework.publish', close: 'homework.publish', reopen: 'homework.publish', unpublish: 'homework.publish', delete: 'homework.delete' }[action];
        if (!need) return bad('Unknown action', 404);
        if (action !== 'list' && action !== 'get' && !isPost) return bad('POST only', 405);
        const auth = await requireStaff(request, env, need);
        if (auth.error) return auth.error;
        const staff = auth.staff;

        // ---------- list (per grade) ----------
        if (action === 'list') {
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
                        updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(c.grade, c.unit, c.lesson, c.title, c.instructions || null, c.deadline, c.closesAt, c.total, staff.name, a.id),
                    ...questionStmts(db, a.id, key.questions),
                    auditStmt(db, request, staff, 'homework.save', String(a.id), { title: c.title, grade: c.grade, questions: key.questions.length, status: a.status })
                ]);
                return json({ ok: true, id: a.id, sum: key.sum });
            }
            const r = await db.prepare(`INSERT INTO hw_assignments (grade, unit, lesson, title, instructions, deadline, closes_at, total_score, status, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).bind(c.grade, c.unit, c.lesson, c.title, c.instructions || null, c.deadline, c.closesAt, c.total, staff.name, staff.name).run();
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
            if (subs && data.confirm !== 'DELETE') return bad(`${subs} student${subs === 1 ? '' : 's'} already submitted — confirm to delete their submissions too`, 409, { code: 'HAS_SUBMISSIONS', submissions: subs });
            await db.batch([
                auditStmt(db, request, staff, 'homework.delete', String(a.id), { assignment: rowOut(a), questions, submissions: subs }),
                db.prepare('DELETE FROM hw_answers WHERE submission_id IN (SELECT id FROM hw_submissions WHERE assignment_id = ?)').bind(a.id),
                db.prepare('DELETE FROM hw_submissions WHERE assignment_id = ?').bind(a.id),
                db.prepare('DELETE FROM hw_questions WHERE assignment_id = ?').bind(a.id),
                db.prepare('DELETE FROM hw_assignments WHERE id = ?').bind(a.id)
            ]);
            return json({ ok: true });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('homework error', err);
        return bad(err.message || 'Something went wrong', 500);
    }
}
