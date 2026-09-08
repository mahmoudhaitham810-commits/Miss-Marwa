export async function onRequestPost({ request, env }) {
    try {
        const url = new URL(request.url);
        const action = url.searchParams.get('action');
        const body = await request.json();

        if (action === 'signup') {
            const studentId = 'MM-' + Math.floor(100000 + Math.random() * 900000);
            await env.DB.prepare(
                `INSERT INTO students (student_id, first_name, last_name, phone, parent_phone, grade, password, role)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'student')`
            ).bind(
                studentId,
                body.firstName.trim(),
                body.lastName.trim(),
                body.phone.trim(),
                body.parentPhone.trim(),
                body.grade,
                body.password.trim()
            ).run();

            return Response.json({
                success: true,
                studentId,
                student: {
                    id: studentId,
                    firstName: body.firstName.trim(),
                    lastName: body.lastName.trim(),
                    grade: body.grade,
                    role: 'student'
                }
            });
        }

        if (action === 'login') {
            const cleanId = (body.studentId || '').trim().toUpperCase();
            const cleanPass = (body.password || '').trim();

            const user = await env.DB.prepare(
                `SELECT * FROM students WHERE UPPER(student_id) = ? AND password = ?`
            ).bind(cleanId, cleanPass).first();

            if (!user) {
                return Response.json({ error: 'Wrong ID/Password' }, { status: 401 });
            }

            return Response.json({
                success: true,
                student: {
                    id: user.student_id,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    grade: user.grade,
                    role: user.role
                }
            });
        }

        return Response.json({ error: 'Invalid action' }, { status: 400 });
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}