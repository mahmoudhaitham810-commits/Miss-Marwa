// Parent Portal (18 Nov 2026) + the older private parent report links (/parent-link.html).
//
// Portal (parent signs in with their phone + the child's phone; one device at a time — parent-session.js):
//   POST login {parentPhone, studentPhone} · GET me · POST switch {studentId} · POST logout
//   GET overview[&sid]   — everything about the child, read-only (scores, history, attendance, rank, alerts, trends)
//   GET messages · GET thread&id · POST send {sid, id?, text, image, audio}   — chat with Miss Marwa
//   POST push-test
//
// Private parent report links.
// Each student gets ONE secret link (sent to the parent once on WhatsApp). Opening it shows that
// student's marks, always up to date — so most weeks no WhatsApp message is needed at all.
// The link shows only what the WhatsApp reports already contain: name, grade, marks, absences.
import { requireStaff, ensureAppSchema, audit, clientIp, throttleState, recordFail } from './admin-auth.js';
import { loadGrade, boardValue, studentProfile } from './analytics.js';
import { parentCookieFor, CLEAR_PARENT_COOKIE, deviceLabel } from './admin-auth.js';
import { phoneKey, childrenOf, parentSession } from './parent-session.js';
import { decodeAttachments, saveAttachments, insertMsg, messagesOf, cleanText, hasAtt, pushStaff } from './ask.js';
import { pushTo, parents as pushParents, background, pushConfigured } from './push.js';
import { closingSweep } from './parent-notify.js';

function getDb(env) { return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function'); }
const IP_LOCK = { fails: 20, windowMs: 15 * 60 * 1000, lockMs: 30 * 60 * 1000 };
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

function newToken() {
    const b = crypto.getRandomValues(new Uint8Array(24)); // 192 bits — impossible to guess
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);
    if (!db) return Response.json({ error: 'Database not connected' }, { status: 500 });
    try {
        await ensureAppSchema(db);
        const data = await request.json().catch(() => ({}));

        const portal = await portalPost(context, db, action, data);
        if (portal) return portal;

        // ---- Public: a parent opens their link ----
        if (action === 'view') {
            const ipKey = 'parent-ip:' + clientIp(request);
            const st = await throttleState(db, ipKey);
            if (st.locked_until > Date.now()) return Response.json({ error: 'محاولات كتير — جرّب بعد شوية', code: 'LOCKED' }, { status: 429, headers: noStore });
            const token = String(data.token || '');
            const link = TOKEN_RE.test(token) ? await db.prepare('SELECT student_id FROM parent_links WHERE token = ?').bind(token).first() : null;
            if (!link) {
                await recordFail(db, ipKey, IP_LOCK);
                return Response.json({ error: 'الرابط ده مش شغال. اطلب رابط جديد من مس مروة.', code: 'BAD_LINK' }, { status: 404, headers: noStore });
            }
            const s0 = await db.prepare('SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, grade, branch FROM students WHERE student_id = ?').bind(link.student_id).first();
            if (!s0) return Response.json({ error: 'الرابط ده مش شغال. اطلب رابط جديد من مس مروة.', code: 'BAD_LINK' }, { status: 404, headers: noStore });
            const grade = String(s0.grade || '').toLowerCase();
            const g = await loadGrade(db, grade);
            const s = g.students.find(x => x.studentId === s0.studentId) || { ...s0 };
            const v = boardValue(s, g, 'combined', null);
            const row = (h) => ({ name: h.name, date: h.date, status: h.status, score: h.score, total: h.total, pct: r1(h.pct) });
            await db.prepare('UPDATE parent_links SET views = views + 1, last_view_at = CURRENT_TIMESTAMP WHERE token = ?').bind(token).run();
            return Response.json({
                student: { firstName: s0.firstName, lastName: s0.lastName, gender: s0.gender, grade, branch: s0.branch },
                summary: { centerPct: r1(v.center.pct), centerTaken: v.center.taken, centerAbsent: v.center.missed, onlinePct: r1(v.online.pct), onlineTaken: v.online.taken, onlineMissed: v.online.missed },
                center: v.center.history.filter(h => h.status !== 'not-entered').map(row).reverse(),
                online: v.online.history.map(row).reverse(),
                updatedAt: new Date().toISOString()
            }, { headers: noStore });
        }

        // ---- Staff: get (or make) a student's link ----
        if (action === 'link' || action === 'renew') {
            const auth = await requireStaff(request, env, 'reports.send');
            if (auth.error) return auth.error;
            const studentId = String(data.studentId || '');
            const st = await db.prepare('SELECT student_id FROM students WHERE student_id = ?').bind(studentId).first();
            if (!st) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            let link = await db.prepare('SELECT token, created_at as createdAt, created_by as createdBy, views, last_view_at as lastViewAt FROM parent_links WHERE student_id = ?').bind(studentId).first();
            if (action === 'renew' && link) {
                const token = newToken();
                await db.prepare('UPDATE parent_links SET token = ?, created_at = CURRENT_TIMESTAMP, created_by = ?, views = 0, last_view_at = NULL WHERE student_id = ?').bind(token, auth.staff.name, studentId).run();
                await audit(db, request, auth.staff, 'parent.link-renew', studentId, { reason: 'old link stopped' });
                link = null;
            }
            if (!link) {
                if (action !== 'renew') {
                    await db.prepare('INSERT OR IGNORE INTO parent_links (student_id, token, created_by) VALUES (?, ?, ?)').bind(studentId, newToken(), auth.staff.name).run();
                }
                link = await db.prepare('SELECT token, created_at as createdAt, created_by as createdBy, views, last_view_at as lastViewAt FROM parent_links WHERE student_id = ?').bind(studentId).first();
            }
            return Response.json({ ...link, url: `${url.origin}/parent-link.html#${link.token}` });
        }

        // ---- Staff: which students already have a link (and whether it's been opened) ----
        if (action === 'status') {
            const auth = await requireStaff(request, env, 'reports.send');
            if (auth.error) return auth.error;
            const ids = [...new Set((Array.isArray(data.studentIds) ? data.studentIds : []).map(String))].slice(0, 400);
            const out = {};
            for (let i = 0; i < ids.length; i += 90) {
                const part = ids.slice(i, i + 90);
                const { results } = await db.prepare(`SELECT student_id as studentId, views, last_view_at as lastViewAt FROM parent_links WHERE student_id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
                (results || []).forEach(r => { out[r.studentId] = { views: r.views, lastViewAt: r.lastViewAt }; });
            }
            return Response.json({ links: out });
        }
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر', detail: String(err && err.message || err) }, { status: 500 });
    }
}


// =====================================================================
// Parent Portal
// =====================================================================
const GRADE_LABEL = { prep1: 'Prep 1', prep2: 'Prep 2', prep3: 'Prep 3', sec1: 'Sec 1' };
const GRADE_AR = { prep1: 'أولى إعدادي', prep2: 'تانية إعدادي', prep3: 'تالتة إعدادي', sec1: 'أولى ثانوي' };
const LOGIN_LOCK = { fails: 8, windowMs: 15 * 60 * 1000, lockMs: 30 * 60 * 1000 };
const pj = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { ...noStore, ...headers } });
const newKey = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, ''); };
const mask = (p) => p ? p.slice(0, 3) + '•••••' + p.slice(-3) : '';
const childOut = (c) => ({ studentId: c.studentId, firstName: c.firstName, lastName: c.lastName, gender: c.gender, grade: c.grade, gradeLabel: GRADE_LABEL[c.grade] || c.grade, gradeAr: GRADE_AR[c.grade] || '', branch: c.branch });
const toMs = (v) => { if (!v) return 0; const s = String(v); const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return isNaN(t) ? 0 : t; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r0 = (v) => (v === null || v === undefined ? null : Math.round(v));

async function needParent(request, env, db) {
    const s = await parentSession(request, env, db);
    if (s.parent) return { parent: s.parent };
    const msg = s.reason === 'REPLACED' ? 'اتعمل تسجيل دخول من جهاز تاني — الحساب بيشتغل على جهاز واحد بس. سجّل دخول تاني لو ده جهازك.'
        : s.reason === 'NO_CHILDREN' ? 'مفيش طالب مسجّل برقمك دلوقتي — كلّم التيم على واتساب.' : 'سجّل دخول الأول';
    return { error: pj({ error: msg, code: s.reason || 'NONE' }, 401, s.reason === 'REPLACED' || s.reason === 'NO_CHILDREN' ? { 'Set-Cookie': CLEAR_PARENT_COOKIE } : {}) };
}
const pickChild = (parent, sid) => parent.children.find(c => c.studentId === (sid || parent.active)) || null;

async function portalPost(context, db, action, data) {
    const { request, env } = context;
    const url = new URL(request.url);
    if (action === 'login') {
        const ipKey = 'parent-login:' + clientIp(request);
        const st = await throttleState(db, ipKey);
        if (st.locked_until > Date.now()) return pj({ error: 'محاولات كتير — جرّب تاني بعد نص ساعة، أو كلّمنا على واتساب.', code: 'LOCKED' }, 429);
        const pp = phoneKey(data.parentPhone), sp = phoneKey(data.studentPhone);
        if (!pp || !sp) return pj({ error: 'اكتب الرقمين صح (رقم موبايل مصري 11 رقم يبدأ بـ 01).', code: 'BAD_PHONE' }, 400);
        if (pp === sp) return pj({ error: 'رقم ولي الأمر ورقم الطالب لازم يكونوا مختلفين.', code: 'SAME_PHONE' }, 400);
        const kids = await childrenOf(db, pp);
        const child = kids.find(c => c.phone === sp);
        if (!child) {
            await recordFail(db, ipKey, LOGIN_LOCK);
            return pj({ error: 'الرقمين مش متطابقين مع بيانات طالب مسجّل عندنا. اتأكد إن رقمك هو "رقم ولي الأمر" اللي الطالب سجّل بيه.', code: 'NO_MATCH' }, 401);
        }
        if (!(await parentCookieFor(env, pp, 'x'))) return pj({ error: 'Sign-in is not configured on the server yet.', code: 'NOT_CONFIGURED' }, 503);
        const key = newKey();
        await db.prepare(`INSERT INTO parents (phone, session_key, active_student, device, last_login_at, logins) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
            ON CONFLICT(phone) DO UPDATE SET session_key = excluded.session_key, active_student = excluded.active_student, device = excluded.device,
            last_login_at = CURRENT_TIMESTAMP, logins = parents.logins + 1`).bind(pp, key, child.studentId, deviceLabel(request)).run();
        return pj({ ok: true, phone: mask(pp), children: kids.map(childOut), active: child.studentId }, 200, { 'Set-Cookie': await parentCookieFor(env, pp, key) });
    }
    if (action === 'logout') {
        const s = await parentSession(request, env, db);
        if (s.parent) await db.prepare('UPDATE parents SET session_key = NULL WHERE phone = ?').bind(s.parent.phone).run();
        return pj({ ok: true }, 200, { 'Set-Cookie': CLEAR_PARENT_COOKIE });
    }
    if (!['switch', 'send', 'push-test'].includes(action)) return null;
    const P = await needParent(request, env, db);
    if (P.error) return P.error;
    const parent = P.parent;
    if (action === 'switch') {
        const c = pickChild(parent, String(data.studentId || ''));
        if (!c || c.studentId !== String(data.studentId || '')) return pj({ error: 'الطالب ده مش مسجّل برقمك' }, 403);
        await db.prepare('UPDATE parents SET active_student = ? WHERE phone = ?').bind(c.studentId, parent.phone).run();
        return pj({ ok: true, active: c.studentId });
    }
    if (action === 'push-test') {
        const r = await pushTo(env, db, pushParents([parent.phone]), { title: 'Science Academy 🔔', message: 'تجربة: الإشعارات شغالة على الموبايل ده ✅', url: url.origin + '/parent.html' });
        return pj({ ok: r.ok, sent: r.sent, viaTag: r.viaTag, reason: r.reason || null, configured: pushConfigured(env) });
    }
    if (action === 'send') {
        const text = cleanText(data.text);
        const att = decodeAttachments(data);
        if (att.error) return pj({ error: att.error }, 400);
        if (!text && !hasAtt(att)) return pj({ error: 'اكتب رسالتك أو ابعت صورة / رسالة صوتية' }, 400);
        let qid = parseInt(data.id, 10) || null, child = null;
        if (qid) {
            const q = await db.prepare(`SELECT id, student_id FROM ask_questions WHERE id = ? AND audience = 'parent'`).bind(qid).first();
            child = q && pickChild(parent, q.student_id);
            if (!q || !child || child.studentId !== q.student_id) return pj({ error: 'المحادثة غير موجودة' }, 404);
        } else {
            child = pickChild(parent, String(data.sid || ''));
            if (!child) return pj({ error: 'اختار الطالب' }, 400);
            const q = await db.prepare(`SELECT id FROM ask_questions WHERE student_id = ? AND audience = 'parent' AND origin IN ('staff', 'parent') ORDER BY id DESC LIMIT 1`).bind(child.studentId).first();
            qid = q && q.id;
            if (!qid) {
                const r = await db.prepare(`INSERT INTO ask_questions (student_id, grade, unit, lesson, status, waiting_since, student_unread, staff_unread, origin, audience) VALUES (?, ?, 0, 0, 'waiting', CURRENT_TIMESTAMP, 0, 0, 'parent', 'parent')`).bind(child.studentId, child.grade).run();
                qid = Number(r.meta.last_row_id);
            }
        }
        const cols = await saveAttachments(env, db, 'parent-files', att);
        await db.batch([
            insertMsg(db, qid, 'parent', null, text, cols),
            db.prepare("UPDATE ask_questions SET status = 'waiting', waiting_since = COALESCE(waiting_since, CURRENT_TIMESTAMP), staff_unread = staff_unread + 1, student_unread = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(qid)
        ]);
        await background(context, pushStaff(env, db, url.origin, `رسالة من ولي أمر ${child.firstName} ${child.lastName}`.trim() + ' 👪', `${GRADE_LABEL[child.grade] || child.grade}${text ? ' — ' + text.slice(0, 100) : att.image ? ' — 📷 صورة' : ' — 🎤 رسالة صوتية'}`, qid));
        return pj({ ok: true, id: qid, messages: await messagesOf(db, qid) });
    }
    return null;
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);
    if (!db) return pj({ error: 'Database not connected' }, 500);
    try {
        await ensureAppSchema(db);
        const P = await needParent(request, env, db);
        if (P.error) return P.error;
        const parent = P.parent;
        if (action === 'me') {
            const unread = await db.prepare(`SELECT COALESCE(SUM(student_unread), 0) as c FROM ask_questions WHERE audience = 'parent' AND student_id IN (${parent.children.map(() => '?').join(',')})`).bind(...parent.children.map(c => c.studentId)).first();
            return pj({ phone: mask(parent.phone), alias: 'parent-' + parent.phone, children: parent.children.map(childOut), active: parent.active, unread: (unread && unread.c) || 0, grades: [...new Set(parent.children.map(c => c.grade))] });
        }
        if (action === 'overview') {
            const child = pickChild(parent, url.searchParams.get('sid'));
            if (!child) return pj({ error: 'الطالب ده مش مسجّل برقمك' }, 403);
            closingSweep(context, env, db, url.origin);
            // last activity for the staff "Parents" page (written at most every 5 minutes)
            await db.prepare(`UPDATE parents SET last_seen_at = CURRENT_TIMESTAMP WHERE phone = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-5 minutes'))`).bind(parent.phone).run().catch(() => null);
            return pj(await overview(db, child));
        }
        if (action === 'messages') {
            const ids = parent.children.map(c => c.studentId);
            const { results } = await db.prepare(
                `SELECT q.id, q.student_id, q.origin, q.status, q.student_unread as unread, q.updated_at, q.created_at,
                    (SELECT text FROM ask_messages m WHERE m.question_id = q.id ORDER BY m.id DESC LIMIT 1) as last_text,
                    (SELECT media_kind FROM ask_messages m WHERE m.question_id = q.id ORDER BY m.id DESC LIMIT 1) as last_kind,
                    (SELECT sender FROM ask_messages m WHERE m.question_id = q.id ORDER BY m.id DESC LIMIT 1) as last_sender
                 FROM ask_questions q WHERE q.audience = 'parent' AND q.student_id IN (${ids.map(() => '?').join(',')})
                 ORDER BY q.updated_at DESC, q.id DESC LIMIT 100`).bind(...ids).all();
            return pj({ items: (results || []).map(q => ({ id: q.id, studentId: q.student_id, kind: q.origin === 'broadcast' ? 'announcement' : 'chat', unread: q.unread, at: q.updated_at || q.created_at,
                preview: q.last_text || (q.last_kind === 'image' ? '📷 صورة' : q.last_kind === 'audio' ? '🎤 رسالة صوتية' : ''), lastFromMe: q.last_sender === 'parent' })) });
        }
        if (action === 'thread') {
            const id = parseInt(url.searchParams.get('id'), 10);
            const q = id ? await db.prepare(`SELECT id, student_id, origin FROM ask_questions WHERE id = ? AND audience = 'parent'`).bind(id).first() : null;
            const child = q && pickChild(parent, q.student_id);
            if (!q || !child || child.studentId !== q.student_id) return pj({ error: 'المحادثة غير موجودة' }, 404);
            await db.prepare('UPDATE ask_questions SET student_unread = 0 WHERE id = ?').bind(id).run();
            return pj({ id, studentId: q.student_id, kind: q.origin === 'broadcast' ? 'announcement' : 'chat', messages: await messagesOf(db, id) });
        }
        return pj({ error: 'Invalid action' }, 400);
    } catch (err) {
        return pj({ error: 'حصل خطأ في السيرفر', detail: String(err && err.message || err) }, 500);
    }
}

// ---------- the child's full picture (read-only) ----------
async function overview(db, child) {
    const p = await studentProfile(db, child.studentId);
    const sm = p.summary, now = Date.now();
    const online = p.online.map(o => ({ id: o.id, name: o.name, expiresAt: o.expiresAt, date: o.date, status: o.status, score: o.score, total: o.total, pct: o.pct, submittedAt: o.submittedAt }));
    const center = p.center.filter(c => c.status !== 'not-entered').map(c => ({ name: c.name, date: c.date, status: c.status, score: c.score, total: c.total, pct: c.pct }));
    // alerts: an online exam still open and not submitted — closing within 24 h = urgent
    const open = online.filter(o => ['not-yet', 'in-progress'].includes(o.status) && toMs(o.expiresAt) > now)
        .map(o => ({ ...o, hoursLeft: Math.max(0, Math.round((toMs(o.expiresAt) - now) / 360000) / 10) })).sort((a, b) => a.hoursLeft - b.hoursLeft);
    const closingSoon = open.filter(o => o.hoursLeft <= 24);
    // every online exam still open for the grade (taken or not) → the first card on the dashboard, with a live countdown
    const activeExams = online.filter(o => toMs(o.expiresAt) > now).map(o => ({
        id: o.id, name: o.name, closesAt: toMs(o.expiresAt), status: o.status,
        score: o.status === 'taken' ? o.score : null, total: o.total, pct: o.status === 'taken' ? o.pct : null, submittedAt: o.status === 'taken' ? o.submittedAt : null
    })).sort((a, b) => ((a.status === 'taken') - (b.status === 'taken')) || (a.closesAt - b.closesAt));
    const missed = [
        ...center.filter(c => c.status === 'absent').map(c => ({ kind: 'center', name: c.name, date: c.date, why: 'absent' })),
        ...online.filter(o => ['missed', 'opened'].includes(o.status)).map(o => ({ kind: 'online', name: o.name, date: o.date, why: o.status }))
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    // trends (oldest → newest)
    const cTaken = center.filter(c => c.status === 'taken' && c.pct !== null).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const oTaken = online.filter(o => o.status === 'taken' && o.pct !== null).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const trend = { center: cTaken.map(c => ({ name: c.name, date: c.date, pct: c.pct })), online: oTaken.map(o => ({ name: o.name, date: o.date, pct: o.pct })) };
    // strengths / needs attention — written by code from the numbers (no AI, always exact)
    const f = child.gender === 'female', g = (m, w) => (f ? w : m), name = child.firstName;
    const strengths = [], watch = [];
    const all = [...cTaken.map(x => ({ ...x, k: 'سنتر' })), ...oTaken.map(x => ({ ...x, k: 'أونلاين' }))];
    const best = all.filter(x => x.pct >= 85).sort((a, b) => b.pct - a.pct).slice(0, 2);
    if (best.length) strengths.push(`أعلى درجات: ${best.map(b => `${b.name} (${r0(b.pct)}%)`).join(' · ')}`);
    const attTotal = sm.centerTaken + sm.centerAbsent;
    if (attTotal >= 3 && sm.centerAbsent === 0) strengths.push(`${g('حاضر', 'حاضرة')} كل امتحانات السنتر (${sm.centerTaken} من ${attTotal}) 👏`);
    if (sm.onlineTaken >= 3 && sm.onlineMissed === 0) strengths.push(`${g('حلّ', 'حلّت')} كل امتحانات الأونلاين`);
    const last3 = cTaken.slice(-3).map(x => x.pct), prev3 = cTaken.slice(-6, -3).map(x => x.pct);
    const diff = last3.length === 3 && prev3.length >= 2 ? avg(last3) - avg(prev3) : null;
    if (diff !== null && diff >= 5) strengths.push(`مستواه في تحسّن — آخر 3 امتحانات سنتر أعلى بـ ${r0(diff)} نقطة`.replace('مستواه', g('مستواه', 'مستواها')));
    if (diff !== null && diff <= -5) watch.push(`${g('درجاته', 'درجاتها')} نزلت — آخر 3 امتحانات سنتر أقل بـ ${r0(-diff)} نقطة من اللي قبلها`);
    const weak = all.filter(x => x.pct < 60).sort((a, b) => a.pct - b.pct).slice(0, 2);
    if (weak.length) watch.push(`محتاج مراجعة: ${weak.map(w => `${w.name} (${r0(w.pct)}%)`).join(' · ')}`.replace('محتاج', g('محتاج', 'محتاجة')));
    if (sm.centerAbsent) watch.push(`${g('غاب', 'غابت')} ${sm.centerAbsent} ${sm.centerAbsent === 1 ? 'امتحان' : 'امتحانات'} سنتر`);
    if (sm.onlineMissed) watch.push(`${g('فاته', 'فاتها')} ${sm.onlineMissed} ${sm.onlineMissed === 1 ? 'امتحان' : 'امتحانات'} أونلاين`);
    if (!strengths.length && sm.combinedPct !== null && sm.combinedPct >= 75) strengths.push(`المستوى العام كويس (${r0(sm.combinedPct)}%)`);
    // what's new for the grade
    const { results: lessons } = await db.prepare(`SELECT title, category, url, created_at as at FROM lessons WHERE LOWER(grade) = ? ORDER BY rowid DESC LIMIT 4`).bind(child.grade).all();
    const unread = await db.prepare(`SELECT COALESCE(SUM(student_unread), 0) as c FROM ask_questions WHERE audience = 'parent' AND student_id = ?`).bind(child.studentId).first();
    return {
        child: { ...childOut(child), studentId: child.studentId },
        summary: {
            overallPct: sm.combinedPct, level: sm.level, ranked: sm.ranked, participation: sm.participation,
            rank: sm.combinedRank, centerRank: sm.centerRank, gradeSize: sm.gradeSize,
            centerPct: sm.centerPct, centerTaken: sm.centerTaken, centerAbsent: sm.centerAbsent,
            attendanceRate: attTotal ? r0((sm.centerTaken / attTotal) * 100) : null,
            onlinePct: sm.onlinePct, onlineTaken: sm.onlineTaken, onlineMissed: sm.onlineMissed,
            onlineRate: sm.onlineTaken + sm.onlineMissed ? r0((sm.onlineTaken / (sm.onlineTaken + sm.onlineMissed)) * 100) : null
        },
        alerts: { closingSoon, open: open.filter(o => o.hoursLeft > 24), missed: missed.slice(0, 12) },
        activeExams, serverNow: now,
        insights: { strengths, watch },
        trend, center: center.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))), online: online.filter(o => o.status !== 'not-yet' || toMs(o.expiresAt) > now),
        lessons: (lessons || []).map(l => ({ title: l.title, category: l.category, url: l.url, at: l.at })),
        unread: (unread && unread.c) || 0,
        updatedAt: new Date().toISOString()
    };
}
