// =====================================================================
// Assistant Pro subscriptions — paying by Vodafone Cash / Fawry (27 Nov 2026, Mahmoud).
// The student transfers the price (AI usage page → settings, 65 EGP) to the Vodafone Cash wallet (or deposits it at Fawry),
// then sends the screenshot / receipt photo HERE — their account code goes with it automatically. Miss Marwa approves it
// on the AI usage page → Pro is ON for 30 days from that moment with a fresh budget (ai_student_plan.paid_from/paid_until).
//
// Student (signed in):
//   GET  ?action=info                         → { price, credits, days, wallet, code, sub, request }
//   POST ?action=request { method, fromPhone?, image: { mime, data(base64) } }  → one waiting request at a time
// Staff (ai.manage):
//   GET  ?action=list&status=pending|all      → requests + student names
//   GET  ?action=image&id=N                   → the photo (private, no cache)
//   POST ?action=decide { id, approve, note? } → approve = Pro ON for 30 days; reject = the note is shown to the student
// =====================================================================
import { requireStaff, ensureAppSchema, verifyStudentRequest, audit, auditStmt } from './admin-auth.js';
import { ensureQuotaTables, quotaSettings, studentQuota, cairoDay } from './ai-quota.js';
import { putMedia, mediaInfo, mediaResponse, deleteMedia } from './media-store.js';
import { pushTo, students as pushStudents, staffList, background } from './push.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store' } });
const bad = (m, s = 400, extra = {}) => json({ error: m, ...extra }, s);
export const SUB_DAYS = 30;
const METHODS = ['vodafone', 'fawry'];
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2.5 * 1024 * 1024;           // the browser shrinks photos to ~300 KB; this is only a ceiling
const PER_DAY = 6;                             // requests a student can send in one day (stops spam)

const ready = new WeakSet();
async function ensure(db) {
    if (ready.has(db)) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS ai_pay_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, method TEXT NOT NULL,
            amount REAL NOT NULL, from_phone TEXT, media_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', note TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP, decided_at TEXT, decided_by TEXT, paid_until TEXT)`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_pay_status ON ai_pay_requests(status, created_at)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_pay_student ON ai_pay_requests(student_id, created_at)')
    ]);
    ready.add(db);
}
// the photo really is a JPEG / PNG / WebP (not just labelled so)
function sniff(bytes) {
    if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
    return null;
}
const b64Bytes = (b64) => { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
const reqOut = (r) => r ? { id: r.id, method: r.method, amount: r.amount, status: r.status, note: r.note || null, createdAt: r.created_at, decidedAt: r.decided_at || null, paidUntil: r.paid_until || null } : null;
/** Cairo day + n days, as YYYY-MM-DD */
function addDays(day, n) { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url), action = url.searchParams.get('action') || '';
    const db = getDb(env);
    if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db); await ensureQuotaTables(db); await ensure(db);
        const S = await quotaSettings(db);

        // ---------------- staff ----------------
        if (['list', 'image', 'decide'].includes(action)) {
            const auth = await requireStaff(request, env, 'ai.manage');
            if (auth.error) return auth.error;
            if (action === 'list') {
                const all = url.searchParams.get('status') === 'all';
                const { results } = await db.prepare(`SELECT r.*, s.first_name, s.last_name, s.grade, s.phone FROM ai_pay_requests r LEFT JOIN students s ON s.student_id = r.student_id
                    ${all ? '' : "WHERE r.status = 'pending'"} ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT ${all ? 100 : 200}`).all();
                const pending = await db.prepare(`SELECT COUNT(*) AS n FROM ai_pay_requests WHERE status = 'pending'`).first();
                return json({ pending: Number(pending && pending.n) || 0, requests: (results || []).map(r => ({ ...reqOut(r), studentId: r.student_id, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.student_id,
                    grade: String(r.grade || '').toLowerCase(), studentPhone: r.phone || null, fromPhone: r.from_phone || null, hasImage: !!r.media_id })) });
            }
            if (action === 'image') {
                const r = await db.prepare('SELECT media_id FROM ai_pay_requests WHERE id = ?').bind(parseInt(url.searchParams.get('id'), 10) || 0).first();
                const info = r && r.media_id ? await mediaInfo(db, r.media_id) : null;
                if (!info) return bad('Not found', 404);
                const res = await mediaResponse(env, db, info, { cache: 'private, no-store' });
                res.headers.set('X-Content-Type-Options', 'nosniff');
                return res;
            }
            if (request.method !== 'POST') return bad('POST only', 405);
            const data = await request.json().catch(() => ({}));
            const id = parseInt(data.id, 10) || 0;
            const r = await db.prepare('SELECT * FROM ai_pay_requests WHERE id = ?').bind(id).first();
            if (!r) return bad('Request not found', 404);
            if (r.status !== 'pending') return bad('This request was already ' + r.status, 409);
            const note = String(data.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
            if (data.approve) {
                // 30 days from today (Cairo), today included → the last day is today + 29
                const until = addDays(cairoDay(), SUB_DAYS - 1);
                await db.batch([
                    db.prepare('INSERT OR IGNORE INTO ai_student_plan (student_id) VALUES (?)').bind(r.student_id),
                    db.prepare(`UPDATE ai_student_plan SET enabled = 1, paid_from = strftime('%Y-%m-%d %H:%M:%f', 'now'), paid_until = ?, reset_at = NULL, reset_period = NULL,
                        updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE student_id = ?`).bind(until, auth.staff.id, r.student_id),
                    db.prepare(`UPDATE ai_pay_requests SET status = 'approved', note = ?, decided_at = CURRENT_TIMESTAMP, decided_by = ?, paid_until = ? WHERE id = ? AND status = 'pending'`).bind(note || null, auth.staff.id, until, id),
                    auditStmt(db, request, auth.staff, 'ai.pay.approve', r.student_id, { request: id, method: r.method, amount: r.amount, paidUntil: until })
                ]);
                background(context, pushTo(env, db, pushStudents([r.student_id]), { title: 'Assistant Pro is ON ✨', message: 'اشتراكك اتفعّل — يلا نذاكر سوا!', url: '/assistant.html' }));
                return json({ ok: true, paidUntil: until, quota: await studentQuota(db, r.student_id) });
            }
            if (!note) return bad('Write the reason so the student knows what to fix');
            await db.batch([
                db.prepare(`UPDATE ai_pay_requests SET status = 'rejected', note = ?, decided_at = CURRENT_TIMESTAMP, decided_by = ? WHERE id = ? AND status = 'pending'`).bind(note, auth.staff.id, id),
                auditStmt(db, request, auth.staff, 'ai.pay.reject', r.student_id, { request: id, note })
            ]);
            background(context, pushTo(env, db, pushStudents([r.student_id]), { title: 'Assistant Pro payment', message: 'في مشكلة في إيصال الدفع — افتح المساعد وشوف التفاصيل 🙏', url: '/assistant.html' }));
            return json({ ok: true });
        }

        // ---------------- student ----------------
        const st = await verifyStudentRequest(request, env, db);
        if (!st) return bad('Sign in again', 401);
        const sid = st.id;
        if (action === 'info') {
            const q = await studentQuota(db, sid, S);
            const last = await db.prepare('SELECT * FROM ai_pay_requests WHERE student_id = ? ORDER BY id DESC LIMIT 1').bind(sid).first();
            return json({ price: S.price, credits: S.budget, days: SUB_DAYS, wallet: S.wallet, code: sid,
                sub: q.sub && !q.sub.expired && q.switchedOn ? { until: q.sub.paidUntil, leftEgp: Math.round(q.leftEgp * 10) / 10 } : null,
                subscribed: q.mode === 'plan', request: reqOut(last) });
        }
        if (action === 'request') {
            if (request.method !== 'POST') return bad('POST only', 405);
            const data = await request.json().catch(() => null);
            if (!data) return bad('ابعت الصورة تاني 🙏');
            const method = METHODS.includes(data.method) ? data.method : null;
            if (!method) return bad('اختار طريقة الدفع');
            const fromPhone = String(data.fromPhone || '').replace(/\D/g, '').slice(0, 11);
            if (fromPhone && !/^01[0125]\d{8}$/.test(fromPhone)) return bad('رقم المحفظة اللي حوّلت منه مش صح (11 رقم)');
            const img = data.image || {};
            if (!MIMES.includes(img.mime) || typeof img.data !== 'string' || !img.data) return bad('ارفع صورة التحويل أو الإيصال (JPG / PNG)');
            if (img.data.length > MAX_BYTES * 1.37) return bad('الصورة كبيرة — جرّب صورة أصغر');
            let bytes; try { bytes = b64Bytes(img.data); } catch (e) { return bad('الصورة مش واضحة — جرّب تاني'); }
            const real = sniff(bytes);
            if (!real || bytes.length > MAX_BYTES) return bad('ده مش ملف صورة — ارفع screenshot أو صورة الإيصال');
            const today = await db.prepare(`SELECT COUNT(*) AS n FROM ai_pay_requests WHERE student_id = ? AND created_at >= datetime('now', '-1 day')`).bind(sid).first();
            if ((Number(today && today.n) || 0) >= PER_DAY) return bad('بعت طلبات كتير النهارده — استنى رد فريق مس مروة 🙏', 429);
            const pending = await db.prepare(`SELECT id, media_id FROM ai_pay_requests WHERE student_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`).bind(sid).first();
            const m = await putMedia(env, db, { kind: 'pay', studentId: sid, mime: real, data: img.data });
            let id;
            if (pending) {   // they're sending a clearer photo — replace the waiting one (still ONE request)
                id = pending.id;
                await db.prepare(`UPDATE ai_pay_requests SET method = ?, amount = ?, from_phone = ?, media_id = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(method, S.price, fromPhone || null, m.id, id).run();
                if (pending.media_id && pending.media_id !== m.id) await deleteMedia(env, db, [pending.media_id]).catch(() => {});   // the old photo isn't kept (storage + privacy)
            } else {
                const r = await db.prepare('INSERT INTO ai_pay_requests (student_id, method, amount, from_phone, media_id) VALUES (?, ?, ?, ?, ?)').bind(sid, method, S.price, fromPhone || null, m.id).run();
                id = Number(r.meta.last_row_id);
            }
            await audit(db, request, { id: null, name: [st.firstName, st.lastName].filter(Boolean).join(' ') || sid, role: 'student' }, 'ai.pay.request', sid, { request: id, method, amount: S.price, replaced: !!pending });
            // tell the teacher(s) who manage the AI page
            background(context, (async () => {
                const { results } = await db.prepare(`SELECT id FROM staff WHERE active = 1 AND role = 'teacher'`).all().catch(() => ({ results: [] }));
                const ids = (results || []).map(x => x.id);
                if (ids.length) await pushTo(env, db, staffList(ids), { title: 'New Assistant Pro payment 💳', message: `${st.firstName || sid} sent a ${method === 'fawry' ? 'Fawry' : 'Vodafone Cash'} receipt — approve it on the AI usage page.`, url: '/admin/ai-usage.html' });
            })());
            const last = await db.prepare('SELECT * FROM ai_pay_requests WHERE id = ?').bind(id).first();
            return json({ ok: true, request: reqOut(last) });
        }
        return bad('Unknown action', 404);
    } catch (e) {
        console.error('subscription error', e);
        return bad('حصلت مشكلة — جرّب تاني 🙏', 500);   // the real error stays in the server log, never in the answer
    }
}
