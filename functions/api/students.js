import { requireStaff, auditStmt, ensureAppSchema, normalizeEgyptPhone, nameKey, maxDevices } from './admin-auth.js';

// Students list for the staff portal. Passwords are never sent back to the browser.
const STUDENT_COLUMNS = `student_id, first_name, last_name, gender, branch, phone, parent_phone, grade, role, created_at`;

// ── Possible duplicate accounts ──
// Never decided by the name alone (names repeat). A pair is shown when the data points line up:
//   high   = same student phone in the same grade (sign-up now blocks this for new accounts)
//   medium = same parent phone + same gender + the same first name (Arabic/English spelling ignored)
//   medium = same student phone + same first name, but in two different grades
// Twins/siblings share a parent phone but have their own phone and name, so they are not flagged.
async function findDuplicates(db) {
    const { results: rows } = await db.prepare(`SELECT ${STUDENT_COLUMNS} FROM students`).all();
    const { results: dismissed } = await db.prepare('SELECT pair_key FROM duplicate_dismissals').all();
    const skip = new Set((dismissed || []).map(r => r.pair_key));
    const { results: onl } = await db.prepare("SELECT student_id, COUNT(*) c FROM exam_submissions WHERE status = 'submitted' GROUP BY student_id").all();
    const { results: off } = await db.prepare('SELECT student_id, COUNT(*) c FROM offline_grades WHERE score IS NOT NULL GROUP BY student_id').all();
    const onlMap = Object.fromEntries((onl || []).map(r => [r.student_id, r.c]));
    const offMap = Object.fromEntries((off || []).map(r => [r.student_id, r.c]));
    const list = (rows || []).map(r => ({
        studentId: r.student_id, firstName: r.first_name, lastName: r.last_name, gender: r.gender, branch: r.branch,
        grade: r.grade, phone: r.phone, parentPhone: r.parent_phone, createdAt: r.created_at,
        onlineExams: onlMap[r.student_id] || 0, centerMarks: offMap[r.student_id] || 0,
        _p: normalizeEgyptPhone(r.phone), _pp: normalizeEgyptPhone(r.parent_phone), _n: nameKey(r.first_name), _l: nameKey(r.last_name)
    }));
    const strip = ({ _p, _pp, _n, _l, ...rest }) => rest;
    const pairs = [];
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            const sameGrade = a.grade === b.grade;
            const samePhone = !!a._p && a._p === b._p;
            const sameParent = !!a._pp && a._pp === b._pp;
            const sameFirst = !!a._n && a._n === b._n;
            if (!samePhone && !(sameParent && sameFirst)) continue; // fast path
            const sameLast = !!a._l && a._l === b._l;
            const sameGender = !!a.gender && a.gender === b.gender;
            let level = null;
            if (sameGrade && samePhone) level = 'high';
            else if (sameGrade && sameParent && sameGender && sameFirst) level = 'medium';
            else if (!sameGrade && samePhone && sameFirst) level = 'medium';
            if (!level) continue;
            const key = [a.studentId, b.studentId].sort().join('|');
            if (skip.has(key)) continue;
            const matches = [];
            if (samePhone) matches.push('student phone');
            if (sameParent) matches.push('parent phone');
            if (sameFirst) matches.push('first name');
            if (sameLast) matches.push('last name');
            if (sameGender) matches.push('gender');
            if (sameGrade) matches.push('grade');
            if (a.branch && a.branch === b.branch) matches.push('branch');
            pairs.push({ key, level, matches, students: [strip(a), strip(b)] });
        }
    }
    pairs.sort((x, y) => (x.level === y.level ? 0 : x.level === 'high' ? -1 : 1));
    return pairs;
}

export async function onRequestGet(context) {
    const auth = await requireStaff(context.request, context.env, 'students.view');
    if (auth.error) return auth.error;

    const db = [context.env.DB, context.env.D1_DB].find(d => d && typeof d.prepare === "function");
    try {
        const action = new URL(context.request.url).searchParams.get('action');
        if (action === 'duplicates') {
            await ensureAppSchema(db);
            return Response.json({ pairs: await findDuplicates(db) });
        }
        await ensureAppSchema(db);
        // The devices a student is signed in on (max 2)
        if (action === 'devices') {
            const studentId = new URL(context.request.url).searchParams.get('studentId') || '';
            const { results } = await db.prepare('SELECT label, created_at as firstSeen, last_seen_at as lastSeen FROM student_devices WHERE student_id = ? ORDER BY id').bind(studentId).all();
            return Response.json({ devices: results || [], max: maxDevices(context.env) });
        }
        const { results } = await db.prepare(`SELECT ${STUDENT_COLUMNS}, (SELECT COUNT(*) FROM student_devices d WHERE d.student_id = students.student_id) as devices FROM students ORDER BY created_at DESC`).all();
        return Response.json(results);
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = [env.DB, env.D1_DB].find(d => d && typeof d.prepare === "function");

    try {
        // 1. Reset a student's password (teacher + assistant, logged)
        if (action === 'reset-password') {
            const auth = await requireStaff(request, env, 'students.reset-password');
            if (auth.error) return auth.error;
            const { studentId, password } = await request.json();
            if (!studentId || typeof password !== 'string' || password.trim().length < 4) {
                return Response.json({ error: 'كلمة المرور يجب ألا تقل عن 4 خانات' }, { status: 400 });
            }
            const exists = await db.prepare('SELECT student_id FROM students WHERE student_id = ?').bind(studentId).first();
            if (!exists) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            await ensureAppSchema(db);
            await db.batch([
                // session_version + 1 signs the student out on every device that used the old password
                db.prepare('UPDATE students SET password = ?, session_version = COALESCE(session_version, 1) + 1 WHERE student_id = ?').bind(password.trim(), studentId),
                auditStmt(db, request, auth.staff, 'students.reset-password', studentId, null)
            ]);
            return Response.json({ success: true });
        }

        // 1b. Reset devices (teacher + assistant, logged): frees both device slots and signs the student out everywhere
        if (action === 'reset-devices') {
            const auth = await requireStaff(request, env, 'students.reset-password');
            if (auth.error) return auth.error;
            const { studentId } = await request.json();
            const exists = await db.prepare('SELECT student_id FROM students WHERE student_id = ?').bind(String(studentId || '')).first();
            if (!exists) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            await ensureAppSchema(db);
            const { results: before } = await db.prepare('SELECT label, last_seen_at as lastSeen FROM student_devices WHERE student_id = ?').bind(studentId).all();
            await db.batch([
                db.prepare('DELETE FROM student_devices WHERE student_id = ?').bind(studentId),
                db.prepare('UPDATE students SET session_version = COALESCE(session_version, 1) + 1 WHERE student_id = ?').bind(studentId),
                auditStmt(db, request, auth.staff, 'students.reset-devices', studentId, { devices: before || [] })
            ]);
            return Response.json({ success: true, cleared: (before || []).length });
        }

        // 2. Delete a student (teacher only). A full copy of the row is kept in the audit log.
        if (action === 'delete') {
            const auth = await requireStaff(request, env, 'students.delete');
            if (auth.error) return auth.error;
            const { studentId } = await request.json();
            if (!studentId) return Response.json({ error: 'كود الطالب مطلوب' }, { status: 400 });
            const row = await db.prepare(`SELECT ${STUDENT_COLUMNS} FROM students WHERE student_id = ?`).bind(studentId).first();
            if (!row) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            await ensureAppSchema(db);
            await db.batch([
                db.prepare('DELETE FROM students WHERE student_id = ?').bind(studentId),
                db.prepare('DELETE FROM student_devices WHERE student_id = ?').bind(studentId),
                auditStmt(db, request, auth.staff, 'students.delete', studentId, { student: row })
            ]);
            return Response.json({ success: true });
        }

        // 3. Put students in Center / Private (fixes accounts with no branch)
        if (action === 'set-branch') {
            const auth = await requireStaff(request, env, 'students.edit');
            if (auth.error) return auth.error;
            const { studentIds, branch } = await request.json();
            if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 90 || !['center', 'private'].includes(branch)) {
                return Response.json({ error: 'بيانات غير صحيحة' }, { status: 400 });
            }
            const ph = studentIds.map(() => '?').join(',');
            const { results: before } = await db.prepare(`SELECT student_id, branch FROM students WHERE student_id IN (${ph})`).bind(...studentIds).all();
            await db.batch([
                db.prepare(`UPDATE students SET branch = ? WHERE student_id IN (${ph})`).bind(branch, ...studentIds),
                auditStmt(db, request, auth.staff, 'students.set-branch', branch, { students: before })
            ]);
            return Response.json({ success: true, updated: before.length });
        }

        // 4. "These two are NOT the same student" — hide the pair from the duplicates list
        if (action === 'dismiss-duplicate') {
            const auth = await requireStaff(request, env, 'students.edit');
            if (auth.error) return auth.error;
            await ensureAppSchema(db);
            const { a, b } = await request.json();
            if (!a || !b || a === b) return Response.json({ error: 'بيانات غير صحيحة' }, { status: 400 });
            const key = [String(a), String(b)].sort().join('|');
            await db.batch([
                db.prepare('INSERT OR IGNORE INTO duplicate_dismissals (pair_key, staff_id) VALUES (?, ?)').bind(key, auth.staff.id),
                auditStmt(db, request, auth.staff, 'students.not-duplicate', key, null)
            ]);
            return Response.json({ success: true });
        }

        const auth = await requireStaff(request, env, 'students.view');
        if (auth.error) return auth.error;
        return Response.json({ error: 'Action not found' }, { status: 404 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}
