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
        // === تستخدمها لوحة الأدمن عشان تجيب كل الامتحانات ===
        if (action === 'list') {
            const { results } = await db.prepare(
                "SELECT id, title, grade, questions, duration_days as durationDays, expires_at, created_at FROM exams ORDER BY created_at DESC"
            ).all();
            return Response.json(results);
        }

        // === تستخدمها صفحة الطالب عشان تعرض الامتحانات المتاحة لمرحلته ===
        // بترجع بيانات الامتحان من غير الإجابات الصح، وبتقول حالة كل امتحان بالنسبالله
        if (action === 'list-for-student') {
            const grade = (url.searchParams.get('grade') || '').toLowerCase();
            const studentId = url.searchParams.get('studentId') || '';

            if (!grade) {
                return Response.json({ error: 'المرحلة الدراسية مطلوبة' }, { status: 400 });
            }

            const { results: exams } = await db.prepare(
                "SELECT id, title, grade, questions, expires_at, created_at FROM exams WHERE grade = ? ORDER BY created_at DESC"
            ).bind(grade).all();

            let submissions = [];
            if (studentId) {
                const subRes = await db.prepare(
                    "SELECT exam_id, status, score FROM exam_submissions WHERE student_id = ?"
                ).bind(studentId).all();
                submissions = subRes.results || [];
            }

            const now = new Date();
            const list = exams.map(ex => {
                let total = 0;
                try { total = JSON.parse(ex.questions).length; } catch (e) { /* ignore */ }

                const sub = submissions.find(s => s.exam_id === ex.id);
                const isExpired = new Date(ex.expires_at) < now;

                let status = 'available';
                if (sub && sub.status === 'submitted') status = 'submitted';
                else if (sub && sub.status === 'started') status = 'locked';
                else if (isExpired) status = 'expired';

                return {
                    id: ex.id,
                    title: ex.title,
                    grade: ex.grade,
                    total,
                    expiresAt: ex.expires_at,
                    status,
                    score: sub ? sub.score : null
                };
            });

            return Response.json(list);
        }

        // === تستخدمها لوحة الأدمن عشان تجيب نتايج كل الطلاب في امتحان معين ===
        if (action === 'results') {
            const examId = url.searchParams.get('examId');
            if (!examId) {
                return Response.json({ error: 'كود الامتحان مطلوب' }, { status: 400 });
            }

            const exam = await db.prepare("SELECT questions FROM exams WHERE id = ?").bind(examId).first();
            if (!exam) {
                return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            }

            let total = 0;
            try { total = JSON.parse(exam.questions).length; } catch (e) { /* ignore */ }

            const { results } = await db.prepare(
                `SELECT s.student_id as studentId, s.first_name as firstName, s.last_name as lastName,
                        s.phone, s.parent_phone as parentPhone, sub.status, sub.score
                 FROM exam_submissions sub
                 JOIN students s ON s.student_id = sub.student_id
                 WHERE sub.exam_id = ?
                 ORDER BY s.first_name ASC`
            ).bind(examId).all();

            const list = results.map(r => ({
                studentId: r.studentId,
                firstName: r.firstName,
                lastName: r.lastName,
                phone: r.phone,
                parentPhone: r.parentPhone,
                status: r.status,
                score: r.score,
                total
            }));

            return Response.json(list);
        }

        // === تستخدمها صفحة "نتائج الامتحانات" الخاصة بالطالب عشان تعرض كل درجاته ===
        if (action === 'my-results') {
            const studentId = url.searchParams.get('studentId');
            if (!studentId) {
                return Response.json({ error: 'كود الطالب مطلوب' }, { status: 400 });
            }

            const { results } = await db.prepare(
                `SELECT sub.exam_id as examId, sub.score, sub.submitted_at as submittedAt,
                        e.title, e.grade, e.questions
                 FROM exam_submissions sub
                 JOIN exams e ON e.id = sub.exam_id
                 WHERE sub.student_id = ? AND sub.status = 'submitted'
                 ORDER BY sub.submitted_at DESC`
            ).bind(studentId).all();

            const list = results.map(r => {
                let total = 0;
                try { total = JSON.parse(r.questions).length; } catch (e) { /* ignore */ }
                return {
                    examId: r.examId,
                    title: r.title,
                    grade: r.grade,
                    score: r.score,
                    total,
                    submittedAt: r.submittedAt
                };
            });

            return Response.json(list);
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

        // === الأدمن بتنشئ امتحان جديد ===
        if (action === 'create') {
            if (!data.title || !data.grade) {
                return Response.json({ error: 'عنوان الامتحان والمرحلة الدراسية مطلوبين' }, { status: 400 });
            }
            if (!Array.isArray(data.questions) || data.questions.length === 0) {
                return Response.json({ error: 'لازم يكون فيه سؤال واحد على الأقل' }, { status: 400 });
            }

            for (const q of data.questions) {
                if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
                    return Response.json({ error: 'في سؤال ناقصه نص أو اختيارات كافية' }, { status: 400 });
                }
                if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
                    return Response.json({ error: `السؤال "${q.question}" مفيهوش إجابة صح واضحة` }, { status: 400 });
                }
            }

            const durationDays = parseInt(data.durationDays, 10) > 0 ? parseInt(data.durationDays, 10) : 3;
            const examId = `EX-${Math.floor(100000 + Math.random() * 900000)}`;
            const now = new Date();
            const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

            await db.prepare(
                "INSERT INTO exams (id, title, grade, questions, duration_days, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(
                examId, data.title, data.grade, JSON.stringify(data.questions), durationDays, expiresAt.toISOString()
            ).run();

            return Response.json({ success: true, examId });
        }

        // === الأدمن بتمسح امتحان ===
        if (action === 'delete') {
            const { examId } = data;
            if (!examId) {
                return Response.json({ error: 'كود الامتحان مطلوب' }, { status: 400 });
            }
            await db.prepare("DELETE FROM exams WHERE id = ?").bind(examId).run();
            await db.prepare("DELETE FROM exam_submissions WHERE exam_id = ?").bind(examId).run();
            return Response.json({ success: true });
        }

        // === الطالب بيفتح الامتحان لأول مرة (وده اللي بيقفل الدخول تاني) ===
        if (action === 'start') {
            const { examId, studentId } = data;
            if (!examId || !studentId) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }

            const exam = await db.prepare(
                "SELECT id, title, grade, questions, expires_at FROM exams WHERE id = ?"
            ).bind(examId).first();

            if (!exam) {
                return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            }

            if (new Date(exam.expires_at) < new Date()) {
                return Response.json({ status: 'expired', error: 'للأسف انتهى وقت هذا الامتحان' }, { status: 403 });
            }

            // بنحاول نسجل "بدأ الامتحان" كصف جديد. لو فيه صف موجود بالفعل لنفس
            // الطالب ونفس الامتحان، الـ UNIQUE في الداتا بيز هيرفض الإدراج،
            // وده بالظبط اللي بيمنع الطالب من الدخول مرتين.
            try {
                await db.prepare(
                    "INSERT INTO exam_submissions (exam_id, student_id, status) VALUES (?, ?, 'started')"
                ).bind(examId, studentId).run();
            } catch (insertErr) {
                const existing = await db.prepare(
                    "SELECT status, score FROM exam_submissions WHERE exam_id = ? AND student_id = ?"
                ).bind(examId, studentId).first();

                if (existing && existing.status === 'submitted') {
                    let total = 0;
                    try { total = JSON.parse(exam.questions).length; } catch (e) { /* ignore */ }
                    return Response.json({ status: 'submitted', score: existing.score, total });
                }

                return Response.json({
                    status: 'locked',
                    error: 'أنتِ دخلتِ هذا الامتحان قبل كده، ومينفعش تدخلي مرة تانية'
                }, { status: 403 });
            }

            // أول دخول ناجح: نبعت الأسئلة والاختيارات بس، من غير الإجابة الصح
            // (عشان محدش يقدر يشوفها من كود الصفحة)
            let questionsForStudent = [];
            try {
                questionsForStudent = JSON.parse(exam.questions).map(q => ({
                    question: q.question,
                    options: q.options
                }));
            } catch (e) {
                return Response.json({ error: 'حصل خطأ في قراءة أسئلة الامتحان' }, { status: 500 });
            }

            return Response.json({
                status: 'started',
                examId: exam.id,
                title: exam.title,
                questions: questionsForStudent
            });
        }

        // === الطالب بيسلم إجاباته، والسيرفر هو اللي بيحسب الدرجة ===
        if (action === 'submit') {
            const { examId, studentId, answers } = data;
            if (!examId || !studentId || !Array.isArray(answers)) {
                return Response.json({ error: 'بيانات ناقصة' }, { status: 400 });
            }

            const submission = await db.prepare(
                "SELECT status FROM exam_submissions WHERE exam_id = ? AND student_id = ?"
            ).bind(examId, studentId).first();

            if (!submission) {
                return Response.json({ error: 'لازم تبدئي الامتحان الأول قبل ما تسلمي' }, { status: 403 });
            }
            if (submission.status === 'submitted') {
                return Response.json({ error: 'الامتحان ده اتسلم قبل كده، مينفعش تسلمي مرتين' }, { status: 403 });
            }

            const exam = await db.prepare("SELECT questions FROM exams WHERE id = ?").bind(examId).first();
            if (!exam) {
                return Response.json({ error: 'الامتحان غير موجود' }, { status: 404 });
            }

            let questions = [];
            try {
                questions = JSON.parse(exam.questions);
            } catch (e) {
                return Response.json({ error: 'حصل خطأ في قراءة أسئلة الامتحان' }, { status: 500 });
            }

            let correctCount = 0;
            questions.forEach((q, i) => {
                if (answers[i] === q.correctIndex) correctCount++;
            });

            await db.prepare(
                "UPDATE exam_submissions SET status = 'submitted', score = ?, submitted_at = CURRENT_TIMESTAMP WHERE exam_id = ? AND student_id = ?"
            ).bind(correctCount, examId, studentId).run();

            return Response.json({ success: true, score: correctCount, total: questions.length });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
