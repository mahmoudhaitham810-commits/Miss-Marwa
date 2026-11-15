// =============================================================
// Homework — student side (/api/hw-student)
//   list → get → start → page (one image per request) → submit → grade (one unit per call,
//   real progress) → result / receipt / WhatsApp summary.
// Students only ever see their own submission, and never the answer key before their
// result is released.
// =============================================================
import { requireStudent, ensureAppSchema } from './admin-auth.js';
import { putMedia, mediaInfo, mediaResponse, deleteMedia } from './media-store.js';
import { gradeStep, processQueue, resultOf, weaknessReport, releaseMode, purgeHomeworkMedia } from './hw-grader.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const bad = (error, status = 400, extra = {}) => json({ error, ...extra }, status);
const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const ms = (v) => (v ? new Date(String(v).replace(' ', 'T') + 'Z').getTime() : NaN);
const MAX_PAGES = 20, MAX_PAGE_BYTES = 1_500_000;
const IMG = ['image/jpeg', 'image/webp', 'image/png'];

function stateOf(a, now = Date.now()) {
    if (a.status === 'published' && a.closes_at && ms(a.closes_at) <= now) return 'closed';
    return a.status;
}
function receiptCode() {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.getRandomValues(new Uint8Array(6));
    return [...b].map(x => abc[x % abc.length]).join('');
}
const asgOut = (a) => ({ id: a.id, title: a.title, unit: a.unit, lesson: a.lesson, instructions: a.instructions || '', deadline: a.deadline, closesAt: a.closes_at, totalScore: a.total_score, state: stateOf(a) });
function subOut(s) {
    if (!s) return null;
    return { id: s.id, status: s.status, released: !!s.released_at, score: s.released_at ? s.final_score : null, late: !!s.late, pages: s.pages, unreadable: !!s.unreadable,
        reuploads: s.reuploads, receipt: s.status === 'uploading' ? null : s.receipt_code, submittedAt: s.submitted_at, gradedAt: s.graded_at, releasedAt: s.released_at };
}
// can the student (re)upload right now?
function canUpload(a, s, now = Date.now()) {
    const st = stateOf(a, now);
    if (st !== 'published') return { ok: false, why: 'This homework is closed' };
    if (!s || s.status === 'uploading') return { ok: true, late: ms(a.deadline) < now };
    if (s.unreadable && (s.reuploads || 0) < 1 && ms(a.deadline) > now && !s.released_at) return { ok: true, reupload: true, late: false };
    return { ok: false, why: 'Already submitted' };
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
        const who = await requireStudent(request, env, db, null);
        if (who.error) return who.error;
        const sid = who.id, grade = String(who.grade || '').toLowerCase();
        if (!['list', 'get', 'result', 'media'].includes(action) && !isPost) return bad('POST only', 405);

        const bg = () => { const p = (async () => { await processQueue(env, db, 2, url.origin).catch(() => null); await purgeHomeworkMedia(env, db).catch(() => null); })(); if (context.waitUntil) context.waitUntil(p); };

        if (action === 'list') {
            bg();
            const { results } = await db.prepare(`SELECT a.*, s.id AS s_id, s.status AS s_status, s.final_score AS s_score, s.released_at AS s_released, s.late AS s_late, s.unreadable AS s_unreadable, s.reuploads AS s_reuploads, s.submitted_at AS s_submitted
                FROM hw_assignments a LEFT JOIN hw_submissions s ON s.assignment_id = a.id AND s.student_id = ?
                WHERE LOWER(a.grade) = ? AND a.status != 'draft' ORDER BY a.deadline DESC LIMIT 100`).bind(sid, grade).all();
            const items = (results || []).map(r => {
                const st = stateOf(r), sub = r.s_id && r.s_status !== 'uploading';
                return { ...asgOut(r), submission: sub ? { id: r.s_id, status: r.s_status, released: !!r.s_released, score: r.s_released ? r.s_score : null, late: !!r.s_late, unreadable: !!r.s_unreadable, reuploads: r.s_reuploads, submittedAt: r.s_submitted } : null, due: st === 'published' && !sub };
            }).filter(x => x.state !== 'closed' || x.submission || ms(x.closesAt || x.deadline) > Date.now() - 30 * 864e5);
            return json({ items, mode: await releaseMode(db) });
        }

        const aid = parseInt(isPost ? data.id : url.searchParams.get('id'), 10) || null;
        const loadA = async (id) => {
            const a = id ? await db.prepare('SELECT * FROM hw_assignments WHERE id = ?').bind(id).first() : null;
            return a && a.status !== 'draft' && String(a.grade).toLowerCase() === grade ? a : null;
        };
        const loadS = (id) => db.prepare('SELECT * FROM hw_submissions WHERE assignment_id = ? AND student_id = ?').bind(id, sid).first();

        if (action === 'get') {
            const a = await loadA(aid); if (!a) return bad('Homework not found', 404);
            const s = await loadS(a.id);
            const { results: qs } = await db.prepare('SELECT label, type FROM hw_questions WHERE assignment_id = ? ORDER BY ord').bind(a.id).all();
            const up = canUpload(a, s);
            return json({ assignment: { ...asgOut(a), questions: (qs || []).length, labels: (qs || []).map(q => q.label) }, submission: subOut(s), canUpload: up.ok, uploadWhy: up.why || null, reupload: !!up.reupload, late: !!up.late,
                result: s && s.status !== 'uploading' ? await resultOf(db, s.id, { forStudent: true }) : null, mode: await releaseMode(db) });
        }

        if (action === 'media') {      // the student's own page
            const mid = parseInt(url.searchParams.get('media'), 10);
            const info = mid ? await mediaInfo(db, mid) : null;
            if (!info || info.kind !== 'hw' || info.student_id !== sid) return new Response('Not found', { status: 404 });
            return (await mediaResponse(env, db, info)) || new Response('Not found', { status: 404 });
        }

        if (action === 'start') {
            const a = await loadA(aid); if (!a) return bad('Homework not found', 404);
            let s = await loadS(a.id);
            const up = canUpload(a, s);
            if (!up.ok) return bad(up.why, 409);
            if (up.reupload) {        // flagged unreadable → one fresh upload before the deadline
                const { results: old } = await db.prepare('SELECT media_id FROM hw_pages WHERE submission_id = ?').bind(s.id).all();
                await db.batch([
                    db.prepare('DELETE FROM hw_pages WHERE submission_id = ?').bind(s.id),
                    db.prepare('DELETE FROM hw_answers WHERE submission_id = ?').bind(s.id),
                    db.prepare(`UPDATE hw_submissions SET status = 'uploading', reuploads = reuploads + 1, unreadable = 0, auto_score = NULL, final_score = NULL, pages = 0, report = NULL, ai_error = NULL, tries = 0, released_at = NULL, released_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(s.id)
                ]);
                await deleteMedia(env, db, (old || []).map(o => o.media_id).filter(Boolean));
            } else if (!s) {
                await db.prepare(`INSERT OR IGNORE INTO hw_submissions (assignment_id, student_id, status) VALUES (?, ?, 'uploading')`).bind(a.id, sid).run();
            } else {                  // still uploading (e.g. the page was refreshed) → start the pages again
                const { results: old } = await db.prepare('SELECT media_id FROM hw_pages WHERE submission_id = ?').bind(s.id).all();
                await db.prepare('DELETE FROM hw_pages WHERE submission_id = ?').bind(s.id).run();
                await deleteMedia(env, db, (old || []).map(o => o.media_id).filter(Boolean));
            }
            s = await loadS(a.id);
            return json({ submissionId: s.id, late: !!up.late, reupload: !!up.reupload });
        }

        // the rest work on the student's own submission
        const subId = parseInt(isPost ? data.submissionId : url.searchParams.get('submissionId'), 10);
        const s = subId ? await db.prepare('SELECT * FROM hw_submissions WHERE id = ? AND student_id = ?').bind(subId, sid).first() : null;
        if (!s) return bad('Submission not found', 404);
        const a = await loadA(s.assignment_id); if (!a) return bad('Homework not found', 404);

        if (action === 'page') {
            if (s.status !== 'uploading') return bad('Already submitted', 409);
            const pageNo = parseInt(data.pageNo, 10);
            if (!(pageNo >= 1 && pageNo <= MAX_PAGES)) return bad(`At most ${MAX_PAGES} pages`, 400);
            const m = data.image || {};
            const mime = String(m.mime || '').split(';')[0].toLowerCase();
            if (!IMG.includes(mime)) return bad('Pages must be photos (JPEG / PNG)', 400);
            const b64 = String(m.data || '');
            const bytes = Math.floor(b64.length * 3 / 4);
            if (!b64 || bytes > MAX_PAGE_BYTES) return bad('This page is too large — retake it a little further away', 413);
            const old = await db.prepare('SELECT id, media_id FROM hw_pages WHERE submission_id = ? AND page_no = ?').bind(s.id, pageNo).first();
            const saved = await putMedia(env, db, { kind: 'hw', studentId: sid, ownerId: s.id, mime, data: b64 });
            if (old) { await db.prepare('UPDATE hw_pages SET media_id = ?, status = ?, read_json = NULL WHERE id = ?').bind(saved.id, 'new', old.id).run(); if (old.media_id) await deleteMedia(env, db, [old.media_id]); }
            else await db.prepare('INSERT INTO hw_pages (submission_id, page_no, media_id) VALUES (?, ?, ?)').bind(s.id, pageNo, saved.id).run();
            return json({ ok: true, pageNo, mediaId: saved.id, size: saved.size });
        }

        if (action === 'submit') {
            if (s.status !== 'uploading') return bad('Already submitted', 409);
            const up = canUpload(a, s);
            if (!up.ok) return bad(up.why, 409);
            const n = await db.prepare('SELECT COUNT(*) AS n FROM hw_pages WHERE submission_id = ?').bind(s.id).first();
            if (!n || !n.n) return bad('Add at least one page', 400);
            const late = ms(a.deadline) < Date.now() ? 1 : 0;
            let code = s.receipt_code;
            for (let k = 0; !code && k < 5; k++) { const c = receiptCode(); const ex = await db.prepare('SELECT 1 FROM hw_submissions WHERE receipt_code = ?').bind(c).first(); if (!ex) code = c; }
            await db.prepare(`UPDATE hw_submissions SET status = 'grading', pages = ?, late = ?, receipt_code = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(n.n, late, code, s.id).run();
            return json({ ok: true, pages: n.n, late: !!late, receipt: code });
        }

        if (action === 'grade') {
            const r = await gradeStep(env, db, s.id);
            if (r.done) return json({ ...r, result: await resultOf(db, s.id, { forStudent: true }) });
            return json(r);
        }

        if (action === 'result') return json(await resultOf(db, s.id, { forStudent: true }));

        if (action === 'report') {
            if (!s.released_at) return bad('Your result is not ready yet', 409);
            const rep = await weaknessReport(env, db, s.id);
            return json({ text: rep.text, focus: rep.focus, summary: rep.summary });
        }
        return bad('Unknown action', 404);
    } catch (err) {
        console.error('hw-student error', err);
        return bad(err.message || 'Something went wrong', 500);
    }
}
