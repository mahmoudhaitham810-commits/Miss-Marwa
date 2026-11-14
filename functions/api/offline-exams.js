import { requireStaff, audit, auditStmt } from './admin-auth.js';

// الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
// الدالة دي بتتأكد إننا بنمسك الاسم الصح مهما كان
function getDb(env) {
    return env.DB || env.D1_DB;
}

export async function onRequestGet(context) {
    const { request, env } = context;

    // ── حماية: أدمن بس ──
    const auth = await requireStaff(request, env, 'offline.view');
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);

    try {
        // === الطلب الرئيسي: كل حاجة محتاجاها صفحة الامتحانات الأوفلاين لمرحلة معينة ===
        // (الطلاب + الامتحانات + كل الدرجات) في طلب واحد بس
        if (action === 'grade-data') {
            const grade = (url.searchParams.get('grade') || '').toLowerCase();
            if (!grade) {
                return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });
            }

            const { results: students } = await db.prepare(
                "SELECT student_id as studentId, first_name as firstName, last_name as lastName, parent_phone as parentPhone FROM students WHERE grade = ? ORDER BY first_name ASC"
            ).bind(grade).all();

            const { results: exams } = await db.prepare(
                "SELECT id, exam_name as examName, total_marks as totalMarks, created_at as createdAt FROM offline_exams WHERE grade = ? ORDER BY created_at ASC"
            ).bind(grade).all();

            let grades = [];
            if (exams.length > 0) {
                const examIds = exams.map(e => e.id);
                const placeholders = examIds.map(() => '?').join(',');
                const { results } = await db.prepare(
                    `SELECT exam_id as examId, student_id as studentId, score FROM offline_grades WHERE exam_id IN (${placeholders})`
                ).bind(...examIds).all();
                grades = results;
            }

            return Response.json({ students, exams, grades });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;

    // ── حماية: أدمن بس ──
    const PERM = { 'create-exam': 'offline.create-exam', 'update-exam': 'offline.edit-exam', 'delete-exam': 'offline.delete-exam', 'save-grades': 'offline.save-grades' };
    const url0 = new URL(request.url);
    const auth = await requireStaff(request, env, PERM[url0.searchParams.get('action')] || 'offline.view');
    if (auth.error) return auth.error;
    const staff = auth.staff;

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = getDb(env);

    try {
        const data = await request.json();

        // === إنشاء عمود امتحان أوفلاين جديد لمرحلة معينة ===
        if (action === 'create-exam') {
            if (!data.examName || !data.grade) {
                return Response.json({ error: 'اسم الامتحان والمرحلة الدراسية مطلوبين' }, { status: 400 });
            }
            const totalMarks = parseFloat(data.totalMarks) > 0 ? parseFloat(data.totalMarks) : 100;

            const result = await db.prepare(
                "INSERT INTO offline_exams (exam_name, grade, total_marks) VALUES (?, ?, ?)"
            ).bind(data.examName, data.grade, totalMarks).run();
            await audit(db, request, staff, 'offline.create-exam', result.meta.last_row_id, { examName: data.examName, grade: data.grade, totalMarks });

            return Response.json({ success: true, examId: result.meta.last_row_id });
        }

        // === حفظ (أو تحديث) درجات مجموعة طلاب لامتحان معين دفعة واحدة ===
        if (action === 'update-exam') {
            const { examId, examName, totalMarks } = data;
            if (!examId || !examName || parseFloat(totalMarks) <= 0) {
                return Response.json({ error: 'بيانات غير صالحة' }, { status: 400 });
            }
            const before = await db.prepare("SELECT exam_name, total_marks FROM offline_exams WHERE id = ?").bind(examId).first();
            if (!before) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            // لو الدرجة النهائية قلّت عن درجة طالب متسجلة، النسبة كانت بتطلع أكتر من 100%
            const top = await db.prepare("SELECT MAX(score) as m FROM offline_grades WHERE exam_id = ?").bind(examId).first();
            if (top && top.m !== null && parseFloat(totalMarks) < top.m) {
                return Response.json({ error: `فيه طالب واخد ${top.m} في الامتحان ده — الدرجة النهائية مينفعش تقل عن كده.` }, { status: 400 });
            }
            await db.batch([
                db.prepare("UPDATE offline_exams SET exam_name = ?, total_marks = ? WHERE id = ?").bind(examName, parseFloat(totalMarks), examId),
                auditStmt(db, request, staff, 'offline.edit-exam', examId, { before, after: { exam_name: examName, total_marks: parseFloat(totalMarks) } })
            ]);
            return Response.json({ success: true });
        }

        if (action === 'delete-exam') {
            const { examId } = data;
            if (!examId) return Response.json({ error: 'معرف الامتحان مفقود' }, { status: 400 });
            
            const exam = await db.prepare("SELECT * FROM offline_exams WHERE id = ?").bind(examId).first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            const { results: grades } = await db.prepare("SELECT student_id as s, score as sc FROM offline_grades WHERE exam_id = ?").bind(examId).all();
            await db.batch([
                db.prepare("DELETE FROM offline_grades WHERE exam_id = ?").bind(examId),
                db.prepare("DELETE FROM offline_exams WHERE id = ?").bind(examId),
                auditStmt(db, request, staff, 'offline.delete-exam', examId, { exam, grades })
            ]);
            return Response.json({ success: true });
        }

        if (action === 'save-grades') {
            const { examId, grades } = data;
            if (!examId || !Array.isArray(grades)) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }

            const exam = await db.prepare("SELECT exam_name, total_marks FROM offline_exams WHERE id = ?").bind(examId).first();
            if (!exam) return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            const maxMarks = exam.total_marks || 100;

            // نتأكد من كل الدرجات الأول قبل ما نحفظ أي حاجة: درجة سالبة أو أكبر من الدرجة النهائية
            // أو كلام مش رقم كانت بتتحفظ عادي وبتبوّظ التحليلات ولوحة الشرف.
            const statements = [];
            for (const g of grades) {
                if (!g.studentId) continue;
                const isEmpty = (g.score === '' || g.score === null || g.score === undefined);
                const score = isEmpty ? null : Number(g.score);
                if (!isEmpty && (!Number.isFinite(score) || score < 0 || score > maxMarks)) {
                    return Response.json({
                        error: `درجة غير صحيحة (${g.score}) للطالب ${g.studentId} — لازم تكون من 0 لـ ${maxMarks}. مفيش أي درجة اتحفظت.`
                    }, { status: 400 });
                }
                statements.push(db.prepare(
                    `INSERT INTO offline_grades (exam_id, student_id, score) VALUES (?, ?, ?)
                     ON CONFLICT(exam_id, student_id) DO UPDATE SET score = excluded.score, updated_at = CURRENT_TIMESTAMP`
                ).bind(examId, g.studentId, score));
            }

            // سجل النشاط: بنسجل الخانات اللي اتغيرت بس (القديم والجديد) عشان أي تعديل يبان مين عمله
            const { results: oldRows } = await db.prepare("SELECT student_id, score FROM offline_grades WHERE exam_id = ?").bind(examId).all();
            const oldMap = {};
            oldRows.forEach(r => { oldMap[r.student_id] = r.score; });
            const changes = [];
            for (const g of grades) {
                if (!g.studentId) continue;
                const isEmpty = (g.score === '' || g.score === null || g.score === undefined);
                const next = isEmpty ? null : Number(g.score);
                const prev = oldMap[g.studentId] === undefined ? null : oldMap[g.studentId];
                if (prev !== next) changes.push({ s: g.studentId, from: prev, to: next });
            }
            if (changes.length) statements.push(auditStmt(db, request, staff, 'offline.save-grades', examId, { examName: exam.exam_name, changes }));

            // batch = كل الدرجات تتحفظ مرة واحدة (أسرع بكتير، ومفيش حفظ نص العمود لو حصل خطأ)
            if (statements.length > 0) await db.batch(statements);

            return Response.json({ success: true });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}
