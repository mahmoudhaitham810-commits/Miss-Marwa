// =============================================================
// Ask Miss Marwa (أسئلتي)
// Students ask a question tagged with Unit + Lesson — or "سؤال خارج المنهج" (unit 0, lesson 0) — with text, a photo and/or a voice note.
// Miss Marwa can also START a chat (18 Nov 2026): one student (her direct chat, origin 'staff'), or a broadcast to a
// whole grade / a group (each student gets their own copy, origin 'broadcast' — like a WhatsApp broadcast list;
// replies come back to her one by one). Pushes go both ways (push.js).
// Miss Marwa and the assistants answer from the staff portal (oldest waiting first).
// Every question is also a Question-bank item for revision sheets.
//
// Storage: photos and voice notes are compressed in the browser (photo ≈ 100–250 KB,
// voice ≈ 15 KB per 10 s) and stored through media-store.js: Cloudflare R2 (binding MEDIA) when connected,
// otherwise D1. Older files (table ask_media) are moved into R2 in the background.
// =============================================================
import { requireStaff, requireStudent, ensureAppSchema, auditStmt, normalizeEgyptPhone } from './admin-auth.js';
import { putMedia, mediaInfo, mediaResponse, deleteMedia, migrateToR2, mediaStats, registerLegacy } from './media-store.js';
import { pushTo, students as pushStudents, staffList, parents as pushParents, inboxStaffIds, background, pushConfigured, CLIENT_APP_ID, studentAlias, staffAlias } from './push.js';
import { parentFromRequest } from './parent-session.js';
import { closingSweep } from './parent-notify.js';

function getDb(env) { return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function'); }
const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
const GRADE_EN = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
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
async function saveAttachments(env, db, studentId, att) {
    const img = att.image ? await saveMedia(env, db, studentId, att.image) : null;
    const aud = att.audio ? await saveMedia(env, db, studentId, att.audio) : null;
    if (img) return { media_id: img, media_kind: 'image', media_seconds: null, audio_id: aud, audio_seconds: aud ? att.audio.seconds : null };
    if (aud) return { media_id: aud, media_kind: 'audio', media_seconds: att.audio.seconds, audio_id: null, audio_seconds: null };
    return { media_id: null, media_kind: null, media_seconds: null, audio_id: null, audio_seconds: null };
}
// ---- Storage housekeeping ----
// Photos / voice notes are the only heavy part. Removing one keeps the message (text, who, when)
// and leaves a "removed" marker: media_kind stays, media_id becomes NULL (audio_seconds stays for a voice note).
export const MEDIA_KEEP_DAYS = 30;
// mediaWhere filters media_objects (Questions files only). Files go through the storage module (R2 / D1).
async function dropMedia(env, db, mediaWhere, binds = []) {
    await registerLegacy(db);
    // pick the files first (the WHERE may look at ask_messages, which the first UPDATE changes)
    const { results } = await db.prepare(`SELECT id FROM media_objects WHERE kind = 'ask' AND (${mediaWhere})`).bind(...binds).all();
    const ids = (results || []).map(r => r.id);
    for (let i = 0; i < ids.length; i += 90) {
        const part = ids.slice(i, i + 90), ph = part.map(() => '?').join(',');
        await db.batch([
            db.prepare(`UPDATE ask_messages SET media_id = NULL WHERE media_id IN (${ph})`).bind(...part),
            db.prepare(`UPDATE ask_messages SET audio_id = NULL WHERE audio_id IN (${ph})`).bind(...part)
        ]);
    }
    return deleteMedia(env, db, ids);
}
// Runs at most once a day (lazily, when the inbox is opened or a question is sent).
export async function purgeOldMedia(env, db, { force = false } = {}) {
    await db.prepare(`INSERT OR IGNORE INTO app_kv ("key", value) VALUES ('ask_media_purge', '2000-01-01 00:00:00')`).run();
    if (!force) {
        const claim = await db.prepare(`UPDATE app_kv SET value = datetime('now'), updated_at = CURRENT_TIMESTAMP
            WHERE "key" = 'ask_media_purge' AND value <= datetime('now', '-1 day')`).run();
        if (!claim.meta || !claim.meta.changes) return null;      // already ran in the last 24 h
    } else await db.prepare(`UPDATE app_kv SET value = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE "key" = 'ask_media_purge'`).run();
    const cutoff = (await db.prepare(`SELECT datetime('now', ?) as c`).bind(`-${MEDIA_KEEP_DAYS} days`).first()).c;
    const r = await dropMedia(env, db, 'created_at < ?', [cutoff]);
    await db.prepare(`INSERT INTO app_kv ("key", value) VALUES ('ask_media_purge_last', ?)
        ON CONFLICT("key") DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).bind(JSON.stringify({ ...r, at: new Date().toISOString() })).run();
    return r;
}
function lazyPurge(context, db) {
    // housekeeping must never break the request: daily 30-day clean-up + moving old files from D1 into R2
    const p = (async () => {
        await purgeOldMedia(context.env, db).catch(() => null);
        await migrateToR2(context.env, db, 8).catch(() => null);
    })();
    if (context.waitUntil) context.waitUntil(p);
    return p;
}

const hasAtt = (att) => !!(att.image || att.audio);
const insertMsg = (db, qid, sender, staffName, text, c) => db.prepare(
    'INSERT INTO ask_messages (question_id, sender, staff_name, text, media_id, media_kind, media_seconds, audio_id, audio_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
).bind(qid, sender, staffName || null, text || null, c.media_id, c.media_kind, c.media_seconds, c.audio_id, c.audio_seconds);
async function saveMedia(env, db, studentId, media) {
    return (await putMedia(env, db, { kind: 'ask', studentId, mime: media.mime, data: media.data })).id;
}
const cleanText = (t) => String(t || '').replace(/\r/g, '').trim().slice(0, MAX_TEXT);

// ---- push notifications (push.js): to one student / to every staff member who answers questions ----
const pushStudent = (env, db, origin, studentId, title, message, q) => pushTo(env, db, pushStudents([studentId]), { title, message, url: origin + '/questions.html' + (q ? '?q=' + q : '') });
async function pushStaff(env, db, origin, title, message, q) {
    return pushTo(env, db, staffList(await inboxStaffIds(db)), { title, message, url: origin + '/admin/inbox.html' + (q ? '?q=' + q : '') });
}
// a message from Miss Marwa to a student's parent → the parent's devices
async function pushParentOf(env, db, origin, studentId, text, q) {
    const st = await db.prepare('SELECT first_name, parent_phone FROM students WHERE student_id = ?').bind(studentId).first();
    const phone = st && normalizeEgyptPhone(st.parent_phone);
    if (!phone) return null;
    return pushTo(env, db, pushParents([phone]), { title: 'Miss Marwa 💬', message: text ? `مس مروة: ${text.slice(0, 120)}` : `مس مروة بعتتلك رسالة بخصوص ${st.first_name || 'ابنك'}`, url: origin + '/parent.html#messages' });
}
export { decodeAttachments, saveAttachments, insertMsg, messagesOf, cleanText, hasAtt, pushStaff, lazyPurge };
const topicLabel = (q) => (q.audience === 'parent' ? 'Parent chat · ولي الأمر' : q.unit ? `Unit ${q.unit} · Lesson ${q.lesson}` : q.origin === 'staff' || q.origin === 'broadcast' ? 'Message from Miss Marwa' : 'General question · سؤال خارج المنهج');

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
            const row = id ? await mediaInfo(db, id) : null;
            if (!row || row.kind !== 'ask') return new Response('Not found', { status: 404 });
            const staff = await requireStaff(request, env, 'inbox.reply');
            const parent = staff.error ? await parentFromRequest(request, env, db) : null;
            if (parent) {      // a parent: only files in the parent chats of THEIR children
                const kids = parent.children.map(c => c.studentId);
                const ok = kids.length && await db.prepare(`SELECT 1 as ok FROM ask_messages m JOIN ask_questions q ON q.id = m.question_id
                    WHERE (m.media_id = ? OR m.audio_id = ?) AND q.audience = 'parent' AND q.student_id IN (${kids.map(() => '?').join(',')}) LIMIT 1`).bind(id, id, ...kids).first();
                if (!ok) return new Response('Forbidden', { status: 403 });
            } else if (staff.error) {
                const who = await requireStudent(request, env, db, null);
                if (who.error) return new Response('Forbidden', { status: 403 });
                if (who.id !== row.student_id) {       // a file Miss Marwa sent to many students (broadcast) is stored once
                    const mine = await db.prepare(`SELECT 1 as ok FROM ask_messages m JOIN ask_questions q ON q.id = m.question_id
                        WHERE (m.media_id = ? OR m.audio_id = ?) AND q.student_id = ? AND q.audience IS NULL LIMIT 1`).bind(id, id, who.id).first();
                    if (!mine) return new Response('Forbidden', { status: 403 });
                }
            }
            const res = await mediaResponse(env, db, row);
            return res || new Response('Not found', { status: 404 });
        }

        // ================= Staff =================
        const STAFF_ACTIONS = ['counts', 'inbox', 'staff-thread', 'staff-reply', 'resolve', 'bank', 'bank-edit', 'bank-clear', 'engagement', 'storage', 'compose-targets', 'staff-send', 'broadcasts', 'broadcast', 'staff-push-test'];
        if (STAFF_ACTIONS.includes(action)) {
            const auth = await requireStaff(request, env, 'inbox.reply');
            if (auth.error) return auth.error;
            const staff = auth.staff;

            // Waiting questions per grade (menu badge)
            if (action === 'counts') {
                closingSweep(context, env, db, url.origin);   // staff portal polls this → keeps the "closes soon" reminders going
                const { results } = await db.prepare("SELECT grade, COUNT(*) as c FROM ask_questions WHERE status = 'waiting' GROUP BY grade").all();
                const waiting = Object.fromEntries(GRADES.map(g => [g, ((results || []).find(c => c.grade === g) || {}).c || 0]));
                const last = await db.prepare(`SELECT m.id, m.question_id as q, m.text, m.media_kind as kind, m.sender, s.first_name as f, s.last_name as l, q.grade
                    FROM ask_messages m JOIN ask_questions q ON q.id = m.question_id LEFT JOIN students s ON s.student_id = q.student_id
                    WHERE m.sender IN ('student', 'parent') ORDER BY m.id DESC LIMIT 1`).first();
                const unread = await db.prepare('SELECT COALESCE(SUM(staff_unread), 0) as c FROM ask_questions').first();
                return json({ waiting, total: Object.values(waiting).reduce((a, b) => a + b, 0), unread: (unread && unread.c) || 0,
                    latest: last ? { id: last.id, questionId: last.q, name: (last.sender === 'parent' ? 'ولي أمر ' : '') + `${last.f || ''} ${last.l || ''}`.trim(), parent: last.sender === 'parent', grade: last.grade, text: String(last.text || (last.kind === 'image' ? '📷 Photo' : last.kind === 'audio' ? '🎤 Voice note' : '')).slice(0, 90) } : null });
            }

            // Queue: per grade, oldest waiting first (FIFO)
            if (action === 'inbox') {
                await lazyPurge(context, db);
                const grade = GRADES.includes(url.searchParams.get('grade')) ? url.searchParams.get('grade') : 'prep1';
                const status = ['waiting', 'answered', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'waiting';
                const where = status === 'waiting' ? "q.status = 'waiting'" : status === 'answered' ? "q.status IN ('answered','resolved')" : '1=1';
                const audience = url.searchParams.get('audience') === 'parent' ? 'parent' : 'student';      // Students | Parents
                const AUD = audience === 'parent' ? "q.audience = 'parent'" : 'q.audience IS NULL';
                const order = status === 'waiting' ? 'q.waiting_since ASC, q.id ASC'
                    : status === 'answered' ? 'q.updated_at DESC, q.id DESC'
                        : "CASE WHEN q.status = 'waiting' THEN 0 ELSE 1 END, CASE WHEN q.status = 'waiting' THEN q.waiting_since END ASC, q.updated_at DESC";
                const { results } = await db.prepare(
                    `SELECT q.*, s.first_name, s.last_name, s.gender, s.branch,
                        (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender IN ('student', 'parent') ORDER BY m.id LIMIT 1) as first_text,
                        (SELECT media_kind FROM ask_messages m WHERE m.question_id = q.id AND m.sender != 'auto' ORDER BY m.id DESC LIMIT 1) as last_kind,
                        (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender != 'auto' ORDER BY m.id DESC LIMIT 1) as last_text,
                        (SELECT sender FROM ask_messages m WHERE m.question_id = q.id AND m.sender != 'auto' ORDER BY m.id DESC LIMIT 1) as last_sender
                     FROM ask_questions q LEFT JOIN students s ON s.student_id = q.student_id
                     WHERE q.grade = ? AND ${where} AND ${AUD}
                       AND (q.origin IS NULL OR q.origin <> 'broadcast' OR EXISTS (SELECT 1 FROM ask_messages x WHERE x.question_id = q.id AND x.sender IN ('student', 'parent')))
                     ORDER BY ${order} LIMIT 300`
                ).bind(grade).all();
                const { results: counts } = await db.prepare(`SELECT grade, COUNT(*) as c FROM ask_questions q WHERE status = 'waiting' AND ${AUD} GROUP BY grade`).all();
                const pw = await db.prepare("SELECT COUNT(*) as c FROM ask_questions WHERE status = 'waiting' AND audience = 'parent'").first();
                const sw = await db.prepare("SELECT COUNT(*) as c FROM ask_questions WHERE status = 'waiting' AND audience IS NULL").first();
                return json({
                    grade, status, audience, waitingBy: { students: (sw && sw.c) || 0, parents: (pw && pw.c) || 0 },
                    waiting: Object.fromEntries(GRADES.map(g => [g, ((counts || []).find(c => c.grade === g) || {}).c || 0])),
                    items: (results || []).map(q => ({
                        id: q.id, studentId: q.student_id, firstName: q.first_name || '?', lastName: q.last_name || '', gender: q.gender, branch: q.branch,
                        unit: q.unit, lesson: q.lesson, status: q.status, waitingSince: q.waiting_since, createdAt: q.created_at, updatedAt: q.updated_at, bankHidden: !!q.bank_hidden,
                        unread: q.staff_unread, preview: q.last_text || q.first_text || '', lastKind: q.last_kind, lastSender: q.last_sender, origin: q.origin || 'student', audience: q.audience || 'student'
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
                    question: { id: q.id, unit: q.unit, lesson: q.lesson, status: q.status, waitingSince: q.waiting_since, createdAt: q.created_at, resolvedBy: q.resolved_by, grade: q.grade, bankHidden: !!q.bank_hidden, origin: q.origin || 'student', broadcastId: q.broadcast_id || null, label: topicLabel(q), audience: q.audience || 'student' },
                    student: { studentId: q.student_id, firstName: q.first_name || '?', lastName: q.last_name || '', gender: q.gender, branch: q.branch, grade: q.grade, questionsAsked: (asked && asked.c) || 0, parentPhone: q.audience === 'parent' ? (q.parent_phone || null) : undefined },
                    messages: await messagesOf(db, id)
                });
            }

            if (action === 'staff-reply') {
                if (!isPost) return bad('POST only', 405);
                const id = parseInt(data.id, 10);
                const q = id ? await db.prepare('SELECT id, student_id, audience FROM ask_questions WHERE id = ?').bind(id).first() : null;
                if (!q) return bad('السؤال غير موجود', 404);
                const text = cleanText(data.text);
                const att = decodeAttachments(data);
                if (att.error) return bad(att.error);
                if (!text && !hasAtt(att)) return bad('اكتبي الرد أو سجّلي رسالة صوتية');
                const cols = await saveAttachments(env, db, q.student_id, att);
                await db.batch([
                    insertMsg(db, id, 'staff', staff.name, text, cols),
                    db.prepare("UPDATE ask_questions SET status = 'answered', waiting_since = NULL, student_unread = student_unread + 1, staff_unread = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id)
                ]);
                if (q.audience === 'parent') await background(context, pushParentOf(env, db, url.origin, q.student_id, text, id));
                else await background(context, pushStudent(env, db, url.origin, q.student_id, 'Miss Marwa 💬', text ? `مس مروة: ${text.slice(0, 120)}` : 'مس مروة بعتتلك رسالة — افتح التطبيق وشوفها', id));
                return json({ ok: true, messages: await messagesOf(db, id) });
            }

            // ---------- Miss Marwa starts a chat: who can she send to? ----------
            if (action === 'compose-targets') {
                const { results: st } = await db.prepare(`SELECT student_id as id, first_name as f, last_name as l, grade, branch, group_id as g, parent_phone as pp FROM students ORDER BY first_name, last_name`).all();
                const { results: gr } = await db.prepare(`SELECT id, grade, branch, name FROM student_groups WHERE active = 1 ORDER BY grade, name`).all().catch(() => ({ results: [] }));
                const counts = {}; (st || []).forEach(x => { const k = `${x.grade}|${x.branch || ''}`; counts[k] = (counts[k] || 0) + 1; const g = `g|${x.g}`; if (x.g) counts[g] = (counts[g] || 0) + 1; });
                return json({ students: (st || []).map(x => ({ id: x.id, name: `${x.f || ''} ${x.l || ''}`.trim(), grade: String(x.grade || '').toLowerCase(), branch: x.branch || null, hasParent: !!normalizeEgyptPhone(x.pp) })),
                    groups: (gr || []).map(g => ({ id: g.id, grade: g.grade, branch: g.branch, name: g.name, students: counts[`g|${g.id}`] || 0 })), counts });
            }
            // ---------- Miss Marwa sends: one student / a whole grade (+ Center / Private) / a group ----------
            if (action === 'staff-send') {
                if (!isPost) return bad('POST only', 405);
                const text = cleanText(data.text);
                const att = decodeAttachments(data);
                if (att.error) return bad(att.error);
                if (!text && !hasAtt(att)) return bad('اكتبي الرسالة أو ابعتي صورة / رسالة صوتية');
                const t = data.target || {};
                const toParents = data.audience === 'parent';      // the students' PARENTS (Parent Portal)
                const AUDV = toParents ? 'parent' : null;
                if (t.kind === 'student') {
                    const st = await db.prepare('SELECT student_id, grade, first_name FROM students WHERE student_id = ?').bind(String(t.studentId || '')).first();
                    if (!st) return bad('الطالب غير موجود', 404);
                    // her direct chat with this student (one continuing chat, like WhatsApp)
                    let q = toParents
                        ? await db.prepare(`SELECT id FROM ask_questions WHERE student_id = ? AND audience = 'parent' AND origin IN ('staff', 'parent') ORDER BY id DESC LIMIT 1`).bind(st.student_id).first()
                        : await db.prepare(`SELECT id FROM ask_questions WHERE student_id = ? AND origin = 'staff' AND audience IS NULL ORDER BY id DESC LIMIT 1`).bind(st.student_id).first();
                    let qid = q && q.id;
                    if (!qid) {
                        const r = await db.prepare(`INSERT INTO ask_questions (student_id, grade, unit, lesson, status, waiting_since, student_unread, staff_unread, origin, audience) VALUES (?, ?, 0, 0, 'answered', NULL, 0, 0, 'staff', ?)`).bind(st.student_id, String(st.grade || '').toLowerCase(), AUDV).run();
                        qid = Number(r.meta.last_row_id);
                    }
                    const cols = await saveAttachments(env, db, toParents ? 'parent-files' : st.student_id, att);
                    await db.batch([
                        insertMsg(db, qid, 'staff', staff.name, text, cols),
                        db.prepare("UPDATE ask_questions SET status = 'answered', waiting_since = NULL, student_unread = student_unread + 1, staff_unread = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(qid)
                    ]);
                    if (toParents) await background(context, pushParentOf(env, db, url.origin, st.student_id, text, qid));
                    else await background(context, pushStudent(env, db, url.origin, st.student_id, 'Miss Marwa 💬', text ? `مس مروة: ${text.slice(0, 120)}` : 'مس مروة بعتتلك رسالة — افتح التطبيق وشوفها', qid));
                    return json({ ok: true, kind: 'student', id: qid, recipients: 1, audience: toParents ? 'parent' : 'student' });
                }
                // a broadcast: one copy per student (their own chat), the files stored once
                let where = '', binds = [], label = '', grade = null, branch = null, groupId = null;
                if (t.kind === 'grade' && GRADES.includes(t.grade)) {
                    grade = t.grade; where = 'LOWER(grade) = ?'; binds = [grade];
                    if (['center', 'private'].includes(t.branch)) { branch = t.branch; where += ' AND branch = ?'; binds.push(branch); }
                    label = `${grade}${branch ? ' · ' + branch : ''}`;
                } else if (t.kind === 'group' && t.groupId) {
                    const g = await db.prepare('SELECT id, grade, branch, name FROM student_groups WHERE id = ?').bind(String(t.groupId)).first().catch(() => null);
                    if (!g) return bad('المجموعة غير موجودة', 404);
                    groupId = g.id; grade = g.grade; branch = g.branch; where = 'group_id = ?'; binds = [g.id]; label = g.name;
                } else return bad('اختاري طالب أو صف أو مجموعة');
                const { results: rec } = await db.prepare(`SELECT student_id FROM students WHERE ${where}`).bind(...binds).all();
                const ids = (rec || []).map(r => r.student_id);
                if (!ids.length) return bad('مفيش طلبة في الاختيار ده');
                const img = att.image ? await saveMedia(env, db, 'broadcast', att.image) : null;
                const aud = att.audio ? await saveMedia(env, db, 'broadcast', att.audio) : null;
                const cols = img ? { media_id: img, media_kind: 'image', media_seconds: null, audio_id: aud, audio_seconds: aud ? att.audio.seconds : null }
                    : aud ? { media_id: aud, media_kind: 'audio', media_seconds: att.audio.seconds, audio_id: null, audio_seconds: null }
                        : { media_id: null, media_kind: null, media_seconds: null, audio_id: null, audio_seconds: null };
                const b = await db.prepare(`INSERT INTO ask_broadcasts (grade, branch, group_id, label, staff_name, text, media_id, media_kind, media_seconds, audio_id, audio_seconds, recipients, audience)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(grade, branch, groupId, label, staff.name, text || null, cols.media_id, cols.media_kind, cols.media_seconds, cols.audio_id, cols.audio_seconds, ids.length, AUDV).run();
                const bid = Number(b.meta.last_row_id);
                await db.batch([
                    db.prepare(`INSERT INTO ask_questions (student_id, grade, unit, lesson, status, waiting_since, student_unread, staff_unread, origin, broadcast_id, audience)
                        SELECT student_id, LOWER(grade), 0, 0, 'answered', NULL, 1, 0, 'broadcast', ?, ? FROM students WHERE ${where}`).bind(bid, AUDV, ...binds),
                    db.prepare(`INSERT INTO ask_messages (question_id, sender, staff_name, text, media_id, media_kind, media_seconds, audio_id, audio_seconds)
                        SELECT id, 'staff', ?, ?, ?, ?, ?, ?, ? FROM ask_questions WHERE broadcast_id = ?`).bind(staff.name, text || null, cols.media_id, cols.media_kind, cols.media_seconds, cols.audio_id, cols.audio_seconds, bid)
                ]);
                await auditStmt(db, request, staff, 'ask.broadcast', String(bid), { label, recipients: ids.length, audience: AUDV || 'students' }).run();
                if (toParents) {
                    const { results: pp } = await db.prepare(`SELECT DISTINCT parent_phone FROM students WHERE ${where}`).bind(...binds).all();
                    const phones = [...new Set((pp || []).map(r => normalizeEgyptPhone(r.parent_phone)).filter(Boolean))];
                    await background(context, pushTo(env, db, pushParents(phones), { title: 'Miss Marwa 📣', message: text ? `مس مروة: ${text.slice(0, 120)}` : 'مس مروة بعتت رسالة جديدة لأولياء الأمور', url: url.origin + '/parent.html#messages' }));
                } else await background(context, pushTo(env, db, pushStudents(ids), { title: 'Miss Marwa 📣', message: text ? `مس مروة: ${text.slice(0, 120)}` : 'مس مروة بعتت رسالة جديدة — افتح التطبيق وشوفها', url: url.origin + '/questions.html' }));
                return json({ ok: true, kind: 'broadcast', broadcastId: bid, recipients: ids.length, audience: AUDV || 'student' });
            }
            // Her broadcasts: who saw it, who replied
            if (action === 'broadcasts') {
                const { results } = await db.prepare(`SELECT b.*,
                        (SELECT COUNT(*) FROM ask_questions q WHERE q.broadcast_id = b.id AND q.student_unread = 0) as seen,
                        (SELECT COUNT(DISTINCT q.id) FROM ask_questions q JOIN ask_messages m ON m.question_id = q.id AND m.sender IN ('student', 'parent') WHERE q.broadcast_id = b.id) as replied
                    FROM ask_broadcasts b ORDER BY b.id DESC LIMIT 50`).all();
                return json({ items: (results || []).map(b => ({ id: b.id, grade: b.grade, branch: b.branch, groupId: b.group_id, label: b.label, staffName: b.staff_name, text: b.text || '', kind: b.media_kind || null, hasAudio: !!(b.audio_id || b.media_kind === 'audio'), recipients: b.recipients, seen: b.seen, replied: b.replied, at: b.created_at, audience: b.audience || 'student' })) });
            }
            if (action === 'broadcast') {
                const bid = parseInt(url.searchParams.get('id'), 10);
                const { results } = await db.prepare(`SELECT q.id, q.student_id, q.student_unread, s.first_name as f, s.last_name as l,
                        (SELECT COUNT(*) FROM ask_messages m WHERE m.question_id = q.id AND m.sender IN ('student', 'parent')) as replies
                    FROM ask_questions q LEFT JOIN students s ON s.student_id = q.student_id WHERE q.broadcast_id = ? ORDER BY replies DESC, s.first_name`).bind(bid || 0).all();
                return json({ items: (results || []).map(r => ({ questionId: r.id, studentId: r.student_id, name: `${r.f || ''} ${r.l || ''}`.trim(), seen: !r.student_unread, replies: r.replies })) });
            }
            // "Send me a test notification" (her own devices) — shows exactly what OneSignal answered
            if (action === 'staff-push-test') {
                if (!isPost) return bad('POST only', 405);
                const r = await pushTo(env, db, staffList([staff.id]), { title: 'Science Academy 🔔', message: 'تجربة: الإشعارات شغالة على الجهاز ده ✅', url: url.origin + '/admin/inbox.html' });
                return json({ ...r, configured: pushConfigured(env), appIdMatches: env.ONESIGNAL_APP_ID ? String(env.ONESIGNAL_APP_ID).trim() === CLIENT_APP_ID : null, alias: staffAlias(staff.id) });
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
                        const f = await dropMedia(env, db, `id IN (SELECT media_id FROM ask_messages WHERE question_id IN (${ph}) AND media_id IS NOT NULL
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
                        SUM(CASE WHEN created_at >= datetime('now','-30 days') THEN 1 ELSE 0 END) as recent FROM ask_questions WHERE student_id = ? AND audience IS NULL AND origin IS NULL`).bind(sid).first();
                    return json({ count: (r && r.c) || 0, last: r && r.last, recent30: (r && r.recent) || 0 });
                }
                const grade = GRADES.includes(url.searchParams.get('grade')) ? url.searchParams.get('grade') : 'prep1';
                const { results } = await db.prepare('SELECT student_id, COUNT(*) as c FROM ask_questions WHERE grade = ? AND audience IS NULL AND origin IS NULL GROUP BY student_id').bind(grade).all();
                return json({ counts: Object.fromEntries((results || []).map(r => [r.student_id, r.c])) });
            }

            // How much room the photos / voice notes take
            if (action === 'storage') {
                const r = await mediaStats(env, db, 'ask');
                const last = await db.prepare(`SELECT value FROM app_kv WHERE "key" = 'ask_media_purge_last'`).first().catch(() => null);
                let lastRun = null; try { lastRun = last ? JSON.parse(last.value) : null; } catch (e) { }
                return json({ files: r.files, bytes: r.bytes, backend: r.backend, inR2: r.inR2, inD1: r.inD1, filesInD1: r.filesInD1, keepDays: MEDIA_KEEP_DAYS, lastCleanup: lastRun });
            }
        }

        // ================= Students =================
        const who = await requireStudent(request, env, db, data.studentId || url.searchParams.get('studentId'));
        if (who.error) return who.error;
        const sid = who.id;

        if (action === 'push-test') {
            if (!isPost) return bad('POST only', 405);
            const r = await pushTo(env, db, pushStudents([sid]), { title: 'Science Academy 🔔', message: 'تجربة: الإشعارات شغالة على الجهاز ده ✅', url: url.origin + '/questions.html' });
            return json({ ok: r.ok, sent: r.sent, viaTag: r.viaTag, reason: r.reason || null, configured: pushConfigured(env) });
        }
        if (action === 'unread') {
            const r = await db.prepare('SELECT COALESCE(SUM(student_unread), 0) as c FROM ask_questions WHERE student_id = ? AND audience IS NULL').bind(sid).first();
            return json({ unread: (r && r.c) || 0 });
        }

        if (action === 'mine') {
            const { results } = await db.prepare(
                `SELECT q.*, (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'student' ORDER BY m.id LIMIT 1) as first_text,
                    (SELECT media_kind FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'student' ORDER BY m.id LIMIT 1) as first_kind,
                    (SELECT COUNT(*) FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'staff') as replies,
                    (SELECT text FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'staff' ORDER BY m.id DESC LIMIT 1) as staff_text,
                    (SELECT media_kind FROM ask_messages m WHERE m.question_id = q.id AND m.sender = 'staff' ORDER BY m.id DESC LIMIT 1) as staff_kind
                 FROM ask_questions q WHERE q.student_id = ? AND q.audience IS NULL ORDER BY q.unit, q.lesson, q.updated_at DESC, q.id DESC`
            ).bind(sid).all();
            return json({
                units: ASK_UNITS, lessons: ASK_LESSONS,
                items: (results || []).map(q => ({ id: q.id, unit: q.unit, lesson: q.lesson, status: q.status, unread: q.student_unread, replies: q.replies, text: q.first_text || q.staff_text || '', kind: q.first_kind || q.staff_kind, createdAt: q.created_at, updatedAt: q.updated_at, origin: q.origin || 'student', label: topicLabel(q) }))
            });
        }

        if (action === 'thread') {
            const id = parseInt(url.searchParams.get('id'), 10);
            const q = id ? await db.prepare('SELECT * FROM ask_questions WHERE id = ? AND student_id = ? AND audience IS NULL').bind(id, sid).first() : null;
            if (!q) return bad('السؤال غير موجود', 404);
            if (q.student_unread) await db.prepare('UPDATE ask_questions SET student_unread = 0 WHERE id = ?').bind(id).run();
            return json({ question: { id: q.id, unit: q.unit, lesson: q.lesson, status: q.status, createdAt: q.created_at, origin: q.origin || 'student', label: topicLabel(q) }, messages: await messagesOf(db, id) });
        }

        if (action === 'ask' || action === 'reply') {
            if (!isPost) return bad('POST only', 405);
            const text = cleanText(data.text);
            const att = decodeAttachments(data);
            if (att.error) return bad(att.error);
            if (!text && !hasAtt(att)) return bad('اكتب سؤالك أو ابعت صورة أو رسالة صوتية');
            const today = await db.prepare(
                `SELECT (SELECT COUNT(*) FROM ask_questions WHERE student_id = ? AND audience IS NULL AND origin IS NULL AND created_at >= datetime('now','-1 day')) as q,
                        (SELECT COUNT(*) FROM ask_messages m JOIN ask_questions q ON q.id = m.question_id WHERE q.student_id = ? AND m.sender = 'student' AND m.created_at >= datetime('now','-1 day')) as m`
            ).bind(sid, sid).first();
            if (today && today.m >= MAX_MESSAGES_PER_DAY) return bad('وصلت لأقصى عدد رسائل النهارده — كمّل بكرة', 429, { code: 'DAILY_LIMIT' });

            if (action === 'ask') {
                // "سؤال خارج المنهج" (e.g. "هناخد إيه بكرة؟") → unit 0 · lesson 0, no unit / lesson needed
                const general = data.general === true;
                const unit = general ? 0 : intIn(data.unit, ASK_UNITS), lesson = general ? 0 : intIn(data.lesson, ASK_LESSONS);
                if (!general && (!unit || !lesson)) return bad('اختار الوحدة والدرس — أو "سؤال خارج المنهج"');
                if (today && today.q >= MAX_QUESTIONS_PER_DAY) return bad(`أقصى عدد ${MAX_QUESTIONS_PER_DAY} سؤال في اليوم — كمّل بكرة`, 429, { code: 'DAILY_LIMIT' });
                const cols = await saveAttachments(env, db, sid, att);      // files first: if saving fails, no empty question is left behind
                const r = await db.prepare('INSERT INTO ask_questions (student_id, grade, unit, lesson) VALUES (?, ?, ?, ?)').bind(sid, who.grade, unit, lesson).run();
                const qid = Number(r.meta && r.meta.last_row_id);
                await db.batch([
                    insertMsg(db, qid, 'student', null, text, cols),
                    db.prepare('INSERT INTO ask_messages (question_id, sender, text) VALUES (?, ?, ?)').bind(qid, 'auto', AUTO_REPLY)
                ]);
                lazyPurge(context, db);
                await background(context, pushStaff(env, db, url.origin, `سؤال جديد من ${who.firstName || ''} ${who.lastName || ''}`.trim() + ' 💬', `${GRADE_EN[who.grade] || who.grade} · ${general ? 'سؤال خارج المنهج' : `Unit ${unit} · Lesson ${lesson}`}${text ? ' — ' + text.slice(0, 100) : ''}`, qid));
                return json({ ok: true, id: qid, messages: await messagesOf(db, qid) });
            }

            // follow-up in the same question
            const id = parseInt(data.id, 10);
            const q = id ? await db.prepare('SELECT id, status FROM ask_questions WHERE id = ? AND student_id = ? AND audience IS NULL').bind(id, sid).first() : null;
            if (!q) return bad('السؤال غير موجود', 404);
            const cols = await saveAttachments(env, db, sid, att);
            await background(context, pushStaff(env, db, url.origin, `رسالة من ${who.firstName || ''} ${who.lastName || ''}`.trim() + ' 💬', `${GRADE_EN[who.grade] || who.grade}${text ? ' — ' + text.slice(0, 100) : att.image ? ' — 📷 صورة' : ' — 🎤 رسالة صوتية'}`, id));
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
