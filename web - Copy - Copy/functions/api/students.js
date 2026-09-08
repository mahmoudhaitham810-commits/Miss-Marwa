export async function onRequestGet({ env }) {
    try {
        const { results } = await env.DB.prepare(
            `SELECT student_id as studentId, first_name as firstName, last_name as lastName,
                    phone, parent_phone as parentPhone, grade, password, role,
                    strftime('%d/%m/%Y', created_at) as createdAt
             FROM students ORDER BY id DESC`
        ).all();
        return Response.json(results || []);
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function onRequestPost({ request, env }) {
    try {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        const body = await request.json();

        if (action === 'reset-password') {
            await env.DB.prepare(
                `UPDATE students SET password = ? WHERE student_id = ?`
            ).bind(body.password.trim(), body.studentId).run();
            return Response.json({ success: true });
        }

        if (action === 'delete') {
            await env.DB.prepare(
                `DELETE FROM students WHERE student_id = ?`
            ).bind(body.studentId).run();
            return Response.json({ success: true });
        }

        return Response.json({ error: 'Invalid action' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}