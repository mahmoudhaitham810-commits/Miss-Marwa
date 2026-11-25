// =====================================================================
// Weekly homework follow-up · متابعة الواجب (25 Nov 2026) — separate from the (paused) online homework system.
// Like Center grades: one column per week per grade (+ branch). The standard is that every student did the homework,
// so staff only mark the exceptions with a code:
//   R = not submitted (ما سلّمش) · I = incomplete (ناقص)   → a WhatsApp message to the parent
//   A = absent that week (غايب)                             → recorded, no message
//   (no code) = done ✓
//
//   GET  ?action=grade-data&grade=prep1&branch=center|private|all → { students, weeks, marks }
//   POST ?action=create-week { grade, branch, title, weekDate }
//   POST ?action=update-week { id, title, weekDate }
//   POST ?action=delete-week { id }                       (teacher only — a full copy goes to the activity log)
//   POST ?action=save-marks  { weekId, marks: [{ studentId, code }] }   code '' = done (row removed)
// =====================================================================
import { requireStaff, audit, auditStmt, ensureAppSchema } from './admin-auth.js';

const getDb = (env) => [env.DB, env.D1_DB].find(d => d && typeof d.prepare === 'function');
const json = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store' } });
const bad = (m, s = 400) => json({ error: m }, s);
const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
const BRANCHES = ['center', 'private'];
export const HW_CODES = ['R', 'I', 'A'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ready = new WeakSet();
async function ensure(db) {
    if (ready.has(db)) return;
    await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS hw_weeks (id INTEGER PRIMARY KEY AUTOINCREMENT, grade TEXT NOT NULL, branch TEXT, title TEXT NOT NULL,
            week_date TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_hw_weeks_grade ON hw_weeks(grade, week_date)'),
        db.prepare(`CREATE TABLE IF NOT EXISTS hw_week_marks (week_id INTEGER NOT NULL, student_id TEXT NOT NULL, code TEXT NOT NULL, updated_by TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (week_id, student_id))`)
    ]);
    ready.add(db);
}
const weekOut = (w) => ({ id: w.id, grade: w.grade, branch: w.branch || null, title: w.title, weekDate: w.week_date, createdAt: w.created_at });

export async function onRequestGet({ request, env }) {
    const auth = await requireStaff(request, env, 'hwtrack.view');
    if (auth.error) return auth.error;
    const db = getDb(env); if (!db) return bad('Database not connected', 500);
    const url = new URL(request.url), action = url.searchParams.get('action');
    try {
        await ensureAppSchema(db); await ensure(db);
        if (action === 'grade-data') {
            const grade = String(url.searchParams.get('grade') || '').toLowerCase();
            const branch = String(url.searchParams.get('branch') || 'all').toLowerCase();
            if (!GRADES.includes(grade)) return bad('المرحلة الدراسية مطلوبة');
            let sSql = `SELECT student_id AS studentId, first_name AS firstName, last_name AS lastName, gender, branch, parent_phone AS parentPhone FROM students WHERE grade = ?`;
            const sArgs = [grade];
            if (BRANCHES.includes(branch)) { sSql += ' AND branch = ?'; sArgs.push(branch); }
            sSql += ' ORDER BY first_name ASC, last_name ASC';
            const { results: students } = await db.prepare(sSql).bind(...sArgs).all();
            let wSql = 'SELECT * FROM hw_weeks WHERE grade = ?'; const wArgs = [grade];
            if (BRANCHES.includes(branch)) { wSql += ' AND (branch = ? OR branch IS NULL)'; wArgs.push(branch); }
            wSql += ' ORDER BY COALESCE(week_date, substr(created_at, 1, 10)) ASC, id ASC';
            const { results: weeks } = await db.prepare(wSql).bind(...wArgs).all();
            const marks = [];
            const ids = (weeks || []).map(w => w.id);
            for (let i = 0; i < ids.length; i += 90) {
                const chunk = ids.slice(i, i + 90);
                const { results } = await db.prepare(`SELECT week_id AS weekId, student_id AS studentId, code FROM hw_week_marks WHERE week_id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
                marks.push(...(results || []));
            }
            return json({ students: students || [], weeks: (weeks || []).map(weekOut), marks });
        }
        return bad('Unknown action');
    } catch (e) { return bad(e.message || 'Server error', 500); }
}

export async function onRequestPost({ request, env }) {
    const url = new URL(request.url), action = url.searchParams.get('action');
    const PERM = { 'create-week': 'hwtrack.edit', 'update-week': 'hwtrack.edit', 'save-marks': 'hwtrack.edit', 'delete-week': 'hwtrack.delete' };
    const auth = await requireStaff(request, env, PERM[action] || 'hwtrack.edit');
    if (auth.error) return auth.error;
    const staff = auth.staff;
    const db = getDb(env); if (!db) return bad('Database not connected', 500);
    try {
        await ensureAppSchema(db); await ensure(db);
        const data = await request.json().catch(() => ({}));
        const title = String(data.title || '').replace(/\s+/g, ' ').trim();
        const weekDate = DATE_RE.test(String(data.weekDate || '')) ? data.weekDate : null;

        if (action === 'create-week') {
            const grade = String(data.grade || '').toLowerCase(), branch = String(data.branch || '').toLowerCase();
            if (!GRADES.includes(grade)) return bad('اختاري المرحلة');
            if (!BRANCHES.includes(branch)) return bad('اختاري سنتر أو خاص');
            if (!title || title.length > 80) return bad('اكتبي اسم الواجب (لحد 80 حرف)');
            const r = await db.prepare('INSERT INTO hw_weeks (grade, branch, title, week_date, created_by) VALUES (?, ?, ?, ?, ?)')
                .bind(grade, branch, title, weekDate || new Date().toISOString().slice(0, 10), staff.id).run();
            const w = await db.prepare('SELECT * FROM hw_weeks WHERE id = ?').bind(Number(r.meta.last_row_id)).first();
            await audit(db, request, staff, 'hwtrack.create-week', String(w.id), weekOut(w));
            return json({ ok: true, week: weekOut(w) });
        }

        const id = parseInt(data.id ?? data.weekId, 10);
        const week = id ? await db.prepare('SELECT * FROM hw_weeks WHERE id = ?').bind(id).first() : null;
        if (!week) return bad('الأسبوع ده مش موجود', 404);

        if (action === 'update-week') {
            if (!title || title.length > 80) return bad('اكتبي اسم الواجب (لحد 80 حرف)');
            await db.prepare('UPDATE hw_weeks SET title = ?, week_date = COALESCE(?, week_date), updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(title, weekDate, id).run();
            await audit(db, request, staff, 'hwtrack.update-week', String(id), { before: weekOut(week), title, weekDate });
            return json({ ok: true, week: weekOut(await db.prepare('SELECT * FROM hw_weeks WHERE id = ?').bind(id).first()) });
        }
        if (action === 'delete-week') {
            const { results: marks } = await db.prepare('SELECT student_id AS studentId, code FROM hw_week_marks WHERE week_id = ?').bind(id).all();
            await db.batch([
                auditStmt(db, request, staff, 'hwtrack.delete-week', String(id), { week: weekOut(week), marks: marks || [] }),   // full copy kept
                db.prepare('DELETE FROM hw_week_marks WHERE week_id = ?').bind(id),
                db.prepare('DELETE FROM hw_weeks WHERE id = ?').bind(id)
            ]);
            return json({ ok: true });
        }
        if (action === 'save-marks') {
            const list = (Array.isArray(data.marks) ? data.marks : []).slice(0, 500);
            if (!list.length) return bad('مفيش حاجة تتحفظ');
            // only students of this week's grade (and branch) — never another grade's student
            const ids = [...new Set(list.map(m => String(m && m.studentId || '').trim()).filter(Boolean))];
            const known = new Set();
            for (let i = 0; i < ids.length; i += 90) {
                const chunk = ids.slice(i, i + 90);
                const { results } = await db.prepare(`SELECT student_id FROM students WHERE grade = ?${week.branch ? ' AND branch = ?' : ''} AND student_id IN (${chunk.map(() => '?').join(',')})`)
                    .bind(week.grade, ...(week.branch ? [week.branch] : []), ...chunk).all();
                (results || []).forEach(r => known.add(r.student_id));
            }
            const st = [], saved = [];
            for (const m of list) {
                const sid = String(m && m.studentId || '').trim(), code = String(m && m.code || '').trim().toUpperCase();
                if (!known.has(sid)) continue;
                if (code && !HW_CODES.includes(code)) return bad('كود غلط: ' + code);
                st.push(code
                    ? db.prepare(`INSERT INTO hw_week_marks (week_id, student_id, code, updated_by, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(week_id, student_id) DO UPDATE SET code = excluded.code, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`).bind(id, sid, code, staff.id)
                    : db.prepare('DELETE FROM hw_week_marks WHERE week_id = ? AND student_id = ?').bind(id, sid));
                saved.push({ studentId: sid, code });
            }
            if (!st.length) return bad('الطلبة دول مش في المجموعة دي');
            st.push(auditStmt(db, request, staff, 'hwtrack.save-marks', String(id), { marks: saved }));
            await db.batch(st);
            return json({ ok: true, saved: saved.length });
        }
        return bad('Unknown action');
    } catch (e) { return bad(e.message || 'Server error', 500); }
}
