// =============================================================
// Ask Miss Marwa (أسئلتي)
// Students ask a question tagged with Unit + Lesson (text, a photo and/or a voice note).
// Miss Marwa and the assistants answer from the staff portal (oldest waiting first).
// Every question is also a Question-bank item for revision sheets.
//
// Storage: photos and voice notes are compressed in the browser (photo ≈ 100–250 KB,
// voice ≈ 15 KB per 10 s) and kept in D1 (table ask_media) — nothing to set up in Cloudflare.
// =============================================================
import { requireStaff, requireStudent, ensureAppSchema, auditStmt } from './admin-auth.js';

function getDb(env) { return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function'); }
const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
export const ASK_UNITS = 6, ASK_LESSONS = 6;
const MAX_TEXT = 2000;
const MAX_MEDIA_BYTES = 700 * 1024;          // after compression in the browser
const MAX_QUESTIONS_PER_DAY = 15;
const MAX_MESSAGES_PER_DAY = 60;
const MIME_OK = {
    image: ['image/jpeg', 'image/webp', 'image/png'],
    audio: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav']
};
export const AUTO_REPLY = 'تم استلام سؤالك بنجاح! هيتم الرد عليك في أسرع وقت من خلال مس مروة والتيم 🌷';
const json = (data, status = 200) => Response.json(data, { status });
const bad = (error, status = 400, extra = {}) => Response.json({ error, ...extra }, { status });

// ---- media ----
function decodeMedia(m) {
    if (!m) return null;
    const kind = m.kind === 'audio' ? 'audio' : m.kind === 'image' ? 'image' : null;
    const mime = String(m.mime || '').toLowerCase().split(';')[0].trim();
    if (!kind || !MIME_OK[kind].includes(mime)) return { error: 'نوع الملف مش مدعوم' };
    const data = String(m.data || '').replace(/^data:[^,]+,/, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) return { error: 'الملف بايظ' };
    const size = Math.floor(data.length * 3 / 4);
    if (size < 50) return { error: 'الملف فاضي' };
    if (size > MAX_MEDIA_BYTES) return { error: 'الملف كبير — صوّر تاني أو سجّل رسالة أقصر' };
    const seconds = kind === 'audio' ? Math.max(0, Math.min(600, Number(m.seconds) || 0)) : null;
    return { kind, mime, data, size, seconds };
}
// A message can carry a photo and/or a voice note (+ text).
// Accepts { image, audio } or the older single { media }.
function decodeAttachments(data) {
    const out = { image: null, audio: null };
    const list = [];
    if (data.image) list.push(['image', data.image]);
    if (data.audio) list.push(['audio', data.audio]);
    if (data.media) list.push([data.media.kind === 'audio' ? 'audio' : 'image', data.media]);
    for (const [slot, raw] of list) {
        const m = decodeMedia({ ...raw, kind: raw.kind || slot });
        if (m && m.error) return { error: m.error };
        if (m.kind !== slot) return { error: 'نوع الملف مش مدعوم' };
        if (out[slot]) return { error: 'صورة واحدة ورسالة صوتية واحدة بس في كل رسالة' };
        out[slot] = m;
    }
    return out;
}
// Saves the files and returns the columns for ask_messages
// (photo → media_id; voice → media_id when alone, audio_id when it comes with a photo).
async function saveAttachments(db, studentId, att) {
    const img = att.image ? await saveMedia(db, studentId, att.image) : null;
    const aud = att.audio ? await saveMedia(db, studentId, att.audio) : null;
    if (img) return { media_id: img, media_kind: 'image', media_seconds: null, audio_id: aud, audio_seconds: aud ? att.audio.seconds : null };
    if (aud) return { media_id: aud, media_kind: 'audio', media_seconds: att.audio.seconds, audio_id: null, audio_seconds: null };
    return { media_id: null, media_kind: null, media_seconds: null, audio_id: null, audio_seconds: null };
}
// ---- Storage housekeeping ----
// Photos / voice notes are the only heavy part. Removing one keeps the message (text, who, when)
// and leaves a "removed" marker: media_kind stays, media_id becomes NULL (audio_seconds stays for a voice note).
export const MEDIA_KEEP_DAYS = 30;
async function dropMedia(db, mediaWhere, binds = []) {
    // pick the files first (the WHERE may look at ask_messages, which the first UPDATE changes)
    const { results } = await db.prepare(`SELECT id, size FROM ask_media WHERE ${mediaWhere}`).bind(...binds).all();
    const rows = results || [];
    for (let i = 0; i < rows.length; i += 90) {
        const ids = rows.slice(i, i + 90).map(r => r.id), ph = ids.map(() => '?').join(',');
        await db.batch([
            db.prepare(`UPDATE ask_messages SET media_id = NULL WHERE media_id IN (${ph})`).bind(...ids),
            db.prepare(`UPDATE ask_messages SET audio_id = NULL WHERE audio_id IN (${ph})`).bind(...ids),
            db.prepare(`DELETE FROM ask_media WHERE id IN (${ph})`).bind(...ids)
        ]);
    }
    return { files: rows.length, bytes: rows.reduce((t, r) => t + (r.size || 0), 0) };
}
// Runs at most once a day (lazily, when the inbox is opened or a question is sent).
export async function purgeOldMedia(db, { force = false } = {}) {
    await db.prepare(`INSERT OR IGNORE INTO app_kv ("key", value) VALUES ('ask_media_purge', '2000-01-01 00:00:00')`).run();
    if (!force) {
        const claim = await db.prepare(`UPDATE app_kv SET value = datetime('now'), updated_at = CURRENT_TIMESTAMP
            WHERE "key" = 'ask_media_purge' AND value <= datetime('now', '-1 day')`).run();
        if (!claim.meta || !claim.meta.changes) return null;      // already ran in the last 24 h
    } else await db.prepare(`UPDATE app_kv SET value = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE "key" = 'ask_media_purge'`).run();
    const cutoff = (await db.prepare(`SELECT datetime('now', ?) as c`).bind(`-${MEDIA_KEEP_DAYS} days`).first()).c;
    const r = await dropMedia(db, 'created_at < ?', [cutoff]);
    await db.prepare(`INSERT INTO app_kv ("key", value) VALUES ('ask_media_purge_last', ?)
        ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(JSON.stringify({ ...r, at: new Date().toISOString() })).run();
    return r;
}
function lazyPurge(context, db) {
    const p = purgeOldMedia(db).catch(() => null);      // housekeeping must never break the request
    if (context.waitUntil) context.waitUntil(p);
    return p;
}

const hasAtt = (att) => !!(att.image || att.audio);
const insertMsg = (db, qid, sender, staffName, text, c) => db.prepare(
    'INSERT INTO ask_messages (question_id, sender, staff_name, text, media_id, media_kind, media_seconds, audio_id, audio_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
).bind(qid, sender, staffName || null, text || null, c.media_id, c.media_kind, c.media_seconds, c.audio_id, c.audio_seconds);
async function saveMedia(db, studentId, media) {
    const r = await db.prepare('INSERT INTO ask_media (student_id, mime, size, data) VALUES (?, ?, ?, ?)')
        .bind(studentId, media.mime, media.size, media.data).run();
    return Number(r.meta && r.meta.last_row_id);
}
const cleanText = (t) => String(t || '').replace(/\r/g, '').trim().slice(0, MAX_TEXT);

// ---- push notification to one student (OneSignal tag "sid", set by the student portal) ----
async function pushToStudent(env, origin, studentId, title, message) {
    const appId = env.ONESIGNAL_APP_ID, apiKey = env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey) return;
    try {
        await fetch('https://api.onesignal.com/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Key ${apiKey}` },
            body: JSON.stringify({
                app_id: appId, target_channel: 'push',
                headings: { en: title, ar: title }, contents: { en: message, ar: message },
                filters: [{ field: 'tag', key: 'sid', relation: '=', value: studentId }],
                url: origin + '/questions.html'
            })
        });
    } catch (e) { /* notifications are optional */ }
}

const msgOut = (m) => {
    const image = m.media_kind === 'image' && m.media_id ? m.media_id : null;
    const audio = m.media_kind === 'audio' && m.media_id ? { id: m.media_id, seconds: m.media_seconds || null }
        : m.audio_id ? { id: m.audio_id, seconds: m.audio_seconds || null } : null;
    return {
        id: m.id, sender: m.sender, staffName: m.staff_name || null, text: m.text || '',
        image, audio,
        removed: [
            ...(m.media_kind && !m.media_id ? [m.media_kind] : []),
            ...(m.media_kind === 'image' && m.audio_seconds != null && !m.audio_id ? ['audio'] : [])
        ],
        mediaId: m.media_id || null, mediaKind: m.media_kind || null, seconds: m.media_seconds || null, // older clients
        at: m.created_at
    };
};
async function messagesOf(db, qid) {
    const { results } = await db.prepare('SELECT * FROM ask_messages WHERE question_id = ? ORDER BY id').bind(qid).all();
    return (results || []).map(msgOut);
}
function intIn(v, max) { const n = parseInt(v, 10); return n >= 1 && n <= max ? n : null; }

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

        // ================= Photos & voice notes (owner student or staff) =================
        if (action === 'media') {
            const id = parseInt(url.searchParams.get('id'), 10);
            const row = id ? await db.prepare('SELECT student_id, mime, data FROM ask_media WHERE id = ?').bind(id).first() : null;
            if (!row) return new Response('Not found', { status: 404 });
            const staff = await requireStaff(request, env, 'inbox.reply');
            if (staff.error) {
                const who = await requireStudent(request, env, db, null);
                if (who.error || who.id !== row.student_id) return new Response('Forbidden', { status: 403 });
            }
            const bin = Uint8Array.from(atob(row.data), c => c.charCodeAt(0));
            return new Response(bin, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=604800, immutable', 'Content-Length': String(bin.length) } });
        }

        // ================= Staff =================
        const STAFF_ACTIONS = ['counts', 'inbox', 'staff-thread', 'staff-reply', 'resolve', 'bank', 'bank-edit', 'bank-clear', 'engagement', 'storage'];
        if (STAFF_ACTIONS.includes(action)) {
            const auth = await requireStaff(request, env, 'inbox.reply');
            if (auth.error) return auth.error;
            const staff = auth.staff;

            // Waiting questions per grade (menu badge)
            if (action === 'counts') {
                const { results } = await db.prepare("SELECT grade, COUNT(*) as c FROM ask_questions WHERE status = 'waiting' GROUP BY grade").all();
                const waiting = Object.fromEntries(GRADES.map(g => [g, ((results || []).find(c => c.grade === g) || {}).c || 0]));
                return json({ waiting, total: Object.values(waiting).reduce((a, b) => a + b, 0) });
            }

            // Queue: per grade, oldest waiting first (FIFO)
            if (action === 'inbox') {
                await lazyPurge(context, db);
                const grade = GRADES.includes(url.searchParams.get('grade')) ? url.searchParams.get('grade') : 'prep1';
                const status = ['waiting', 'answered', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'waiting';
                const where = status === 'waiting' ? "q.status = 'waiting'" : status === 'answered' ? "q.status IN ('answered','resolved')" : '1=1';
                const order = status === 'waiting' ? 'q.waiting_since ASC, q.id ASC'
                    : status === 'answered' ? 'q.updated_at DESC, q.id DESC'
                        : "CASE WHEN q.status = 'waiting' THEN 0 ELSE 1 END, CASE WHEN q.status = 'waiting' THEN q.waiting_since END ASC, q.updated_at DESC";
                const { results } = await db.prepare(
                    `SELECT q.*, s.first_name, s.last_name, s.gender, s.branch,
                        (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'student' ORDER BY m.id LIMIT 1) as first_text,
                        (SELECT media_kind FROM ask_messages m WHERE m.question_id = q.id AND m.sender != 'auto' ORDER BY m.id DESC LIMIT 1) as last_kind,
                        (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender != 'auto' ORDER BY m.id DESC LIMIT 1) as last_text,
                        (SELECT sender FROM ask_messages m WHERE m.question_id = q.id AND m.sender != 'auto' ORDER BY m.id DESC LIMIT 1) as last_sender
                     FROM ask_questions q LEFT JOIN students s ON s.student_id = q.student_id
                     WHERE q.grade = ? AND ${where} ORDER BY ${order} LIMIT 300`
                ).bind(grade).all();
                const { results: counts } = await db.prepare("SELECT grade, COUNT(*) as c FROM ask_questions WHERE status = 'waiting' GROUP BY grade").all();
                return json({
                    grade, status,
                    waiting: Object.fromEntries(GRADES.map(g => [g, ((counts || []).find(c => c.grade === g) || {}).c || 0])),
                    items: (results || []).map(q => ({
                        id: q.id, studentId: q.student_id, firstName: q.first_name || '?', lastName: q.last_name || '', gender: q.gender, branch: q.branch,
                        unit: q.unit, lesson: q.lesson, status: q.status, waitingSince: q.waiting_since, createdAt: q.created_at, updatedAt: q.updated_at, bankHidden: !!q.bank_hidden,
                        unread: q.staff_unread, preview: q.last_text || q.first_text || '', lastKind: q.last_kind, lastSender: q.last_sender
                    }))
                });
            }

            if (action === 'staff-thread') {
                const id = parseInt(url.searchParams.get('id'), 10);
                const q = id ? await db.prepare(
                    `SELECT q.*, s.first_name, s.last_name, s.gender, s.branch, s.parent_phone FROM ask_questions q LEFT JOIN students s ON s.student_id = q.student_id WHERE q.id = ?`
                ).bind(id).first() : null;
                if (!q) return bad('السؤال غير موجود', 404);
                if (q.staff_unread) await db.prepare('UPDATE ask_questions SET staff_unread = 0 WHERE id = ?').bind(id).run();
                const asked = await db.prepare('SELECT COUNT(*) as c FROM ask_questions WHERE student_id = ?').bind(q.student_id).first();
                return json({
                    question: { id: q.id, unit: q.unit, lesson: q.lesson, status: q.status, waitingSince: q.waiting_since, createdAt: q.created_at, resolvedBy: q.resolved_by, grade: q.grade, bankHidden: !!q.bank_hidden },
                    student: { studentId: q.student_id, firstName: q.first_name || '?', lastName: q.last_name || '', gender: q.gender, branch: q.branch, grade: q.grade, questionsAsked: (asked && asked.c) || 0 },
                    messages: await messagesOf(db, id)
                });
            }

            if (action === 'staff-reply') {
                if (!isPost) return bad('POST only', 405);
                const id = parseInt(data.id, 10);
                const q = id ? await db.prepare('SELECT id, student_id FROM ask_questions WHERE id = ?').bind(id).first() : null;
                if (!q) return bad('السؤال غير موجود', 404);
                const text = cleanText(data.text);
                const att = decodeAttachments(data);
                if (att.error) return bad(att.error);
                if (!text && !hasAtt(att)) return bad('اكتبي الرد أو سجّلي رسالة صوتية');
                const cols = await saveAttachments(db, q.student_id, att);
                await db.batch([
                    insertMsg(db, id, 'staff', staff.name, text, cols),
                    db.prepare("UPDATE ask_questions SET status = 'answered', waiting_since = NULL, student_unread = student_unread + 1, staff_unread = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id)
                ]);
                const push = pushToStudent(env, url.origin, q.student_id, 'Miss Marwa replied 💬', 'مس مروة ردّت على سؤالك — افتح التطبيق وشوف الرد');
                if (context.waitUntil) context.waitUntil(push); else await push;
                return json({ ok: true, messages: await messagesOf(db, id) });
            }

            if (action === 'resolve') {
                if (!isPost) return bad('POST only', 405);
                const id = parseInt(data.id, 10);
                const q = id ? await db.prepare('SELECT id, status FROM ask_questions WHERE id = ?').bind(id).first() : null;
                if (!q) return bad('السؤال غير موجود', 404);
                if (data.resolved === false) await db.prepare("UPDATE ask_questions SET status = 'waiting', waiting_since = COALESCE(waiting_since, CURRENT_TIMESTAMP), resolved_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
                else await db.prepare("UPDATE ask_questions SET status = 'resolved', waiting_since = NULL, resolved_by = ?, staff_unread = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(staff.name, id).run();
                return json({ ok: true });
            }

            // Question bank: every question of the chosen units / lessons (text + photos)
            if (action === 'bank') {
                const grade = GRADES.includes(url.searchParams.get('grade')) ? url.searchParams.get('grade') : 'prep1';
                const picks = String(url.searchParams.get('picks') || '').split(',').map(p => p.split('-').map(Number))
                    .filter(([u, l]) => u >= 1 && u <= ASK_UNITS && (l === 0 || (l >= 1 && l <= ASK_LESSONS)));   // "2-0" = all of unit 2
                if (!picks.length) return json({ items: [] });
                const cond = picks.map(([u, l]) => (l ? '(q.unit = ? AND q.lesson = ?)' : '(q.unit = ?)')).join(' OR ');
                const binds = picks.flatMap(([u, l]) => (l ? [u, l] : [u]));
                const { results } = await db.prepare(
                    `SELECT q.id, q.unit, q.lesson, q.bank_text, q.bank_hidden, q.exported_at, q.created_at, q.student_id, s.first_name, s.last_name
                     FROM ask_questions q LEFT JOIN students s ON s.student_id = q.student_id
                     WHERE q.grade = ? AND (${cond}) ORDER BY q.unit, q.lesson, q.id`
                ).bind(grade, ...binds).all();
                const ids = (results || []).map(r => r.id);
                const firstText = {}, images = {};
                for (let i = 0; i < ids.length; i += 90) {
                    const part = ids.slice(i, i + 90);
                    const { results: ms } = await db.prepare(
                        `SELECT question_id, text, media_id, media_kind FROM ask_messages WHERE sender = 'student' AND question_id IN (${part.map(() => '?').join(',')}) ORDER BY id`
                    ).bind(...part).all();
                    (ms || []).forEach(m => {
                        if (m.text && !firstText[m.question_id]) firstText[m.question_id] = m.text;
                        if (m.media_kind === 'image' && m.media_id) (images[m.question_id] ||= []).push(m.media_id);
                    });
                }
                return json({
                    items: (results || []).map(r => ({
                        id: r.id, unit: r.unit, lesson: r.lesson, hidden: !!r.bank_hidden, exportedAt: r.exported_at || null, createdAt: r.created_at,
                        original: firstText[r.id] || '', text: r.bank_text != null ? r.bank_text : (firstText[r.id] || ''), edited: r.bank_text != null,
                        images: images[r.id] || [], student: `${r.first_name || ''} ${r.last_name || ''}`.trim()
                    }))
                });
            }
            if (action === 'bank-edit') {
                if (!isPost) return bad('POST only', 405);
                const id = parseInt(data.id, 10);
                if (!id) return bad('بيانات ناقصة');
                if (data.text !== undefined) await db.prepare('UPDATE ask_questions SET bank_text = ? WHERE id = ?').bind(data.text === null ? null : cleanText(data.text), id).run();
                if (data.hidden !== undefined) await db.prepare('UPDATE ask_questions SET bank_hidden = ? WHERE id = ?').bind(data.hidden ? 1 : 0, id).run();
                if (data.exported === false) await db.prepare('UPDATE ask_questions SET exported_at = NULL WHERE id = ?').bind(id).run();
                return json({ ok: true });
            }

            // After a PDF export: take those questions out of the bank and (optionally) drop their photos / voice notes.
            // The chat text stays for the student and the team.
            if (action === 'bank-clear') {
                if (!isPost) return bad('POST only', 405);
                const ids = [...new Set((Array.isArray(data.ids) ? data.ids : []).map(n => parseInt(n, 10)).filter(n => n > 0))].slice(0, 500);
                if (!ids.length) return bad('مفيش أسئلة');
                const mode = data.mode === 'bank' ? 'bank' : 'media';
                let freed = { files: 0, bytes: 0 };
                for (let i = 0; i < ids.length; i += 45) {            // D1: max 100 bound values per query (ids are bound twice below)
                    const part = ids.slice(i, i + 45), ph = part.map(() => '?').join(',');
                    if (mode === 'media') {
                        const f = await dropMedia(db, `id IN (SELECT media_id FROM ask_messages WHERE question_id IN (${ph}) AND media_id IS NOT NULL
                            UNION SELECT audio_id FROM ask_messages WHERE question_id IN (${ph}) AND audio_id IS NOT NULL)`, [...part, ...part]);
                        freed = { files: freed.files + f.files, bytes: freed.bytes + f.bytes };
                    }
                    await db.prepare(`UPDATE ask_questions SET exported_at = CURRENT_TIMESTAMP WHERE id IN (${ph})`).bind(...part).run();
                }
                await auditStmt(db, request, staff, 'ask.bank-clear', null, { mode, questions: ids.length, ...freed }).run();
                return json({ ok: true, mode, cleared: ids.length, ...freed });
            }

            // How many questions each student asked (engagement)
            if (action === 'engagement') {
                const sid = url.searchParams.get('studentId');
                if (sid) {
                    const r = await db.prepare(`SELECT COUNT(*) as c, MAX(created_at) as last,
                        SUM(CASE WHEN created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) as recent FROM ask_questions WHERE student_id = ?`).bind(sid).first();
                    return json({ count: (r && r.c) || 0, last: r && r.last, recent30: (r && r.recent) || 0 });
                }
                const grade = GRADES.includes(url.searchParams.get('grade')) ? url.searchParams.get('grade') : 'prep1';
                const { results } = await db.prepare('SELECT student_id, COUNT(*) as c FROM ask_questions WHERE grade = ? GROUP BY student_id').bind(grade).all();
                return json({ counts: Object.fromEntries((results || []).map(r => [r.student_id, r.c])) });
            }

            // How much room the photos / voice notes take
            if (action === 'storage') {
                const r = await db.prepare('SELECT COUNT(*) as files, COALESCE(SUM(size), 0) as bytes FROM ask_media').first();
                const last = await db.prepare(`SELECT value FROM app_kv WHERE "key" = 'ask_media_purge_last'`).first().catch(() => null);
                let lastRun = null; try { lastRun = last ? JSON.parse(last.value) : null; } catch (e) { }
                return json({ files: r.files, bytes: r.bytes, keepDays: MEDIA_KEEP_DAYS, lastCleanup: lastRun });
            }
        }

        // ================= Students =================
        const who = await requireStudent(request, env, db, data.studentId || url.searchParams.get('studentId'));
        if (who.error) return who.error;
        const sid = who.id;

        if (action === 'unread') {
            const r = await db.prepare('SELECT COALESCE(SUM(student_unread), 0) as c FROM ask_questions WHERE student_id = ?').bind(sid).first();
            return json({ unread: (r && r.c) || 0 });
        }

        if (action === 'mine') {
            const { results } = await db.prepare(
                `SELECT q.*, (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'student' ORDER BY m.id LIMIT 1) as first_text,
                    (SELECT media_kind FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'student' ORDER BY m.id LIMIT 1) as first_kind,
                    (SELECT COUNT(*) FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'staff') as replies
                 FROM ask_questions q WHERE q.student_id = ? ORDER BY q.unit, q.lesson, q.id DESC`
            ).bind(sid).all();
            return json({
                units: ASK_UNITS, lessons: ASK_LESSONS,
                items: (results || []).map(q => ({ id: q.id, unit: q.unit, lesson: q.lesson, status: q.status, unread: q.student_unread, replies: q.replies, text: q.first_text || '', kind: q.first_kind, createdAt: q.created_at, updatedAt: q.updated_at }))
            });
        }

        if (action === 'thread') {
            const id = parseInt(url.searchParams.get('id'), 10);
            const q = id ? await db.prepare('SELECT * FROM ask_questions WHERE id = ? AND student_id = ?').bind(id, sid).first() : null;
            if (!q) return bad('السؤال غير موجود', 404);
            if (q.student_unread) await db.prepare('UPDATE ask_questions SET student_unread = 0 WHERE id = ?').bind(id).run();
            return json({ question: { id: q.id, unit: q.unit, lesson: q.lesson, status: q.status, createdAt: q.created_at }, messages: await messagesOf(db, id) });
        }

        if (action === 'ask' || action === 'reply') {
            if (!isPost) return bad('POST only', 405);
            const text = cleanText(data.text);
            const att = decodeAttachments(data);
            if (att.error) return bad(att.error);
            if (!text && !hasAtt(att)) return bad('اكتب سؤالك أو ابعت صورة أو رسالة صوتية');
            const today = await db.prepare(
                `SELECT (SELECT COUNT(*) FROM ask_questions WHERE student_id = ? AND created_at >= datetime('now','-1 day')) as q,
                        (SELECT COUNT(*) FROM ask_messages m JOIN ask_questions q ON q.id = m.question_id WHERE q.student_id = ? AND m.sender = 'student' AND m.created_at >= datetime('now','-1 day')) as m`
            ).bind(sid, sid).first();
            if (today && today.m >= MAX_MESSAGES_PER_DAY) return bad('وصلت لأقصى عدد رسائل النهارده — كمّل بكرة', 429, { code: 'DAILY_LIMIT' });

            if (action === 'ask') {
                const unit = intIn(data.unit, ASK_UNITS), lesson = intIn(data.lesson, ASK_LESSONS);
                if (!unit || !lesson) return bad('اختار الوحدة والدرس الأول');
                if (today && today.q >= MAX_QUESTIONS_PER_DAY) return bad(`أقصى عدد ${MAX_QUESTIONS_PER_DAY} سؤال في اليوم — كمّل بكرة`, 429, { code: 'DAILY_LIMIT' });
                const r = await db.prepare('INSERT INTO ask_questions (student_id, grade, unit, lesson) VALUES (?, ?, ?, ?)').bind(sid, who.grade, unit, lesson).run();
                const qid = Number(r.meta && r.meta.last_row_id);
                const cols = await saveAttachments(db, sid, att);
                await db.batch([
                    insertMsg(db, qid, 'student', null, text, cols),
                    db.prepare('INSERT INTO ask_messages (question_id, sender, text) VALUES (?, ?, ?)').bind(qid, 'auto', AUTO_REPLY)
                ]);
                lazyPurge(context, db);
                return json({ ok: true, id: qid, messages: await messagesOf(db, qid) });
            }

            // follow-up in the same question
            const id = parseInt(data.id, 10);
            const q = id ? await db.prepare('SELECT id, status FROM ask_questions WHERE id = ? AND student_id = ?').bind(id, sid).first() : null;
            if (!q) return bad('السؤال غير موجود', 404);
            const cols = await saveAttachments(db, sid, att);
            await db.batch([
                insertMsg(db, id, 'student', null, text, cols),
                db.prepare(`UPDATE ask_questions SET status = 'waiting', waiting_since = CASE WHEN status = 'waiting' AND waiting_since IS NOT NULL THEN waiting_since ELSE CURRENT_TIMESTAMP END,
                    staff_unread = staff_unread + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id)
            ]);
            return json({ ok: true, messages: await messagesOf(db, id) });
        }

        return bad('Invalid action');
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر', detail: String(err && err.message || err) }, { status: 500 });
    }
}
