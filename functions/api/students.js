export async function onRequestGet(context) {
  try {
    const { results } = await context.env.D1_DB.prepare("SELECT * FROM students ORDER BY created_at DESC").all();
    
    // الجزء ده بيترجم أسماء الداتا بيز للأسماء اللي الواجهة متوقعاها
    const formattedStudents = results.map(user => ({
      studentId: user.student_id,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      parentPhone: user.parent_phone,
      grade: user.grade,
      password: user.password,
      role: user.role,
      createdAt: user.created_at
    }));

    return Response.json(formattedStudents);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    // 1. حالة تغيير الباسورد
    if (action === 'reset-password') {
      const { studentId, password } = await request.json();
      await env.D1_DB.prepare("UPDATE students SET password = ? WHERE student_id = ?").bind(password, studentId).run();
      return Response.json({ success: true });
    }

    // 2. حالة حذف طالب
    if (action === 'delete') {
      const { studentId } = await request.json();
      await env.D1_DB.prepare("DELETE FROM students WHERE student_id = ?").bind(studentId).run();
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Action not found' }, { status: 404 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
