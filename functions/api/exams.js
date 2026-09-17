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
        if (action === 'list') {
            const { results } = await db.prepare(
                "SELECT id, title, grade, questions, duration_days as durationDays, expires_at, created_at FROM exams ORDER BY created_at DESC"
            ).all();
            return Response.json(results);
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

        if (action === 'create') {
            // تحقق أساسي من البيانات قبل الحفظ
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

        if (action === 'delete') {
            const { examId } = data;
            if (!examId) {
                return Response.json({ error: 'كود الامتحان مطلوب' }, { status: 400 });
            }
            await db.prepare("DELETE FROM exams WHERE id = ?").bind(examId).run();
            await db.prepare("DELETE FROM exam_submissions WHERE exam_id = ?").bind(examId).run();
            return Response.json({ success: true });
        }

        return Response.json({ error: 'إجراء غير معروف' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
