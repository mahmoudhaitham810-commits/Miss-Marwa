// =====================================================================
// Automatic pushes for the Parent Portal (18 Nov 2026). Shared module — not a page (onRequest → 404).
//   • center grades entered          → the parents of those students (once per exam per student)
//   • online exam submitted           → that student's parent (score)
//   • online exam closes within 24 h and not taken → the student + the parent (once per exam per student)
// New lessons / exams reach parents through the grade push (push.js pushToGrade: tag pg_<grade>).
// Pushes are grouped (one request per kind, not per person) — Cloudflare limits outgoing requests per call.
// =====================================================================
import { normalizeEgyptPhone } from './admin-auth.js';
import { pushTo, parents as pushParents, students as pushStudents, background } from './push.js';

export async function onRequest() { return new Response('Not found', { status: 404 }); }

const SITE = (origin) => origin || '';
const toMs = (v) => { if (!v) return 0; const s = String(v); const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'); return isNaN(t) ? 0 : t; };

async function parentPhonesOf(db, ids) {
    if (!ids.length) return [];
    const out = new Set();
    for (let i = 0; i < ids.length; i += 90) {
        const part = ids.slice(i, i + 90);
        const { results } = await db.prepare(`SELECT parent_phone FROM students WHERE student_id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
        (results || []).forEach(r => { const p = normalizeEgyptPhone(r.parent_phone); if (/^01\d{9}$/.test(p)) out.add(p); });
    }
    return [...out];
}
// Who hasn't been told yet (records them as told)
async function firstTime(db, key, kind, ids) {
    if (!ids.length) return [];
    const fresh = [];
    for (const id of ids) {
        const r = await db.prepare('INSERT OR IGNORE INTO exam_reminders (exam_id, student_id, kind) VALUES (?, ?, ?)').bind(String(key), id, kind).run();
        if (r.meta && r.meta.changes) fresh.push(id);
    }
    return fresh;
}

/** Center grades were entered for these students */
export function notifyGrades(context, env, db, { examId, examName }, studentIds, origin) {
    return background(context, (async () => {
        const ids = await firstTime(db, 'center:' + examId, 'grades', studentIds);
        const phones = await parentPhonesOf(db, ids);
        if (!phones.length) return null;
        return pushTo(env, db, pushParents(phones), { title: 'نزلت درجات جديدة 📊', message: `درجات امتحان ${examName} نزلت — افتح بوابة ولي الأمر وشوف درجة ابنك/بنتك`, url: SITE(origin) + '/parent.html' });
    })());
}

/** An online exam was submitted */
export function notifyOnlineResult(context, env, db, { studentId, examTitle, score, total }, origin) {
    return background(context, (async () => {
        const st = await db.prepare('SELECT first_name, gender, parent_phone FROM students WHERE student_id = ?').bind(studentId).first();
        const phone = st && normalizeEgyptPhone(st.parent_phone);
        if (!phone || !/^01\d{9}$/.test(phone)) return null;
        const did = st.gender === 'female' ? 'خلّصت' : 'خلّص';
        return pushTo(env, db, pushParents([phone]), { title: `${st.first_name || ''} ${did} امتحان أونلاين ✅`.trim(), message: `${examTitle}: ${score} من ${total}`, url: SITE(origin) + '/parent.html' });
    })());
}

/** Exams closing within 24 h that a student hasn't submitted → remind student + parent (once). Runs at most every 20 min. */
export function closingSweep(context, env, db, origin) {
    return background(context, (async () => {
        const last = await db.prepare(`SELECT value FROM app_kv WHERE "key" = 'sweep_closing_at'`).first().catch(() => null);
        if (last && Date.now() - Number(last.value) < 20 * 60000) return null;
        await db.prepare(`INSERT INTO app_kv ("key", value) VALUES ('sweep_closing_at', ?) ON CONFLICT("key") DO UPDATE SET value = excluded.value`).bind(String(Date.now())).run();
        const now = Date.now(), soon = now + 24 * 3600000;
        const { results: exams } = await db.prepare('SELECT id, title, grade, expires_at FROM exams ORDER BY expires_at ASC LIMIT 200').all();
        const due = (exams || []).filter(e => { const t = toMs(e.expires_at); return t > now && t <= soon; }).slice(0, 4);
        const out = [];
        for (const e of due) {
            const { results: st } = await db.prepare(
                `SELECT s.student_id FROM students s LEFT JOIN exam_submissions sub ON sub.exam_id = ? AND sub.student_id = s.student_id
                 WHERE LOWER(TRIM(s.grade)) = LOWER(TRIM(?)) AND (sub.status IS NULL OR sub.status <> 'submitted')`).bind(e.id, e.grade).all();
            const ids = await firstTime(db, e.id, 'closing', (st || []).map(r => r.student_id));
            if (!ids.length) continue;
            const hours = Math.max(1, Math.round((toMs(e.expires_at) - now) / 3600000));
            out.push(await pushTo(env, db, pushStudents(ids), { title: '⏰ امتحان هيقفل قريب', message: `${e.title} هيقفل خلال ${hours} ساعة ولسه ماحلّيتوش`, url: SITE(origin) + '/exams.html' }));
            const phones = await parentPhonesOf(db, ids);
            if (phones.length) out.push(await pushTo(env, db, pushParents(phones), { title: '⏰ تنبيه: امتحان هيقفل قريب', message: `امتحان ${e.title} هيقفل خلال ${hours} ساعة وابنك/بنتك لسه ماحلّوش`, url: SITE(origin) + '/parent.html' }));
        }
        return out;
    })());
}
