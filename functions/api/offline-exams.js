// الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
// الدالة دي بتتأكد إننا بنمسك الاسم الصح مهما كان
function getDb(env) {
    return env.DB || env.D1_DB;
}

export async function onRequestGet(context) {
    const { request, env } = context;
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
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
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

            return Response.json({ success: true, examId: result.meta.last_row_id });
        }

        // === حفظ (أو تحديث) درجات مجموعة طلاب لامتحان معين دفعة واحدة ===
        if (action === 'save-grades') {
            const { examId, grades } = data;
            if (!examId || !Array.isArray(grades)) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }

            for (const g of grades) {
                if (!g.studentId) continue;
                const score = (g.score === '' || g.score === null || g.score === undefined) ? null : parseFloat(g.score);

                await db.prepare(
                    `INSERT INTO offline_grades (exam_id, student_id, score) VALUES (?, ?, ?)
                     ON CONFLICT(exam_id, student_id) DO UPDATE SET score = excluded.score, updated_at = CURRENT_TIMESTAMP`
                ).bind(examId, g.studentId, score).run();
            }

            return Response.json({ success: true });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
