import { requireStaff, auditStmt } from './admin-auth.js';

// Students list for the staff portal. Passwords are never sent back to the browser.
const STUDENT_COLUMNS = `student_id, first_name, last_name, gender, branch, phone, parent_phone, grade, role, created_at`;

export async function onRequestGet(context) {
    const auth = await requireStaff(context.request, context.env, 'students.view');
    if (auth.error) return auth.error;

    const db = context.env.DB || context.env.D1_DB;
    try {
        const { results } = await db.prepare(`SELECT ${STUDENT_COLUMNS} FROM students ORDER BY created_at DESC`).all();
        return Response.json(results);
    } catch (err) {
        return Response.json({ error: 'حصل خطأ في السيرفر' }, { status: 500 });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const db = env.DB || env.D1_DB;

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
            await db.batch([
                db.prepare('UPDATE students SET password = ? WHERE student_id = ?').bind(password.trim(), studentId),
                auditStmt(db, request, auth.staff, 'students.reset-password', studentId, null)
            ]);
            return Response.json({ success: true });
        }

        // 2. Delete a student (teacher only). A full copy of the row is kept in the audit log.
        if (action === 'delete') {
            const auth = await requireStaff(request, env, 'students.delete');
            if (auth.error) return auth.error;
            const { studentId } = await request.json();
            if (!studentId) return Response.json({ error: 'كود الطالب مطلوب' }, { status: 400 });
            const row = await db.prepare(`SELECT ${STUDENT_COLUMNS} FROM students WHERE student_id = ?`).bind(studentId).first();
            if (!row) return Response.json({ error: 'الطالب غير موجود' }, { status: 404 });
            await db.batch([
                db.prepare('DELETE FROM students WHERE student_id = ?').bind(studentId),
                auditStmt(db, request, auth.staff, 'students.delete', studentId, { student: row })
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
