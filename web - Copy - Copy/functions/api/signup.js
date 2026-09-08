async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
    try {
        const { env } = context;
        const { firstName, lastName, phone, parentPhone, grade, password } = await context.request.json();

        if (!firstName || !lastName || !phone || !parentPhone || !grade || !password) {
            return new Response(JSON.stringify({ error: 'جميع الحقول مطلوبة' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const randomNum = Math.floor(100000 + Math.random() * 900000);
        const studentId = `MM-${randomNum}`;
        const passwordHash = await hashPassword(password);

        await env.DB.prepare(
            `INSERT INTO students (student_id, first_name, last_name, phone, parent_phone, grade, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(studentId, firstName, lastName, phone, parentPhone, grade, passwordHash).run();

        return new Response(JSON.stringify({
            success: true,
            studentId: studentId,
            student: { id: studentId, firstName, lastName, grade }
        }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message || 'خطأ في الخادم' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}