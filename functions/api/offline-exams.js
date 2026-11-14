import { requireStaff, audit, auditStmt, ensureAppSchema } from './admin-auth.js';

// ============================================================
// Center / private (paper) exams
// ============================================================
// Each exam column belongs to a grade AND a branch ('center' | 'private').
// Columns made before the split have branch = NULL and show in both lists as "Before split"
// until someone tags them. group_id is reserved for private sub-groups (Saturday group, …).
// A mark is either a number, "absent" (absent = 1, score NULL), or not entered yet (no row / score NULL).
// ============================================================

function getDb(env) {
    return env.DB || env.D1_DB;
}
const BRANCHES = ['center', 'private'];
const GRADES = ['prep1', 'prep2', 'prep3', 'sec1'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cellText = (score, absent) => (absent ? 'A' : score);

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = await requireStaff(request, env, 'offline.view');
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);

    try {
        await ensureAppSchema(db);

        // Everything one screen needs: the group's students, its exam columns and all marks
        if (action === 'grade-data') {
            const grade = (url.searchParams.get('grade') || '').toLowerCase();
            const branch = (url.searchParams.get('branch') || 'all').toLowerCase();
            if (!GRADES.includes(grade)) return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });

            let studentSql = "SELECT student_id as studentId, first_name as firstName, last_name as lastName, gender, branch, group_id as groupId, parent_phone as parentPhone, created_at as createdAt FROM students WHERE grade = ?";
            const studentArgs = [grade];
            if (BRANCHES.includes(branch)) { studentSql += " AND branch = ?"; studentArgs.push(branch); }
            else if (branch === 'none') studentSql += " AND (branch IS NULL OR branch NOT IN ('center','private'))";
            studentSql += " ORDER BY first_name ASC, last_name ASC";
            const { results: students } = await db.prepare(studentSql).bind(...studentArgs).all();

            let examSql = "SELECT id, exam_name as examName, total_marks as totalMarks, branch, group_id as groupId, exam_date as examDate, created_at as createdAt FROM offline_exams WHERE grade = ?";
            const examArgs = [grade];
            if (BRANCHES.includes(branch)) { examSql += " AND (branch = ? OR branch IS NULL)"; examArgs.push(branch); }
            examSql += " ORDER BY COALESCE(exam_date, substr(created_at, 1, 10)) ASC, id ASC";
            const { results: exams } = await db.prepare(examSql).bind(...examArgs).all();

            let grades = [];
            if (exams.length > 0) {
                const ids = exams.map(e => e.id);
                for (let i = 0; i < ids.length; i += 90) {
                    const chunk = ids.slice(i, i + 90);
                    const { results } = await db.prepare(
                        `SELECT exam_id as examId, student_id as studentId, score, absent FROM offline_grades WHERE exam_id IN (${chunk.map(() => '?').join(',')})`
                    ).bind(...chunk).all();
                    grades = grades.concat(results.map(g => ({ ...g, absent: !!g.absent })));
                }
            }
            const unassigned = await db.prepare(
                "SELECT COUNT(*) as c FROM students WHERE grade = ? AND (branch IS NULL OR branch NOT IN ('center','private'))"
            ).bind(grade).first();

            return Response.json({
                students,
                exams: exams.map(e => ({ ...e, legacy: !e.branch })),
                grades,
                unassignedCount: unassigned ? unassigned.c : 0
            });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const PERM = { 'create-exam': 'offline.create-exam', 'update-exam': 'offline.edit-exam', 'delete-exam': 'offline.delete-exam', 'save-grades': 'offline.save-grades' };
    const auth = await requireStaff(request, env, PERM[action] || 'offline.view');
    if (auth.error) return auth.error;
    const staff = auth.staff;
    const db = getDb(env);

    try {
        await ensureAppSchema(db);
        const data = await request.json();

        // === New exam column for one grade + one branch ===
        if (action === 'create-exam') {
            const examName = String(data.examName || '').trim();
            const grade = String(data.grade || '').toLowerCase();
            const branch = String(data.branch || '').toLowerCase();
            if (!examName || examName.length > 80 || !GRADES.includes(grade)) {
                return Response.json({ error: 'اسم الامتحان والمرحلة الدراسية مطلوبين' }, { status: 400 });
            }
            if (!BRANCHES.includes(branch)) return Response.json({ error: 'اختاري سنتر أو خاص' }, { status: 400 });
            const totalMarks = parseFloat(data.totalMarks) > 0 ? parseFloat(data.totalMarks) : 100;
            if (totalMarks > 1000) return Response.json({ error: 'الدرجة النهائية كبيرة جداً' }, { status: 400 });
            const examDate = DATE_RE.test(String(data.examDate || '')) ? data.examDate : new Date().toISOString().slice(0, 10);

            const result = await db.prepare(
                "INSERT INTO offline_exams (exam_name, grade, total_marks, branch, exam_date) VALUES (?, ?, ?, ?, ?)"
            ).bind(examName, grade, totalMarks, branch, examDate).run();
            await audit(db, request, staff, 'offline.create-exam', result.meta.last_row_id, { examName, grade, branch, totalMarks, examDate });
            return Response.json({ success: true, examId: result.meta.last_row_id });
        }

        // === Rename / change total / date / tag an old column as Center or Private ===
        if (action === 'update-exam') {
            const { examId } = data;
            const before = await db.prepare("SELECT exam_name, total_marks, branch, exam_date FROM offline_exams WHERE id = ?").bind(examId || 0).first();
            if (!before) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            const examName = data.examName !== undefined ? String(data.examName).trim() : before.exam_name;
            const totalMarks = data.totalMarks !== undefined ? parseFloat(data.totalMarks) : before.total_marks;
            if (!examName || examName.length > 80 || !(totalMarks > 0) || totalMarks > 1000) {
                return Response.json({ error: 'بيانات غير صالحة' }, { status: 400 });
            }
            let branch = before.branch;
            if (data.branch !== undefined) {
                if (!BRANCHES.includes(String(data.branch))) return Response.json({ error: 'اختاري سنتر أو خاص' }, { status: 400 });
                branch = data.branch;
            }
            let examDate = before.exam_date;
            if (data.examDate !== undefined) {
                if (!DATE_RE.test(String(data.examDate))) return Response.json({ error: 'تاريخ غير صحيح' }, { status: 400 });
                examDate = data.examDate;
            }
            // Lowering the total below a mark someone already has would give more than 100%
            const top = await db.prepare("SELECT MAX(score) as m FROM offline_grades WHERE exam_id = ?").bind(examId).first();
            if (top && top.m !== null && totalMarks < top.m) {
                return Response.json({ error: `فيه طالب واخد ${top.m} في الامتحان ده — الدرجة النهائية مينفعش تقل عن كده.` }, { status: 400 });
            }
            await db.batch([
                db.prepare("UPDATE offline_exams SET exam_name = ?, total_marks = ?, branch = ?, exam_date = ? WHERE id = ?").bind(examName, totalMarks, branch, examDate, examId),
                auditStmt(db, request, staff, 'offline.edit-exam', examId, { before, after: { exam_name: examName, total_marks: totalMarks, branch, exam_date: examDate } })
            ]);
            return Response.json({ success: true });
        }

        // === Delete a column (teacher only) — a copy of every mark stays in the activity log ===
        if (action === 'delete-exam') {
            const { examId } = data;
            if (!examId) return Response.json({ error: 'معرف الامتحان مفقود' }, { status: 400 });
            const exam = await db.prepare("SELECT * FROM offline_exams WHERE id = ?").bind(examId).first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            const { results: grades } = await db.prepare("SELECT student_id as s, score as sc, absent as ab FROM offline_grades WHERE exam_id = ?").bind(examId).all();
            await db.batch([
                db.prepare("DELETE FROM offline_grades WHERE exam_id = ?").bind(examId),
                db.prepare("DELETE FROM offline_exams WHERE id = ?").bind(examId),
                auditStmt(db, request, staff, 'offline.delete-exam', examId, { exam, grades })
            ]);
            return Response.json({ success: true });
        }

        // === Save marks: one student (auto-save) or a whole column ===
        // Each entry: { studentId, score: number|''|null, absent?: true }
        if (action === 'save-grades') {
            const { examId, grades } = data;
            if (!examId || !Array.isArray(grades) || grades.length > 1000) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }
            const exam = await db.prepare("SELECT exam_name, total_marks, grade FROM offline_exams WHERE id = ?").bind(examId).first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            const maxMarks = exam.total_marks || 100;

            // Marks only for real students of this grade
            const { results: gradeStudents } = await db.prepare("SELECT student_id FROM students WHERE grade = ?").bind(exam.grade).all();
            const valid = new Set(gradeStudents.map(r => r.student_id));

            // Check every mark before saving anything: one bad mark = nothing saved
            const clean = [];
            for (const g of grades) {
                if (!g || !g.studentId) continue;
                if (!valid.has(g.studentId)) return Response.json({ error: `الطالب ${g.studentId} مش في المرحلة دي — مفيش أي درجة اتحفظت.` }, { status: 400 });
                const absent = g.absent === true;
                const isEmpty = absent || g.score === '' || g.score === null || g.score === undefined;
                const score = isEmpty ? null : Number(g.score);
                if (!isEmpty && (!Number.isFinite(score) || score < 0 || score > maxMarks)) {
                    return Response.json({
                        error: `درجة غير صحيحة (${g.score}) للطالب ${g.studentId} — لازم تكون من 0 لـ ${maxMarks}. مفيش أي درجة اتحفظت.`
                    }, { status: 400 });
                }
                clean.push({ studentId: g.studentId, score, absent: absent ? 1 : 0 });
            }

            const { results: oldRows } = await db.prepare("SELECT student_id, score, absent FROM offline_grades WHERE exam_id = ?").bind(examId).all();
            const oldMap = {};
            oldRows.forEach(r => { oldMap[r.student_id] = cellText(r.score, r.absent); });

            const statements = [];
            const changes = [];
            for (const g of clean) {
                const prev = oldMap[g.studentId] === undefined ? null : oldMap[g.studentId];
                const next = cellText(g.score, g.absent);
                if (prev === next) continue;
                changes.push({ s: g.studentId, from: prev, to: next });
                statements.push(db.prepare(
                    `INSERT INTO offline_grades (exam_id, student_id, score, absent) VALUES (?, ?, ?, ?)
                     ON CONFLICT(exam_id, student_id) DO UPDATE SET score = excluded.score, absent = excluded.absent, updated_at = CURRENT_TIMESTAMP`
                ).bind(examId, g.studentId, g.score, g.absent));
            }
            // Only changed cells are written and logged (old → new), all in one batch
            if (changes.length) statements.push(auditStmt(db, request, staff, 'offline.save-grades', examId, { examName: exam.exam_name, changes }));
            if (statements.length > 0) await db.batch(statements);

            return Response.json({ success: true, changed: changes.length });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}
