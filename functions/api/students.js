export async function onRequestGet(context) {
    // الكود ده بيشتغل لما صفحة الأدمن تطلب تجيب كل الطلاب
    // الداتا بيز ممكن تكون متسجلة في Cloudflare باسم DB أو D1_DB
    const db = context.env.DB || context.env.D1_DB;
    try {
        const { results } = await db.prepare("SELECT * FROM students ORDER BY created_at DESC").all();
        return Response.json(results);
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = env.DB || env.D1_DB;

    try {
        // 1. حالة تغيير الباسورد
        if (action === 'reset-password') {
            const { studentId, password } = await request.json();
            await db.prepare("UPDATE students SET password = ? WHERE student_id = ?").bind(password, studentId).run();
            return Response.json({ success: true });
        }

        // 2. حالة حذف طالب
        if (action === 'delete') {
            const { studentId } = await request.json();
            await db.prepare("DELETE FROM students WHERE student_id = ?").bind(studentId).run();
            return Response.json({ success: true });
        }

        return Response.json({ error: 'Action not found' }, { status: 404 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
