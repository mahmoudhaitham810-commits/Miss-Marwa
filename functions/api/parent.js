// Private parent report links.
// Each student gets ONE secret link (sent to the parent once on WhatsApp). Opening it shows that
// student's marks, always up to date — so most weeks no WhatsApp message is needed at all.
// The link shows only what the WhatsApp reports already contain: name, grade, marks, absences.
import { requireStaff, ensureAppSchema, audit, clientIp, throttleState, recordFail } from './admin-auth.js';
import { loadGrade, boardValue } from './analytics.js';

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
            return Response.json({ ...link, url: `${url.origin}/parent.html#${link.token}` });
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
