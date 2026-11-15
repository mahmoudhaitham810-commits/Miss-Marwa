// WhatsApp send log — which parent messages staff have already opened in WhatsApp.
// The portal never sends anything by itself: a person reviews each message and taps Send.
// This log only stops the same message going out twice (teacher and assistant share it).
import { requireStaff, ensureAppSchema } from './admin-auth.js';

function getDb(env) { return [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function'); }
const KINDS = ['center-exam', 'center-report', 'online-report', 'online-missed', 'online-not-submitted', 'gap', 'congrats', 'parent-link', 'homework-report', 'homework-missing', 'other'];

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const auth = await requireStaff(request, env, 'reports.send');
    if (auth.error) return auth.error;
    const db = getDb(env);
    if (!db) return Response.json({ error: 'Database not connected' }, { status: 500 });
    try {
        await ensureAppSchema(db);
        const data = await request.json().catch(() => ({}));

        // Staff opened this message in WhatsApp
        if (action === 'log') {
            const studentId = String(data.studentId || '').slice(0, 40);
            const kind = KINDS.includes(data.kind) ? data.kind : 'other';
            const hash = String(data.hash || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
            if (!studentId || !hash) return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            await db.prepare('INSERT INTO message_log (student_id, kind, text_hash, staff_id, staff_name) VALUES (?, ?, ?, ?, ?)')
                .bind(studentId, kind, hash, auth.staff.id, auth.staff.name).run();
            return Response.json({ ok: true });
        }

        // What was already sent to these students (last 120 days)
        if (action === 'recent') {
            const ids = [...new Set((Array.isArray(data.studentIds) ? data.studentIds : []).map(String))].slice(0, 400);
            if (!ids.length) return Response.json({ entries: [] });
            const entries = [];
            for (let i = 0; i < ids.length; i += 90) {
                const part = ids.slice(i, i + 90);
                const { results } = await db.prepare(
                    `SELECT student_id as studentId, kind, text_hash as hash, staff_name as by, sent_at as at FROM message_log
                     WHERE student_id IN (${part.map(() => '?').join(',')}) AND sent_at >= datetime('now', '-120 days') ORDER BY id DESC`
                ).bind(...part).all();
                entries.push(...(results || []));
            }
            return Response.json({ entries });
        }
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر', detail: String(err && err.message || err) }, { status: 500 });
    }
}
