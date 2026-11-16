// =============================================================
// Homework — student side (/api/hw-student)
//   list → get → start → page (one image per request) → submit → grade (one unit per call,
//   real progress) → result / receipt / WhatsApp summary.
// Students only ever see their own submission, and never the answer key before their
// result is released.
// =============================================================
import { requireStudent, ensureAppSchema } from './admin-auth.js';
import { putMedia, mediaInfo, mediaResponse, deleteMedia } from './media-store.js';
import { gradeStep, markWritten, processQueue, resultOf, weaknessReport, releaseMode, purgeHomeworkMedia, loadKey, submitWeb, isWeb, ensureAssist, assistEta, assistChat, chatOf, CHAT_LIMIT } from './hw-grader.js';
import { AiQuotaError, AiUnavailableError } from './ai-engine.js';

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
// {label: {answer, correction}} — trimmed, size-limited
function cleanAnswers(v) {
    const out = {};
    if (!v || typeof v !== 'object') return out;
    for (const [k, x] of Object.entries(v).slice(0, 80)) {
        const label = String(k).trim().slice(0, 12); if (!label || !x || typeof x !== 'object') continue;
        const answer = String(x.answer ?? '').replace(/\r/g, '').slice(0, 3000), correction = String(x.correction ?? '').replace(/\r/g, '').slice(0, 300);
        if (answer.trim() || correction.trim()) out[label] = { answer, correction };
    }
    return out;
}
function receiptCode() {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const b = crypto.getRandomValues(new Uint8Array(6));
    return [...b].map(x => abc[x % abc.length]).join('');
}
const asgOut = (a) => ({ id: a.id, title: a.title, unit: a.unit, lesson: a.lesson, instructions: a.instructions || '', deadline: a.deadline, closesAt: a.closes_at, totalScore: a.total_score, state: stateOf(a),
    answerMode: isWeb(a) ? 'web' : 'photo', allowPhoto: !!a.allow_photo, durationMin: a.duration_min || null });
const GRACE_MS = 2 * 60 * 1000;
// the question sheet a student sees — never the answers
const paperOf = (key) => key.map(q => ({ label: q.label, type: q.type, prompt: q.prompt || '', points: q.points, options: q.type === 'mcq' ? (q.options || []) : [] }));
function subOut(s) {
    if (!s) return null;
    return { id: s.id, status: s.status, released: !!s.released_at, score: s.released_at ? s.final_score : null, late: !!s.late, pages: s.pages, unreadable: !!s.unreadable,
        reuploads: s.reuploads, receipt: s.status === 'uploading' ? null : s.receipt_code, submittedAt: s.submitted_at, gradedAt: s.graded_at, releasedAt: s.released_at,
        startedAt: s.started_at, endsAt: s.ends_at, assistStatus: s.assist_status || null, chatLeft: Math.max(0, CHAT_LIMIT - (s.chat_used || 0)) };
}
// can the student (re)upload right now?
function canUpload(a, s, now = Date.now()) {
    const st = stateOf(a, now);
    if (st !== 'published') return { ok: false, why: 'This homework is closed' };
    if (isWeb(a)) {
        if (s && s.status !== 'uploading') return { ok: false, why: 'Already submitted' };
        if (s && s.ends_at && ms(s.ends_at) + GRACE_MS < now) return { ok: false, why: 'Time is up' };
        return { ok: true, late: ms(a.deadline) < now };
    }
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
            const { results } = await db.prepare(`SELECT a.*, s.id AS s_id, s.status AS s_status, s.final_score AS s_score, s.released_at AS s_released, s.late AS s_late, s.unreadable AS s_unreadable, s.reuploads AS s_reuploads, s.submitted_at AS s_submitted, s.draft AS s_draft,
                (SELECT COUNT(*) FROM hw_questions q WHERE q.assignment_id = a.id) AS q_count
                FROM hw_assignments a LEFT JOIN hw_submissions s ON s.assignment_id = a.id AND s.student_id = ?
                WHERE LOWER(a.grade) = ? AND a.status != 'draft' ORDER BY a.deadline DESC LIMIT 100`).bind(sid, grade).all();
            const items = (results || []).map(r => {
                const st = stateOf(r), sub = r.s_id && r.s_status !== 'uploading';
                let progress = null;
                if (r.s_id && r.s_status === 'uploading' && isWeb(r)) { let d = {}; try { d = JSON.parse(r.s_draft || '{}'); } catch (e) { } progress = { answered: Object.keys(d).length, of: r.q_count }; }
                return { ...asgOut(r), progress, submission: sub ? { id: r.s_id, status: r.s_status, released: !!r.s_released, score: r.s_released ? r.s_score : null, late: !!r.s_late, unreadable: !!r.s_unreadable, reuploads: r.s_reuploads, submittedAt: r.s_submitted } : null, due: st === 'published' && !sub };
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
            const key = await loadKey(db, a.id);
            const up = canUpload(a, s);
            const web = isWeb(a), answering = web && up.ok;
            let draft = null, photos = [];
            if (web && s && s.status === 'uploading') {
                try { draft = s.draft ? JSON.parse(s.draft) : null; } catch (e) { draft = null; }
                const { results: ph } = await db.prepare('SELECT id, media_id, labels FROM hw_pages WHERE submission_id = ? ORDER BY page_no').bind(s.id).all();
                photos = (ph || []).map(p => ({ id: p.id, mediaId: p.media_id, labels: String(p.labels || '').split(',').filter(Boolean) }));
            }
            return json({ assignment: { ...asgOut(a), questions: key.length, labels: key.map(q => q.label), types: key.map(q => q.type) }, submission: subOut(s), canUpload: up.ok, uploadWhy: up.why || null, reupload: !!up.reupload, late: !!up.late,
                paper: answering ? paperOf(key) : undefined, draft, photos, now: new Date().toISOString(),
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
            if (isWeb(a)) {          // website answering: start the clock once, never wipe saved answers
                if (!s) {
                    const ends = a.duration_min ? Math.min(Date.now() + a.duration_min * 60000, a.closes_at ? ms(a.closes_at) : Infinity) : null;
                    await db.prepare(`INSERT OR IGNORE INTO hw_submissions (assignment_id, student_id, status, mode, started_at, ends_at) VALUES (?, ?, 'uploading', 'web', CURRENT_TIMESTAMP, ?)`)
                        .bind(a.id, sid, ends ? new Date(ends).toISOString().slice(0, 19).replace('T', ' ') : null).run();
                    s = await loadS(a.id);
                }
                return json({ submissionId: s.id, startedAt: s.started_at, endsAt: s.ends_at, late: !!up.late, now: new Date().toISOString() });
            }
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
            if (isWeb(a)) return bad('Use the answer sheet for this homework', 400);
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

        if (action === 'save') {                // website answers auto-save (draft)
            if (!isWeb(a)) return bad('Not available for this homework', 400);
            if (s.status !== 'uploading') return bad('Already submitted', 409);
            if (s.ends_at && ms(s.ends_at) + GRACE_MS < Date.now()) return bad('Time is up', 409, { code: 'TIME_UP' });
            const body = JSON.stringify(cleanAnswers(data.answers));
            if (body.length > 60000) return bad('Your answers are too long', 413);
            await db.prepare('UPDATE hw_submissions SET draft = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(body, s.id).run();
            return json({ ok: true, savedAt: new Date().toISOString() });
        }
        if (action === 'photo') {               // a notebook photo for written question(s) — only when staff allowed it
            if (!isWeb(a) || !a.allow_photo) return bad('Photos are not allowed for this homework', 400);
            if (s.status !== 'uploading') return bad('Already submitted', 409);
            const key = await loadKey(db, a.id);
            const allowed = new Set(key.filter(q => ['essay', 'short'].includes(q.type)).map(q => q.label));
            const labels = (Array.isArray(data.labels) ? data.labels : []).map(x => String(x).trim()).filter(x => allowed.has(x)).slice(0, 20);
            if (!labels.length) return bad('Choose the question this photo answers', 400);
            const n = await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(page_no), 0) AS mx FROM hw_pages WHERE submission_id = ?').bind(s.id).first();
            if (n.n >= 10) return bad('At most 10 photos', 400);
            const m = data.image || {};
            const mime = String(m.mime || '').split(';')[0].toLowerCase();
            if (!IMG.includes(mime)) return bad('Photos must be JPEG / PNG', 400);
            const b64 = String(m.data || '');
            if (!b64 || Math.floor(b64.length * 3 / 4) > MAX_PAGE_BYTES) return bad('This photo is too large — retake it a little further away', 413);
            const saved = await putMedia(env, db, { kind: 'hw', studentId: sid, ownerId: s.id, mime, data: b64 });
            const r = await db.prepare('INSERT INTO hw_pages (submission_id, page_no, media_id, labels) VALUES (?, ?, ?, ?)').bind(s.id, n.mx + 1, saved.id, labels.join(',')).run();
            return json({ ok: true, id: Number(r.meta.last_row_id), mediaId: saved.id, labels });
        }
        if (action === 'photo-del') {
            if (s.status !== 'uploading') return bad('Already submitted', 409);
            const p = await db.prepare('SELECT id, media_id FROM hw_pages WHERE id = ? AND submission_id = ?').bind(parseInt(data.photoId, 10) || 0, s.id).first();
            if (!p) return bad('Photo not found', 404);
            await db.prepare('DELETE FROM hw_pages WHERE id = ?').bind(p.id).run();
            if (p.media_id) await deleteMedia(env, db, [p.media_id]);
            return json({ ok: true });
        }
        if (action === 'submit' && isWeb(a)) {
            if (s.status !== 'uploading') return bad('Already submitted', 409);
            if (stateOf(a) !== 'published') return bad('This homework is closed', 409);
            const timeUp = s.ends_at && ms(s.ends_at) + GRACE_MS < Date.now();
            let answers = cleanAnswers(data.answers);
            if (timeUp) { try { answers = JSON.parse(s.draft || '{}'); } catch (e) { answers = {}; } }   // too late → what was saved in time counts
            const out = await submitWeb(env, db, s, a, answers, { auto: !!timeUp });
            if (out.deferred && context.waitUntil) context.waitUntil(markWritten(env, db, s.id).catch(() => null));   // written answers → AI check in the background, then staff
            return json({ ok: true, ...out, timeUp: !!timeUp, result: await resultOf(db, s.id, { forStudent: true }) });
        }
        if (action === 'assist') {             // AI Assistant walkthrough: starts it if needed; the page polls
            if (s.status === 'uploading') return bad('Submit your homework first', 409);
            const ready = async (assist) => {
                await db.prepare(`UPDATE hw_submissions SET assist_status = 'seen' WHERE id = ? AND assist_status = 'ready'`).bind(s.id).run();
                return json({ status: 'ready', assist, chat: await chatOf(db, s.id), chatLeft: Math.max(0, CHAT_LIMIT - (s.chat_used || 0)) });
            };
            if (['ready', 'seen', 'notified'].includes(s.assist_status) && s.assist) return ready(JSON.parse(s.assist));
            const job = ensureAssist(env, db, s.id).catch(() => ({ status: 'queued' }));
            if (context.waitUntil) context.waitUntil(job);       // keeps going if the student leaves the page
            // the page is open → wait a little for a quick answer, then let it poll
            const r = await Promise.race([job, new Promise(x => setTimeout(() => x({ status: 'working' }), data.wait ? 25000 : 1500))]);
            if (r.status === 'ready') return ready(r.assist);
            return json({ status: r.status === 'queued' ? 'queued' : 'working', eta: await assistEta(db) });
        }
        if (action === 'chat') {
            const q = String(data.text || '').replace(/\r/g, '').trim().slice(0, 500);
            if (q.length < 2) return bad('Type your question', 400);
            try {
                const r = await assistChat(env, db, s.id, q);
                if (r.error) return bad(r.error, r.status || 400, { code: r.code });
                return json(r);
            } catch (e) {
                if (e instanceof AiQuotaError) return bad('المساعد خلّص طاقته النهارده 😴 — جرّب تاني بعد الساعة 2 الصبح، أو اسأل مس مروة', 429, { code: 'AI_QUOTA' });
                if (e instanceof AiUnavailableError) return bad('The AI Assistant is not available right now', 503);
                return bad('مش قادر أرد دلوقتي — جرّب تاني كمان شوية 🙏', 502);
            }
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
