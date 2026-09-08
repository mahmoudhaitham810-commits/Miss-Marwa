async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
    try {
        const { env } = context;
        const { studentId, password } = await context.request.json();

        if (!studentId || !password) {
            return new Response(JSON.stringify({ error: 'يرجى إدخال الكود وكلمة المرور' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const passwordHash = await hashPassword(password);

        const student = await env.DB.prepare(
            `SELECT student_id, first_name, last_name, grade FROM students WHERE student_id = ? AND password_hash = ?`
        ).bind(studentId.toUpperCase(), passwordHash).first();

        if (!student) {
            return new Response(JSON.stringify({ error: 'كود الطالب أو كلمة المرور غير صحيحة' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({
            success: true,
            student: {
                id: student.student_id,
                firstName: student.first_name,
                lastName: student.last_name,
                grade: student.grade
            }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message || 'خطأ في تسجيل الدخول' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}